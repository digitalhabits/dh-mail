"use client";

import * as React from "react";
import { Check, ChevronRight } from "lucide-react";

import { MailAccountTabs } from "@/components/mail/MailAccountTabs";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import {
  formatSnoozeClock,
  formatSnoozeDayTime,
  formatSnoozeWakeLabel,
} from "@/components/mail/SnoozeMenu";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import type { AccountChipLabel } from "@/lib/mail/account-labels";
import { formatAccountChipLabel } from "@/lib/mail/account-labels";
import { SCHEDULE_DAY_LABELS } from "@/lib/mail/custom-lists";
import { useMailT } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";
import { FrictionPanel, QuietHoursPanel, frictionSummary } from "@/components/mail/pause-panels";
import { readPauseOptions } from "@/lib/mail/pause-options";
import type { PauseLock } from "@/lib/mail/pause-lock";
import {
  accountFollowsAllHours,
  accountPauseRow,
  mailPauseOptions,
  mailPauseVerdictForAccount,
  mailPauseVerdictForScope,
  quietHoursForAccount,
  quietHoursSummary,
  type MailPauseState,
  type MailQuietWindow,
} from "@/lib/mail/quiet-hours";

/**
 * Pause the mail, and the hours that pause it every week.
 *
 * Two panels in one popover, the way snoozing a thread is one press and a
 * list. The first is the pause: for an hour, until noon, until Monday —
 * every one of them ending at a time, because a mute with no end is one
 * somebody forgets they set and then wonders where their mail went. The
 * second is the standing version of the same wish, reached from the last
 * row and returned from by the arrow.
 */
