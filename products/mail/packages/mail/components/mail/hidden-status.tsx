"use client";

/**
 * How a hidden account stands, said the same everywhere it is said: its
 * tab's hover, the account menu, Settings, and the list when every account
 * is hidden.
 *
 * A closed eye, then when it is shown again: "Shown again at 07:00" today,
 * "Shown again tomorrow 07:00", "Shown again Mon 08:00". Not "Outside its
 * hours": the eye says it is hidden, and the time is what the reader wants
 * (Ulrik, 2026-10-20). Hidden by hand, it waits for the reader.
 */

import { EyeOff } from "lucide-react";

import { formatSnoozeClock, formatSnoozeDayTime } from "@/components/mail/SnoozeMenu";
import { useOnHoursWords } from "@/components/mail/pause-panels";
import { onHoursSummary } from "@/lib/mail/account-rhythm";
import { SCHEDULE_DAY_LABELS } from "@/lib/mail/custom-lists";
import { useMailT } from "@/lib/mail/i18n";
import type { MailboxHideVerdict } from "@/lib/mail/mailbox-hide";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { cn } from "@/lib/utils";

type HiddenStatusOf = MailboxHideVerdict & { byHand?: boolean };

/** When it shows again, in words. */
export function hiddenStatusText(
  status: HiddenStatusOf,
  t: ReturnType<typeof useMailT>,
  now: Date = new Date()
): string {
  if (status.byHand || !status.hidden) return t("hiddenByHand");
  const at = status.reason === "until" ? status.until : (status.endsAt ?? null);
  if (!at) return status.untilClock ? t("hiddenShownAgainAt", { time: status.untilClock }) : t("hiddenNoEnd");
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  if (days <= 0) return t("hiddenShownAgainAt", { time: formatSnoozeClock(at) });
  if (days === 1) return t("hiddenShownAgainTomorrow", { time: formatSnoozeClock(at) });
  return t("hiddenShownAgainOn", { when: formatSnoozeDayTime(at) });
}

/** The closed eye and the words. */
export function HiddenStatus({ status, className }: { status: HiddenStatusOf; className?: string }) {
  const t = useMailT();
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <EyeOff className="h-3.5 w-3.5 shrink-0" aria-label={t("hiddenFromMail")} />
      <span className="truncate">{hiddenStatusText(status, t)}</span>
    </span>
  );
}

/**
 * The hours on, said after "Shown" or "Arrives": "weekdays 07:00 – 18:00",
 * "all day, every day". From what a setting keeps, the hours off.
 */
export function useHoursLine() {
  const t = useMailT();
  const words = useOnHoursWords();
  return (kept: MailQuietWindow[]) => {
    const line = onHoursSummary(kept, words, SCHEDULE_DAY_LABELS) ?? t("rhythmAnswerAlwaysWhat");
    return line.charAt(0).toLocaleLowerCase() + line.slice(1);
  };
}
