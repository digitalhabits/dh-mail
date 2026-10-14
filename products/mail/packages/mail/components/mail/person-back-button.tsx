"use client";

import { ArrowDown, ArrowLeft, ArrowUp } from "lucide-react";

import { useMailT } from "@/lib/mail/i18n";
import type { PersonRow } from "@/lib/mail/person-participants";
import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

/**
 * The way back to a person's threads, first in the thread's toolbar: an
 * arrow, their face, their name and how many threads they have.
 *
 * It was a line of small grey text above the toolbar, "All threads with
 * Konrad", which read as a caption and not as a way back (Ulrik,
 * 2026-10-11). A button in the row the reader's hand is already in, with
 * the face the list shows, says where it goes.
 */
export function PersonBackButton({
  row,
  open,
  onBack,
  onStep,
}: {
  row: PersonRow;
  /** The thread open now, to say which of theirs it is. */
  open: { account: string; threadId: string };
  onBack: () => void;
  /** Open another of their threads, as a click on its card does. */
  onStep: (thread: MailThreadSummary) => void;
}) {
  const t = useMailT();
  const at = row.threads.findIndex((th) => threadKey(th) === threadKey(open));
  const step = (by: number) => {
    const next = row.threads[at + by];
    if (next) onStep(next);
  };
  const arrow = (enabled: boolean) =>
    enabled
      ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--mail-thread-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-thread-fg)]"
      : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--mail-thread-muted)] opacity-35";
  const canNewer = at > 0;
  const canOlder = at >= 0 && at < row.threads.length - 1;
  /*
    One white pill, as Ulrik drew it (2026-10-11): the way back — arrow,
    initials, name — then a rule, which of their threads this is, and the
    two steps. The arrows are the toolbar's icons — its grey, its light
    tint on hover — and one at the end of the list is faint. Neutral colours: a purple tint was too
    loud for a control.
  */
  return (
    <span className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-[var(--mail-nav-tint-border)] bg-[var(--mail-nav-tint)] pl-1 pr-1 text-sm text-[var(--mail-nav-tint-fg)]">
      <button
        type="button"
        onClick={onBack}
        title={t("allThreadsWith", { name: row.name })}
        aria-label={t("allThreadsWith", { name: row.name })}
        className="flex h-7 min-w-0 max-w-[12rem] items-center gap-2 rounded-full pl-1.5 pr-1 hover:bg-[var(--mail-chrome-hover)]"
      >
        <ArrowLeft className="h-4 w-4 shrink-0 text-[var(--mail-thread-muted)]" aria-hidden />
        {/* Neutral initials, not the list's colours: the pill is a control,
            and a coloured face drew the eye away from the thread. */}
        <span
          aria-hidden
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--mail-nav-avatar)] text-[10px] font-semibold text-[var(--mail-nav-avatar-fg)]"
        >
          {initialsOf(row.name)}
        </span>
        <span className="min-w-0 truncate font-medium">{row.name}</span>
      </button>
      <span aria-hidden className="h-5 w-px shrink-0 bg-[var(--mail-nav-tint-border)]" />
      <span className="shrink-0 pl-0.5 pr-1 font-normal tabular-nums text-[var(--mail-thread-muted)]" data-person-step-at>
        {at >= 0
          ? t("stepOfThreads", { at: at + 1, count: row.threads.length })
          : t("personThreadsCount", { count: row.threads.length })}
      </span>
      <button type="button" className={arrow(canNewer)} disabled={!canNewer} onClick={() => step(-1)} aria-label={t("newerThread")} title={t("newerThread")}>
        <ArrowUp className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={arrow(canOlder)} disabled={!canOlder} onClick={() => step(1)} aria-label={t("olderThread")} title={t("olderThread")}>
        <ArrowDown className="h-4 w-4" aria-hidden />
      </button>
    </span>
  );
}

/** "Konrad Kollnig" → "KK"; one word → its first two letters. */
function initialsOf(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