export function MailPauseMenu({
  state,
  now,
  accounts,
  labels,
  isOutlookAccount,
  onPause,
  onResume,
  onQuietHoursChange,
  onFollowAllHours,
  onUnpauseWordsChange,
  trigger,
}: {
  state: MailPauseState;
  now: Date;
  accounts: string[];
  labels: Map<string, AccountChipLabel>;
  isOutlookAccount: (email: string) => boolean;
  onPause: (until: number, account?: string | null) => void;
  onResume: (account?: string | null) => void;
  onQuietHoursChange: (
    windows: MailQuietWindow[],
    account?: string | null
  ) => void;
  onFollowAllHours: (account: string, follow: boolean) => void;
  /** Words to type before ending a pause early. 0 is none. */
  onUnpauseWordsChange: (count: number) => void;
  trigger: React.ReactNode;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [panel, setPanel] = React.useState<"pause" | "quiet" | "friction">("pause");
  const unpauseWords = state.unpauseWords ?? 0;
  /**
   * After a pause is set, or a time added to the schedule, while there is
   * friction: a word that ending it early will mean typing.
   */
  const warnFriction = () => {
    if (!unpauseWords) return;
    toast.info(
      unpauseWords === 1
        ? t("pauseFrictionWarningOne")
        : t("pauseFrictionWarning", { count: unpauseWords })
    );
  };
  const [custom, setCustom] = React.useState("");
  /** `null` is All. An address is that mailbox. */
  const [scope, setScope] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPanel("pause");
      setCustom("");
      setScope(null);
    }
  }, [open]);

  const options = React.useMemo(
    () =>
      open
        ? mailPauseOptions(
            new Date(),
            (key) => t(key),
            formatSnoozeClock,
            formatSnoozeDayTime,
            // The reader's own times, from Settings → Snooze & schedule.
            readPauseOptions()
          )
        : [],
    [open, t]
  );

  const scopeWindows = scope
    ? quietHoursForAccount(state, scope)
    : state.quietHours;
  const followsAll = scope ? accountFollowsAllHours(state, scope) : true;
  const showTabs = accounts.length > 1;
  const quietUntil = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const email of accounts) {
      const local = mailPauseVerdictForAccount(state, email, now);
      if (!local.paused) continue;
      const time = local.until
        ? formatSnoozeWakeLabel(local.until.toISOString())
        : local.untilClock;
      if (!time) continue;
      map.set(email.trim().toLowerCase(), t("quietUntilTooltip", { time }));
    }
    return map;
  }, [accounts, now, state, t]);

  /*
    While a pause runs, with words set, a looser schedule or fewer words
    asks for the words first: otherwise the words guard nothing (a tester,
    2026-10-05). The schedule panel is locked while the tab it edits is
    paused; the words while anything is.
  */
  const lockWhen = (paused: boolean): PauseLock | undefined =>
    paused && unpauseWords > 0
      ? { words: unpauseWords }
      : undefined;
  const scheduleLock = lockWhen(mailPauseVerdictForScope(state, scope, now).paused);
  const frictionLock = lockWhen(
    mailPauseVerdictForScope(state, null, now).paused ||
      accounts.some((email) => mailPauseVerdictForAccount(state, email, now).paused)
  );

  const summary = pauseMenuHoursLine(state, accounts, labels, t);
  const pausedNow = pausedNowRows(state, accounts, labels, now);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      {/* From the start of its button, which sits at the left of the list,
          and never flush against the window's edge. */}
      <MailPopoverContent align="start" collisionPadding={12} className="w-[22rem] p-0">
        {panel === "pause" ? (
          <div className="py-1">
            {/* What the panel is about, or what it has already done.
                A sentence rather than the shouted label the other panel
                heads itself with: a label names a thing, and this one says
                how the mailbox stands. */}
            {/* What is paused now comes first, each with its way out. */}
            {pausedNow.length ? (
              <PausedNowSection
                rows={pausedNow}
                onResume={(account) => {
                  onResume(account);
                  setOpen(false);
                }}
              />
            ) : null}
            {/* With more than one mailbox the heading says which one the
                rows below pause: the tab picked, or all of them. */}
            <p className="break-words px-3 py-2 text-xs font-medium text-stone-500">
              {showTabs ? (
                <PauseHeading
                  sentence={t("pauseFetchingFrom")}
                  who={scope ?? t("pauseAllAccounts")}
                />
              ) : pausedNow.length ? (
                t("pauseMore")
              ) : (
                t("pauseFetching")
              )}
            </p>
            {showTabs ? (
              <div className="px-2 pb-1.5">
                <MailAccountTabs
                  accounts={accounts}
                  labels={labels}
                  isOutlookAccount={isOutlookAccount}
                  selected={scope ? [scope] : []}
                  onSelect={(emails) => setScope(emails[0] ?? null)}
                  selectOnly
                  quietUntil={quietUntil}
                />
              </div>
            ) : null}
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="mail-menu-pick flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-stone-800"
                onClick={() => {
                  onPause(option.until, scope);
                  setOpen(false);
                  warnFriction();
                }}
              >
                <span>{option.label}</span>
                <span className="text-xs tabular-nums text-stone-500">
                  {option.detail}
                </span>
              </button>
            ))}
            {/* A time of the reader's own, for the pause none of the rows
                above happens to be. */}
            <label className="flex items-center justify-between gap-2 border-t border-stone-100 px-3 py-2 text-sm text-stone-800">
              <span>{t("pauseUntilTime")}</span>
              <input
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="h-7 w-[11.5rem] rounded-md border border-stone-300 bg-white px-1.5 text-xs text-stone-900 focus:border-teal-600 focus:outline-none"
              />
            </label>
            {custom ? (
              <button
                type="button"
                className="mail-menu-pick flex w-full items-center justify-end gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-700"
                onClick={() => {
                  const at = new Date(custom).getTime();
                  if (!Number.isFinite(at) || at <= Date.now()) return;
                  onPause(at, scope);
                  setOpen(false);
                  warnFriction();
                }}
              >
                <Check className="h-3.5 w-3.5" />
                {t("pauseUntilThen")}
              </button>
            ) : null}
            <button
              type="button"
              className="mail-menu-pick flex w-full items-center justify-between gap-3 border-t border-stone-100 px-3 py-2 text-left"
              onClick={() => setPanel("quiet")}
            >
              <span className="min-w-0">
                <span className="block text-sm text-stone-800">
                  {t("quietHours")}
                </span>
                <span className="block truncate text-xs text-stone-500">
                  {summary || t("quietHoursNone")}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
            </button>
            <button
              type="button"
              className="mail-menu-pick flex w-full items-center justify-between gap-3 border-t border-stone-100 px-3 py-2 text-left"
              onClick={() => setPanel("friction")}
            >
              <span className="min-w-0">
                <span className="block text-sm text-stone-800">
                  {t("pauseFrictionRow")}
                </span>
                <span className="block truncate text-xs text-stone-500">
                  {frictionSummary(unpauseWords, t)}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" />
            </button>
          </div>
        ) : panel === "friction" ? (
          <FrictionPanel
            words={unpauseWords}
            lock={frictionLock}
            onChange={onUnpauseWordsChange}
            onBack={() => setPanel("pause")}
          />
        ) : (
          <QuietHoursPanel
            windows={followsAll && scope ? state.quietHours : scopeWindows}
            allWindows={state.quietHours}
            lock={scheduleLock}
            account={scope}
            accountLabel={
              scope ? formatAccountChipLabel(scope, labels) : null
            }
            followAll={Boolean(scope) && followsAll}
            onFollowAll={
              scope
                ? (follow: boolean) => onFollowAllHours(scope, follow)
                : undefined
            }
            tabs={
              showTabs ? (
                <MailAccountTabs
                  accounts={accounts}
                  labels={labels}
                  isOutlookAccount={isOutlookAccount}
                  selected={scope ? [scope] : []}
                  onSelect={(emails) => setScope(emails[0] ?? null)}
                  selectOnly
                  quietUntil={quietUntil}
                />
              ) : undefined
            }
            onBack={() => setPanel("pause")}
            onChange={(windows: MailQuietWindow[]) => {
              const before = followsAll && scope ? state.quietHours : scopeWindows;
              onQuietHoursChange(windows, scope);
              // A time added, not every edit of one.
              if (windows.length > before.length) warnFriction();
            }}
            onDone={() => setOpen(false)}
          />
        )}
      </MailPopoverContent>
    </Popover>
  );
}

