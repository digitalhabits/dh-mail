"use client";

/**
 * A few seconds between pressing Send and the message leaving.
 *
 * The composer closes at once, because the reader is finished with it, and
 * the message is genuinely not sent yet — nothing has been handed to the
 * provider until the count runs out. That is what makes Undo honest: it is
 * not a recall, and nothing has to be taken back from anybody.
 *
 * The cost of that is a message held in this window. If the app goes away
 * inside the count it has not been sent, so a pending send is flushed when
 * the page is hidden or closed rather than dropped. Each caller also keeps
 * what it needs to put the reader back where they were: the reply composer
 * has its outbox entry, and the main composer still has its local draft,
 * which is only deleted once the mail is actually away.
 *
 * Not offered in the chat pop-out. That window is a conversation being had,
 * where a message is a line of talk and the reply is immediate.
 */

import * as React from "react";
import { useMailT } from "@/lib/mail/i18n";
import { mailSay } from "@/lib/mail/i18n-strings";
import { toast } from "@/lib/mail/toast";
import { mailUndoSlot } from "@/lib/mail/undo-slot";

/** Long enough to notice the mistake, short enough not to feel held up. */
export const UNDO_SEND_SECONDS = 5;

type Pending = { fire: () => void; timer: number };
const pending = new Set<Pending>();
let flushBound = false;

/** Anything still counting goes now — the window is closing on it. */
function flushPendingSends(): void {
  for (const item of [...pending]) {
    window.clearTimeout(item.timer);
    pending.delete(item);
    item.fire();
  }
}

function bindFlush(): void {
  if (flushBound || typeof window === "undefined") return;
  flushBound = true;
  // pagehide rather than beforeunload: it is the one that fires on a closed
  // tab and on a Mac app quitting, and it does not ask the reader anything.
  window.addEventListener("pagehide", flushPendingSends);
}

/**
 * The navy pill that counts down, with Undo. `label` is given the seconds
 * that are left. Send uses it, and so does "Delete forever" (`undo-purge.tsx`).
 */
export function CountdownPill({
  seconds,
  label,
  onUndo,
}: {
  seconds: number;
  label: (left: number) => string;
  onUndo: () => void;
}) {
  const t = useMailT();
  const [left, setLeft] = React.useState(seconds);
  React.useEffect(() => {
    const tick = window.setInterval(() => {
      setLeft((n) => (n > 0 ? n - 1 : 0));
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);
  return (
    <div className="flex items-center gap-4 rounded-full bg-[#1b2432] py-3 pl-5 pr-4 shadow-lg">
      <span className="text-sm font-medium text-white">
        {label(left)}
      </span>
      <button
        type="button"
        className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-sm font-semibold text-teal-300 hover:text-teal-200"
        onClick={onUndo}
      >
        {t("undo")}
      </button>
    </div>
  );
}

/**
 * Hold the send for a few seconds, and let the reader take it back.
 *
 * `onSend` runs when the count finishes, or straight away if the window is
 * closing. `onUndo` runs instead when the reader presses Undo — neither ever
 * runs twice, and never both.
 */
export function sendWithUndo(options: {
  onSend: () => void;
  onUndo: () => void;
  seconds?: number;
  /** What it says; "Sending in 5…" when left out. */
  label?: (left: number) => string;
  /** What is sent, after the words: its subject. */
  object?: string;
}): void {
  const seconds = options.seconds ?? UNDO_SEND_SECONDS;
  bindFlush();
  const label = options.label ?? ((left: number) => mailSay("sendingIn", { seconds: left }));

  let settled = false;
  const item: Pending = { fire: () => {}, timer: 0 };
  const slotId = `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let toastId: string | number | null = null;

  const finish = (what: "send" | "undo") => {
    if (settled) return;
    settled = true;
    pending.delete(item);
    window.clearTimeout(item.timer);
    if (toastId != null) toast.dismiss(toastId);
    mailUndoSlot.clear(slotId);
    if (what === "send") options.onSend();
    else options.onUndo();
  };

  item.fire = () => finish("send");
  item.timer = window.setTimeout(() => finish("send"), seconds * 1000);
  pending.add(item);

  // With a list or a reader on screen, it stands with the other
  // confirmations at their foot (undo-slot-row). A window that has neither,
  // a composer of its own, keeps the countdown toast.
  const { listOn, stripOn } = mailUndoSlot.get();
  if (listOn > 0 || stripOn > 0) {
    mailUndoSlot.show({
      id: slotId,
      action: "send",
      verb: label(seconds),
      countdown: { endsAt: Date.now() + seconds * 1000, verb: label },
      object: options.object?.trim() ?? "",
      label: label(seconds),
      // Gone when it is sent; this is only a floor.
      ms: seconds * 1000 + 2000,
      undo: () => finish("undo"),
    });
    return;
  }
  toastId = toast.custom(
    () => <CountdownPill seconds={seconds} label={label} onUndo={() => finish("undo")} />,
    { duration: seconds * 1000 }
  );
}
