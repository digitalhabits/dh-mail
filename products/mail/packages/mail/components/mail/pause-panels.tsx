"use client";

/**
 * The panels the pause menu opens, and the mailbox menu borrows: the weekly
 * hours (a card each, days as circles) and the friction slider. Each takes
 * its own words, so the same panel can be about pausing the mail or about
 * hiding a mailbox.
 */

import * as React from "react";
import { ChevronLeft, Plus, X } from "lucide-react";

import {
  SCHEDULE_DAY_LABELS,
  WEEKDAY_DAYS,
  type MailScheduleDay,
} from "@/lib/mail/custom-lists";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import {
  addQuietSuggestion,
  quietHoursFromElsewhere,
  quietHoursLength,
  quietSuggestionApplied,
  readPauseState,
  MAIL_QUIET_SUGGESTIONS,
  type MailQuietWindow,
} from "@/lib/mail/quiet-hours";
import { cn } from "@/lib/utils";
import { readHideState } from "@/lib/mail/mailbox-hide";
import { MAIL_PAUSE_KEY } from "@/components/mail/use-mail-pause";
import { MAILBOX_HIDE_KEY } from "@/components/mail/use-mailbox-hide";
import { MAX_UNPAUSE_WORDS, randomUnpauseWords, unpauseMinutes } from "@/lib/mail/unpause-friction";
import { frictionLowered, scheduleLoosened, type PauseLock } from "@/lib/mail/pause-lock";
import { ChallengeTyping } from "@/components/mail/UnpauseChallenge";

/**
 * The standing hours: a card each, days as circles, and a new one folded
 * out where it will sit.
 *
 * Saved as they are edited rather than behind a button — every change here
 * is one press of a circle or one time, and a panel that hoards them until
 * Done is a panel that loses them when it is dismissed.
 */
