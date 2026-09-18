"use client";

import { rowTime } from "@/lib/mail/date-format";
import { useMailT } from "@/lib/mail/i18n";
import type { MailDraftRow } from "@/lib/mail/types";
import { isNativeShell } from "@/lib/native-shell";
import { cn } from "@/lib/utils";

/**
 * What to call the place our own drafts are kept.
 *
 * "Here" is true and says nothing: a reader wants to know which machine has
 * it, because that is the one they have to be at to finish it. In the desktop
 * app that is the machine they are looking at, so it is named — "My Mac", and
 * "My PC" wherever the app is a Windows one.
 *
 * In the browser it stays "Here", because there it means the planner's own
 * store and not this computer. Naming the machine there would be a lie about
 * where the draft is.
 */
function localOrigin(): { label: string; where: string } {
  if (typeof navigator === "undefined" || !isNativeShell()) {
    return { label: "Here", where: "in this app" };
  }
  const hinted = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform;
  const said = `${hinted ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (said.includes("mac")) return { label: "My Mac", where: "on this Mac" };
  if (said.includes("win")) return { label: "My PC", where: "on this PC" };
  return { label: "This device", where: "on this device" };
}

const ORIGIN_LABELS: Record<MailDraftRow["origin"], string> = {
  here: "Here",
  gmail: "Gmail",
  outlook: "Outlook",
};

/**
 * Ours is the odd one out, so it is the one that looks different.
 *
 * Different, not alarming. It was red, which in a mail client means a thing
 * has gone wrong — and a draft kept on this machine is a choice working as
 * intended. Teal is the colour this app uses for its own doing.
 */
const ORIGIN_STYLES: Record<MailDraftRow["origin"], string> = {
  here: "bg-teal-50 text-teal-800",
  gmail: "bg-stone-200/70 text-stone-700",
  outlook: "bg-stone-200/70 text-stone-700",
};

function DraftOriginBadge({ origin }: { origin: MailDraftRow["origin"] }) {
  const local = localOrigin();
  const label = origin === "here" ? local.label : ORIGIN_LABELS[origin];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none",
        ORIGIN_STYLES[origin]
      )}
      title={
        origin === "here"
          ? `Kept ${local.where} only — it is not in Gmail or Outlook`
          : `Kept in ${ORIGIN_LABELS[origin]}`
      }
    >
      {label}
    </span>
  );
}

/**
 * A copy left behind by a message that went out through Outlook.
 *
 * It does not say "sent", because nobody here knows that: the send happens
 * in Outlook, in a mailbox this app usually holds no token for. It says the
 * one thing that did happen — the words were handed over, on this day — so
 * a reader looking down the list can tell a letter nobody finished from one
 * that left by another door.
 */
function HandedOverBadge({ at }: { at: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded bg-stone-200/70 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-stone-600"
      title={`Handed to Outlook on ${rowTime(at, { withYear: true })}. Whether it was sent from there, this app cannot know.`}
    >
      To Outlook
    </span>
  );
}

export function MailDraftsList({
  rows,
  loading,
  onOpen,
  openKey,
  onClearHandedOver,
}: {
  rows: MailDraftRow[];
  loading: boolean;
  onOpen: (row: MailDraftRow) => void;
  /** Discard every copy that went to Outlook, in one press. */
  onClearHandedOver?: () => void;
  /**
   * The draft that is open in the composer, so its row says so.
   *
   * A thread list marks the thread being read; this list marked nothing,
   * and a reader who opened a draft had no way to see which one of a
   * hundred rows they were looking at.
   */
  openKey?: string | null;
}) {
  const t = useMailT();
  if (!rows.length) {
    return (
      <p className="px-5 py-8 text-sm text-[var(--mail-chrome-muted)]">
        {loading ? t("lookingForDrafts") : t("nothingUnsent")}
      </p>
    );
  }

  const handedOver = rows.filter((row) => row.handedOverAt).length;

  return (
    <>
    {/* The sweep. One press for all of them, because they arrive in
        handfuls — a morning of outreach through Outlook is a morning of
        copies — and going through them one at a time is the work this is
        for. */}
    {handedOver && onClearHandedOver ? (
      <div className="flex items-center justify-between gap-2 px-5 py-2 text-xs text-[var(--mail-chrome-muted)]">
        <span>
          {handedOver === 1
            ? "1 copy went to Outlook"
            : `${handedOver} copies went to Outlook`}
        </span>
        <button
          type="button"
          className="shrink-0 font-medium text-[var(--mail-accent)] underline-offset-2 hover:underline"
          onClick={onClearHandedOver}
        >
          {handedOver === 1 ? "Discard it" : "Discard them"}
        </button>
      </div>
    ) : null}
    <ul className="py-1">
      {rows.map((row) => {
        const recipients = row.to.join(", ");
        // A reply draft has no subject; say who it is to instead.
        const title =
          row.subject || (recipients ? `To ${recipients}` : "(no recipient)");
        const open = Boolean(openKey) && row.id === openKey;
        return (
          <li key={`${row.origin}:${row.id}`}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              aria-current={open ? "true" : undefined}
              // The open one said the way the thread list says it: a fill
              // and a bar down the left, and the hover kept a grey so a row
              // under the pointer never reads as the row that is open.
              className={cn(
                "relative flex w-full flex-col gap-0.5 px-5 py-2 text-left",
                open
                  ? "bg-[var(--mail-row-selected)] before:absolute before:inset-y-0 before:left-0 before:w-[4px] before:rounded-r-[1px] before:bg-[var(--mail-accent)]"
                  : "hover:bg-[var(--mail-chrome-hover)]"
              )}
            >
              <span className="flex w-full items-center gap-2">
                <DraftOriginBadge origin={row.origin} />
                {row.handedOverAt ? (
                  <HandedOverBadge at={row.handedOverAt} />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--mail-chrome-fg)]">
                  {title}
                </span>
                <span className="shrink-0 text-xs text-[var(--mail-chrome-faint)]">
                  {row.updatedAt ? rowTime(row.updatedAt) : ""}
                </span>
              </span>
              {row.subject && recipients ? (
                <span className="truncate text-xs text-[var(--mail-chrome-muted)]">
                  To {recipients}
                </span>
              ) : null}
              {row.snippet ? (
                <span className="truncate text-xs text-[var(--mail-chrome-faint)]">
                  {row.snippet}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
    </>
  );
}