/**
 * "All: 22:00–08:00 daily · team: ☾ until Mon 08:00"
 *
 * All's standing hours, then each mailbox that is quiet on its own.
 */
function pauseMenuHoursLine(
  state: MailPauseState,
  accounts: string[],
  labels: Map<string, AccountChipLabel>,
  t: ReturnType<typeof useMailT>
): string {
  const parts: string[] = [];
  const allHours = quietHoursSummary(
    state.quietHours,
    (key) => t(key),
    SCHEDULE_DAY_LABELS
  );
  if (allHours) parts.push(`${t("tabAll")}: ${allHours}`);
  // Schedules only. A pause is not a schedule: it is in "Paused now", at
  // the top of the menu.
  for (const email of accounts) {
    const row = accountPauseRow(state, email);
    if (!row) continue;
    const name = formatAccountChipLabel(email, labels);
    if (row.quietHours?.length) {
      const hours = quietHoursSummary(
        row.quietHours,
        (key) => t(key),
        SCHEDULE_DAY_LABELS
      );
      if (hours) parts.push(`${name}: ${hours}`);
    }
  }
  return parts.join(" · ");
}

type PausedNowRow = {
  /** null is All. */
  account: string | null;
  label: string;
  until: string;
  /** A pause, which Resume ends; not a mailbox's quiet hours. */
  resumable: boolean;
};

/** What is paused now: All's pause, each mailbox's own, and quiet hours. */
function pausedNowRows(
  state: MailPauseState,
  accounts: string[],
  labels: Map<string, AccountChipLabel>,
  now: Date
): PausedNowRow[] {
  const at = (until: Date | null | undefined, clock?: string | null) =>
    until ? formatSnoozeWakeLabel(until.toISOString()) : clock ?? "";
  const rows: PausedNowRow[] = [];
  if (state.pausedUntil && state.pausedUntil > now.getTime()) {
    rows.push({ account: null, label: "", until: at(new Date(state.pausedUntil)), resumable: true });
    return rows;
  }
  for (const email of accounts) {
    const verdict = mailPauseVerdictForAccount(state, email, now);
    if (!verdict.paused) continue;
    const own = accountPauseRow(state, email)?.pausedUntil;
    rows.push({
      account: email,
      label: formatAccountChipLabel(email, labels),
      until: at(verdict.until, verdict.untilClock),
      resumable: Boolean(own && own > now.getTime()),
    });
  }
  return rows;
}

function PausedNowSection({ rows, onResume }: { rows: PausedNowRow[]; onResume: (account: string | null) => void }) {
  const t = useMailT();
  return (
    <div className="border-b border-stone-100 px-3 pb-2 pt-2.5">
      <p className="pb-1 text-xs font-semibold text-stone-500">{t("pausedNow")}</p>
      {rows.map((row) => (
        <div key={row.account ?? "all"} className="flex items-center justify-between gap-3 py-1 text-sm">
          <span className="min-w-0 truncate text-stone-800">{row.account ? row.label : t("tabAll")}</span>
          <span className="flex shrink-0 items-center gap-3">
            <span className="text-xs tabular-nums text-amber-700">
              {row.resumable ? t("pausedTill", { time: row.until }) : t("quietTill", { time: row.until })}
            </span>
            {row.resumable ? (
              <button
                type="button"
                className="text-xs font-semibold text-teal-700 hover:text-teal-900"
                onClick={() => onResume(row.account)}
              >
                {t("resume")}
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * "Pause fetching new emails from **ulrik@example.org**": the sentence as the
 * language words it, with the mailbox (or "all accounts") in bold where its
 * `{account}` stands, wherever in the sentence that is.
 */
function PauseHeading({ sentence, who }: { sentence: string; who: string }) {
  const at = sentence.indexOf("{account}");
  if (at < 0) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, at)}
      <strong className="font-semibold text-stone-800">{who}</strong>
      {sentence.slice(at + "{account}".length)}
    </>
  );
}