export function QuietHoursPanel({
  hiding = false,
  windows,
  allWindows,
  lock,
  account,
  accountLabel,
  followAll,
  onFollowAll,
  tabs,
  title,
  what,
  onBack,
  onChange,
  onDone,
}: {
  /**
   * The panel is about hiding a mailbox, not pausing mail: its words say
   * so, for a reader who could not tell whether the hours set were the
   * ones it shows or the ones it is hidden.
   */
  hiding?: boolean;
  windows: MailQuietWindow[];
  /** All's hours, for a mailbox that may follow them or stop following. */
  allWindows?: MailQuietWindow[];
  /** While a pause runs: looser changes wait for the words (pause-lock.ts). */
  lock?: PauseLock;
  account: string | null;
  accountLabel: string | null;
  followAll: boolean;
  onFollowAll?: (follow: boolean) => void;
  /** The row of account tabs above the hours, when there is one. */
  tabs?: React.ReactNode;
  /** The heading; "Schedule" when not given. */
  title?: string;
  /** What the hours do; the pause's words when not given. */
  what?: string;
  onBack: () => void;
  onChange: (windows: MailQuietWindow[]) => void;
  onDone: () => void;
}) {
  const t = useMailT();
  const locked = useLockedEdits(lock);
  /** Every change goes through here: a looser one waits for the words. */
  const change = (next: MailQuietWindow[]) =>
    locked.attempt(scheduleLoosened(windows, next), () => onChange(next));
  const toggleFollowAll = onFollowAll
    ? (follow: boolean) =>
        locked.attempt(
          follow
            ? scheduleLoosened(windows, allWindows ?? [])
            : // Its own hours start empty: none, until some are added.
              scheduleLoosened(windows, []),
          () => onFollowAll(follow)
        )
    : undefined;
  const [adding, setAdding] = React.useState<MailQuietWindow | null>(null);
  const suggestions = MAIL_QUIET_SUGGESTIONS.filter(
    (suggestion) => !quietSuggestionApplied(windows, suggestion)
  );
  // Hours set for another mailbox, for All, or for hiding: offered here too.
  const elsewhere = React.useMemo(() => quietHoursFromElsewhere(storedQuietHours(), windows), [windows]);

  const patch = (index: number, part: Partial<MailQuietWindow>) =>
    change(
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
          {title ?? t("quietHours")}
        </p>
      </div>
      {tabs ? <div className="mt-2">{tabs}</div> : null}
      <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600">
        {what ?? t("quietHoursWhat")}
      </p>
      {locked.box}
      {account && toggleFollowAll ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-stone-700">
          <input
            type="checkbox"
            checked={followAll}
            onChange={(e) => toggleFollowAll(e.target.checked)}
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
                {quietHoursName(window, t, hiding)}
              </span>
              <button
                type="button"
                aria-label={t("quietHoursRemove")}
                title={t("quietHoursRemove")}
                className="shrink-0 rounded p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => change(windows.filter((_, i) => i !== index))}
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
        {followAll && account ? null : suggestions.length || elsewhere.length ? (
          <div className="pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              {t(hiding ? "hideSuggestions" : "quietSuggestions")}
            </p>
            <div className="mt-1.5 flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  title={t(hiding ? "hideSuggestionUse" : "quietSuggestionUse")}
                  className="group flex items-center gap-2 rounded-lg border border-dashed border-stone-300 p-2 text-left hover:border-teal-600/60 hover:bg-teal-50/60"
                  onClick={() => change(addQuietSuggestion(windows, suggestion))}
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
              {elsewhere.map((window) => (
                <button
                  key={`${window.start}-${window.end}-${window.days.join()}`}
                  type="button"
                  title={t(hiding ? "hideSuggestionUse" : "quietSuggestionUse")}
                  className="group flex items-center gap-2 rounded-lg border border-dashed border-stone-300 p-2 text-left hover:border-teal-600/60 hover:bg-teal-50/60"
                  onClick={() => change([...windows, window])}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      <span className="font-semibold text-stone-900">
                        {window.start} – {window.end}
                      </span>{" "}
                      <span className="text-stone-500">{t("quietSetElsewhere")}</span>
                    </span>
                    <span className="block truncate text-xs text-stone-500">{quietHoursName(window, t, hiding)}</span>
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
                    change([...windows, adding]);
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
              : t(hiding ? "hideHoursAdd" : "quietHoursAdd")}
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

/** Every schedule kept on this machine: the pause's, All's and each mailbox's, and the hiding ones. */
function storedQuietHours(): MailQuietWindow[] {
  const out: MailQuietWindow[] = [];
  try {
    const pause = readPauseState(JSON.parse(window.localStorage.getItem(MAIL_PAUSE_KEY) ?? "null"));
    out.push(...pause.quietHours, ...Object.values(pause.accounts ?? {}).flatMap((a) => a.quietHours ?? []));
  } catch {
    /* no storage: nothing to offer */
  }
  try {
    const hide = readHideState(JSON.parse(window.localStorage.getItem(MAILBOX_HIDE_KEY) ?? "null"));
    out.push(...Object.values(hide.accounts).flatMap((a) => a.hours ?? []));
  } catch {
    /* no storage: nothing to offer */
  }
  return out;
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
  t: (key: "everyDayShort" | "weekdaysShort" | "weekendsShort" | "quietHoursLong") => string,
  /** For hiding a mailbox: "3 hours hidden", not quiet. */
  hiding = false
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
    ? mailSay(hiding ? "hiddenHoursLong" : "quietHoursLong", {
        hours: hours % 1 === 0 ? String(hours) : hours.toFixed(1),
      })
    : "";
  return [named, length].filter(Boolean).join(", ");
}

const quietTimeClass =
  "h-7 w-[5.5rem] rounded-md border border-stone-300 bg-white px-1.5 text-sm font-semibold text-stone-900 focus:border-teal-600 focus:outline-none";

/** "None", or "Type 5 random words · ~1 min". */
export function frictionSummary(words: number, t: ReturnType<typeof useMailT>): string {
  if (!words) return t("pauseFrictionNone");
  return words === 1
    ? t("pauseFrictionSummaryOne")
    : t("pauseFrictionSummary", { count: words, minutes: unpauseMinutes(words) });
}

/**
 * Friction to start fetching again: how many random words ending a pause
 * early asks for. 0, the default, is none. See UnpauseChallenge.
 */
export function FrictionPanel({
  words,
  lock,
  onChange,
  onBack,
  title,
  explain,
}: {
  words: number;
  /** While a pause runs: fewer words wait for the words (pause-lock.ts). */
  lock?: PauseLock;
  onChange: (count: number) => void;
  onBack: () => void;
  /** The heading and the explanation; the pause's when not given. */
  title?: string;
  explain?: string;
}) {
  const t = useMailT();
  const locked = useLockedEdits(lock);
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
          {title ?? t("pauseFrictionTitle")}
        </p>
      </div>
      <p className="mt-2 border-t border-stone-100 pt-2 text-xs leading-relaxed text-stone-600">
        {explain ?? t("pauseFrictionExplain")}
      </p>
      {locked.box}
      <label className="mt-3 block">
        <span className="flex items-baseline justify-between gap-2 text-sm text-stone-800">
          <span>{t("pauseFrictionHowMany")}</span>
          <span className="text-xs tabular-nums text-teal-700">
            {words ? `${words} · ~${unpauseMinutes(words)} min` : t("pauseFrictionOff")}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={MAX_UNPAUSE_WORDS}
          step={1}
          value={words}
          onChange={(e) => {
            const next = Number(e.target.value);
            locked.attempt(frictionLowered(words, next), () => onChange(next));
          }}
          className="mt-2 w-full accent-teal-700"
        />
      </label>
    </div>
  );
}

/**
 * Holding back a looser change while a pause runs: the words to type, in
 * the panel itself rather than a dialog
 * over the menu (a dialog takes the focus, and the menu closes behind it).
 *
 * Once the words are typed, the change goes through, and the panel stays
 * open for more: the reader has paid for this visit. Leaving the panel locks
 * it again.
 */
function useLockedEdits(lock: PauseLock | undefined): {
  attempt: (loosens: boolean, apply: () => void) => void;
  box: React.ReactNode;
} {
  const [unlocked, setUnlocked] = React.useState(false);
  const [pending, setPending] = React.useState<(() => void) | null>(null);
  const active = Boolean(lock && lock.words > 0 && !unlocked);
  const attempt = (loosens: boolean, apply: () => void) => {
    if (!active || !loosens) {
      // Another change, made at once, drops the one waiting: that one was
      // worked out from the hours as they were, and made later it would
      // undo this one.
      setPending(null);
      apply();
      return;
    }
    // The latest looser change is the one made once the words are typed.
    setPending(() => apply);
  };
  const box =
    active && pending ? (
      <UnlockBox
        words={lock!.words}
        onUnlocked={() => {
          setUnlocked(true);
          setPending(null);
          pending();
        }}
        onCancel={() => setPending(null)}
      />
    ) : null;
  return { attempt, box };
}

function UnlockBox({
  words,
  onUnlocked,
  onCancel,
}: {
  words: number;
  onUnlocked: () => void;
  onCancel: () => void;
}) {
  const t = useMailT();
  const [target] = React.useState(() => randomUnpauseWords(words));
  const [typed, setTyped] = React.useState("");
  const done = typed === target;
  return (
    <div className="mt-2 rounded-lg border border-stone-200 bg-white p-2.5">
      <p className="text-xs text-stone-700">{t("pauseLockAsk")}</p>
      <ChallengeTyping
        target={target}
        typed={typed}
        onTyped={setTyped}
        label={t("pauseLockAsk")}
        rows={2}
        onEnter={() => {
          if (done) onUnlocked();
        }}
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-md px-2.5 py-1 text-xs text-stone-500 hover:bg-stone-100"
          onClick={onCancel}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          disabled={!done}
          className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          onClick={onUnlocked}
        >
          {t("pauseLockConfirm")}
        </button>
      </div>
    </div>
  );
}
