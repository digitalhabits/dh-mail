"use client";

/**
 * A few seconds between "Delete forever" and the mail leaving the provider.
 *
 * The rows leave the list at once, and nothing has been asked of Gmail or
 * Outlook until the count runs out. That is what makes Undo honest: see
 * `lib/mail/pending-purge.ts`. The pill is the one Send uses, so the reader
 * meets the same thing for the two actions that cannot be taken back.
 */

import { CountdownPill } from "@/components/mail/undo-send";
import { mailSay } from "@/lib/mail/i18n-strings";
import {
  PURGE_UNDO_SECONDS,
  dropPendingPurges,
  holdPurge,
} from "@/lib/mail/pending-purge";
import { toast } from "@/lib/mail/toast";

let dropBound = false;

function bindDrop(): void {
  if (dropBound || typeof window === "undefined") return;
  dropBound = true;
  // A window that closes inside the count deletes nothing. The mail stays
  // in Trash.
  window.addEventListener("pagehide", () => void dropPendingPurges());
}

/** The navy pill with words only: what the count ended in. */
function DonePill({ text }: { text: string }) {
  return (
    <div className="flex items-center rounded-full bg-[#1b2432] px-5 py-3 shadow-lg">
      <span className="text-sm font-medium text-white">{text}</span>
    </div>
  );
}

/** Say that it is done, in the same navy as the count. */
export function sayDeletedForever(): void {
  toast.custom(() => <DonePill text={mailSay("deletedForever")} />, {
    duration: 3000,
  });
}

/**
 * Hold the delete for a few seconds, and let the reader take it back.
 *
 * `onRun` runs when the count finishes. `onUndo` runs instead when the reader
 * presses Undo. Neither runs twice, and never both. If the window closes
 * inside the count, neither runs.
 */
export function deleteForeverWithUndo(options: {
  onRun: () => void;
  onUndo: () => void;
  seconds?: number;
}): void {
  const seconds = options.seconds ?? PURGE_UNDO_SECONDS;
  bindDrop();
  const held = holdPurge(() => {
    toast.dismiss(toastId);
    options.onRun();
  }, seconds * 1000);
  const toastId = toast.custom(
    () => (
      <CountdownPill
        seconds={seconds}
        label={(left) => mailSay("deletingForeverIn", { count: left })}
        onUndo={() => {
          if (!held.cancel()) return;
          toast.dismiss(toastId);
          options.onUndo();
        }}
      />
    ),
    // A little longer than the count, so the pill never goes before it ends.
    { duration: seconds * 1000 + 500 }
  );
}
