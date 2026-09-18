"use client";

import * as React from "react";
import { Check, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

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
import {
  SCHEDULE_DAY_LABELS,
  WEEKDAY_DAYS,
  type MailScheduleDay,
} from "@/lib/mail/custom-lists";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { readPauseOptions } from "@/lib/mail/pause-options";
import {
  accountFollowsAllHours,
  accountPauseRow,
  addQuietSuggestion,
  mailPauseOptions,
  mailPauseVerdict,
  mailPauseVerdictForAccount,
  mailPauseVerdictForScope,
  quietHoursForAccount,
  quietHoursLength,
  quietHoursSummary,
  quietSuggestionApplied,
  MAIL_QUIET_SUGGESTIONS,
  type MailPauseState,
  type MailQuietWindow,
} from "@/lib/mail/quiet-hours";
import { cn } from "@/lib/utils";

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
  trigger: React.ReactNode;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [panel, setPanel] = React.useState<"pause" | "quiet">("pause");
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

  const verdict = mailPauseVerdictForScope(state, scope, now);
  const ownPausedUntil = scope
    ? accountPauseRow(state, scope)?.pausedUntil
    : state.pausedUntil;
  const ownPauseActive = Boolean(
    ownPausedUntil && ownPausedUntil > now.getTime()
  );
  const showResume = scope ? ownPauseActive : verdict.paused;
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

  const summary = pauseMenuHoursLine(state, accounts, labels, now, t);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <MailPopoverContent align="end" className="w-[22rem] p-0">
        {panel === "pause" ? (
          <div className="py-1">
            {/* What the panel is about, or what it has already done.
                A sentence rather than the shouted label the other panel
                heads itself with: a label names a thing, and this one says
                how the mailbox stands. */}
            <p className="px-3 py-2 text-xs font-semibold text-stone-500">
              {verdict.paused ? t("pauseFetchingPaused") : t("pauseFetching")}
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
            {/* Paused already: the way out is the first thing offered. */}
            {showResume ? (
              <button
                type="button"
                className="mail-menu-pick flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-teal-800"
                onClick={() => {
                  onResume(scope);
                  setOpen(false);
                }}
              >
                <span className="font-medium">{t("mailResume")}</span>
                {/* Why it is quiet, where a time used to be. The clock here
                    was the end of the pause, beside the one row that ends
                    it now — two answers to the same question, one of them
                    wrong the moment it is pressed. The badge says until
                    when, for anybody who wants to leave it running. */}
                {verdict.reason === "quiet" ? (
                  <span className="text-xs text-stone-500">
                    {t("mailQuietNow")}
                  </span>
                ) : null}
              </button>
            ) : null}
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="mail-menu-pick flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-stone-800"
                onClick={() => {
                  onPause(option.until, scope);
                  setOpen(false);
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
            {showTabs && scope ? (
              <p className="border-t border-stone-100 px-3 py-2 text-xs text-stone-500">
                {t("pauseOneHint", {
                  account: formatAccountChipLabel(scope, labels),
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <QuietHoursPanel
            windows={followsAll && scope ? state.quietHours : scopeWindows}
            account={scope}
            accountLabel={
              scope ? formatAccountChipLabel(scope, labels) : null
            }
            followAll={Boolean(scope) && followsAll}
            onFollowAll={
              scope
                ? (follow) => onFollowAllHours(scope, follow)
                : undefined
            }
            showTabs={showTabs}
            accounts={accounts}
            labels={labels}
            isOutlookAccount={isOutlookAccount}
            selected={scope}
            onSelectScope={setScope}
            quietUntil={quietUntil}
            onBack={() => setPanel("pause")}
            onChange={(windows) => onQuietHoursChange(windows, scope)}
            onDone={() => setOpen(false)}
          />
        )}
      </MailPopoverContent>
    </Popover>
  );
}

/**
 * The standing hours: a card each, days as circles, and a new one folded
 * out where it will sit.
 *
 * Saved as they are edited rather than behind a button — every change here
 * is one press of a circle or one time, and a panel that hoards them until
 * Done is a panel that loses them when it is dismissed.
 */
function QuietHoursPanel({
  windows,
  account,
  accountLabel,
  followAll,
  onFollowAll,
  showTabs,
  accounts,
  labels,
  isOutlookAccount,
  selected,
  onSelectScope,
  quietUntil,
  onBack,
  onChange,
  onDone,
}: {
  windows: MailQuietWindow[];
  account: string | null;
  accountLabel: string | null;
  followAll: boolean;
  onFollowAll?: (follow: boolean) => void;
  showTabs: boolean;
  accounts: string[];
  labels: Map<string, AccountChipLabel>;
  isOutlookAccount: (email: string) => boolean;
  selected: string | null;
  onSelectScope: (scope: string | null) => void;
  quietUntil: Map<string, string>;
  onBack: () => void;
  onChange: (windows: MailQuietWindow[]) => void;
  onDone: () => void;
}) {
  const t = useMailT();
  const [adding, setAdding] = React.useState<MailQuietWindow | null>(null);
  const suggestions = MAIL_QUIET_SUGGESTIONS.filter(
    (suggestion) => !quietSuggestionApplied(windows, suggestion)
  );

  const patch = (index: number, part: Partial<MailQuietWindow>) =>
    onChange(
      windows.map((window, i) => (i === index ? { ...window, ...part } : window))
    );

  return (
    <div className="p-3">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={t("back")}
          className="rounded p-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
          {t("quietHours")}
        </p>
      </div>
      {showTabs ? (
        <div className="mt-2">
          <MailAccountTabs
            accounts={accounts}
            labels={labels}
            isOutlookAccount={isOutlookAccount}
            selected={selected ? [selected] : []}
            onSelect={(emails) => onSelectScope(emails[0] ?? null)}
            selectOnly
            quietUntil={quietUntil}
          />
        </div>
      ) : null}
      <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600">
        {t("quietHoursWhat")}
      </p>
      {account && onFollowAll ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-stone-700">
          <input
            type="checkbox"
            checked={followAll}
            onChange={(e) => onFollowAll(e.target.checked)}
            className="rounded border-stone-300 text-teal-700 focus:ring-teal-600"
          />
          {t("quietHoursFollowAll")}
        </label>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        {followAll && account ? (
          <p className="text-xs text-stone-500">{t("quietHoursUsesAll")}</p>
        ) : null}
        {followAll && account
          ? null
          : windows.map((window, index) => (
          <div key={index} className="rounded-lg bg-stone-50 p-2">
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={window.start}
                onChange={(e) => patch(index, { start: e.target.value })}
                className={quietTimeClass}
              />
              <span className="text-stone-400">–</span>
              <input
                type="time"
                value={window.end}
                onChange={(e) => patch(index, { end: e.target.value })}
                className={quietTimeClass}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-stone-500">
                {quietHoursName(window, t)}
              </span>
              <button
                type="button"
                aria-label={t("quietHoursRemove")}
                title={t("quietHoursRemove")}
                className="shrink-0 rounded p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => onChange(windows.filter((_, i) => i !== index))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <DayCircles
              days={window.days}
              onToggle={(day) =>
                patch(index, { days: toggleDay(window.days, day) })
              }
            />
          </div>
        ))}

        {/* Hours to take rather than hours to invent.
            One press each, and what it comes to is a card like any other,
            there to be changed or thrown away. A suggestion already
            standing is not a suggestion, so it leaves the list. */}
        {followAll && account ? null : suggestions.length ? (
          <div className="pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              {t("quietSuggestions")}
            </p>
            <div className="mt-1.5 flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  title={t("quietSuggestionUse")}
                  className="group flex items-center gap-2 rounded-lg border border-dashed border-stone-300 p-2 text-left hover:border-teal-600/60 hover:bg-teal-50/60"
                  onClick={() => onChange(addQuietSuggestion(windows, suggestion))}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="font-semibold text-stone-900">
                        {suggestion.range}
                      </span>{" "}
                      <span className="text-stone-500">
                        {t(suggestion.nameKey)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-stone-500">
                      {t(suggestion.whenKey)}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-teal-600/60 text-teal-700 group-hover:bg-teal-700 group-hover:text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {followAll && account ? null : adding ? (
          <div className="rounded-lg border-2 border-teal-600/70 p-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-stone-500">{t("mailSleepFrom")}</span>
              <input
                type="time"
                value={adding.start}
                onChange={(e) => setAdding({ ...adding, start: e.target.value })}
                className={quietTimeClass}
              />
              <span className="text-xs text-stone-500">{t("mailSleepTo")}</span>
              <input
                type="time"
                value={adding.end}
                onChange={(e) => setAdding({ ...adding, end: e.target.value })}
                className={quietTimeClass}
              />
            </div>
            <DayCircles
              days={adding.days}
              onToggle={(day) =>
                setAdding({ ...adding, days: toggleDay(adding.days, day) })
              }
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-stone-500">
                {quietHoursName(adding, t)}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="text-xs text-stone-500 hover:text-stone-800"
                  onClick={() => setAdding(null)}
                >
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  disabled={!adding.days.length}
                  className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                  onClick={() => {
                    onChange([...windows, adding]);
                    setAdding(null);
                  }}
                >
                  {t("add")}
                </button>
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="rounded-lg border border-dashed border-teal-600/50 py-2 text-xs font-semibold text-teal-700 hover:bg-teal-50"
            onClick={() =>
              setAdding({ start: "09:00", end: "12:00", days: [...WEEKDAY_DAYS] })
            }
          >
            {accountLabel
              ? t("quietHoursAddFor", { account: accountLabel })
              : t("quietHoursAdd")}
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-md bg-teal-700 px-3 py-1 text-xs font-semibold text-white hover:bg-teal-800"
          onClick={onDone}
        >
          {t("done")}
        </button>
      </div>
    </div>
  );
}

function DayCircles({
  days,
  onToggle,
}: {
  days: MailScheduleDay[];
  onToggle: (day: MailScheduleDay) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {SCHEDULE_DAY_LABELS.map(({ day, label }) => {
        const on = days.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={label}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
              on
                ? "bg-teal-700 text-white"
                : "border border-stone-300 bg-white text-stone-500 hover:border-stone-400"
            )}
            onClick={() => onToggle(day)}
          >
            {label.slice(0, 1)}
          </button>
        );
      })}
    </div>
  );
}

function toggleDay(
  days: MailScheduleDay[],
  day: MailScheduleDay
): MailScheduleDay[] {
  return days.includes(day)
    ? days.filter((d) => d !== day)
    : [...days, day].sort((a, b) => a - b);
}

/** "Weekdays, 3 hours quiet" — what the row comes to, in words. */
function quietHoursName(
  window: MailQuietWindow,
  t: (key: "everyDayShort" | "weekdaysShort" | "weekendsShort" | "quietHoursLong") => string
): string {
  const days = [...window.days].sort((a, b) => a - b);
  const named =
    !days.length
      ? ""
      : days.length === 7
        ? t("everyDayShort")
        : days.join() === "0,1,2,3,4"
          ? t("weekdaysShort")
          : days.join() === "5,6"
            ? t("weekendsShort")
            : days
                .map((day) => SCHEDULE_DAY_LABELS.find((d) => d.day === day)?.label)
                .filter(Boolean)
                .join(" ");
  const hours = quietHoursLength(window);
  const length = hours
    ? mailSay("quietHoursLong", {
        hours: hours % 1 === 0 ? String(hours) : hours.toFixed(1),
      })
    : "";
  return [named, length].filter(Boolean).join(", ");
}

const quietTimeClass =
  "h-7 w-[5.5rem] rounded-md border border-stone-300 bg-white px-1.5 text-sm font-semibold text-stone-900 focus:border-teal-600 focus:outline-none";

/**
 * "All: 22:00–08:00 daily · team: ☾ until Mon 08:00"
 *
 * All's standing hours, then each mailbox that is quiet on its own.
 */
function pauseMenuHoursLine(
  state: MailPauseState,
  accounts: string[],
  labels: Map<string, AccountChipLabel>,
  now: Date,
  t: ReturnType<typeof useMailT>
): string {
  const parts: string[] = [];
  const allHours = quietHoursSummary(
    state.quietHours,
    (key) => t(key),
    SCHEDULE_DAY_LABELS
  );
  if (allHours) parts.push(`${t("tabAll")}: ${allHours}`);
  for (const email of accounts) {
    const row = accountPauseRow(state, email);
    if (!row) continue;
    const local = mailPauseVerdict(
      {
        pausedUntil: row.pausedUntil,
        quietHours: row.quietHours ?? [],
      },
      now
    );
    const name = formatAccountChipLabel(email, labels);
    if (local.paused && local.reason === "pause") {
      const time = local.until
        ? formatSnoozeWakeLabel(local.until.toISOString())
        : local.untilClock;
      if (time) {
        parts.push(`${name}: ☾ ${t("quietUntilTooltip", { time })}`);
      }
      continue;
    }
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
