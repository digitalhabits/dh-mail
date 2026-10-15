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
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import {
  ALWAYS_RULE,
  daysPhrase,
  isAllDay,
  isOvernight,
  keptCovers,
  keptFromOnHours,
  onHoursFromKept,
  onRulePhrase,
  sameWeek,
  type OnHoursWords,
} from "@/lib/mail/account-rhythm";
import { MenuSelect } from "@/components/mail/menu-select";
import {
  addQuietSuggestion,
  quietHoursFromElsewhere,
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
   * The panel is about when a mailbox is shown, not when new mail arrives:
   * its words say so.
   */
  hiding?: boolean;
  /**
   * What the setting keeps: the hours it is off (hidden, or nothing
   * fetched). The panel shows and edits the hours it is on, and hands back
   * what to keep — see `onHoursFromKept` in account-rhythm.ts.
   */
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
  /** The heading; "New mail arrives" or "Shown in Mail" when not given. */
  title?: string;
  /** What the hours mean; the setting's own words when not given. */
  what?: string;
  onBack: () => void;
  onChange: (windows: MailQuietWindow[]) => void;
  onDone: () => void;
}) {
  const t = useMailT();
  const locked = useLockedEdits(lock);
  const words = useOnHoursWords();
  /*
    The rules as the reader wrote them, kept while the panel is open. What
    is saved is derived from them, and read back only when it changes from
    outside — a suggestion, All's hours, another window — so a rule being
    typed is not rewritten under the caret.
  */
  const rowsFor = (kept: MailQuietWindow[]) => {
    const on = onHoursFromKept(kept);
    return on.length ? on : [ALWAYS_RULE];
  };
  const [rows, setRows] = React.useState<MailQuietWindow[]>(() => rowsFor(windows));
  const keptRef = React.useRef(windows);
  React.useEffect(() => {
    if (!sameWeek(windows, keptRef.current)) setRows(rowsFor(windows));
    keptRef.current = windows;
  }, [windows]);

  /** Every change goes through here: a looser one waits for the words. */
  const keep = (nextKept: MailQuietWindow[], nextRows: MailQuietWindow[]) =>
    locked.attempt(scheduleLoosened(windows, nextKept), () => {
      keptRef.current = nextKept;
      setRows(nextRows.length ? nextRows : [ALWAYS_RULE]);
      onChange(nextKept);
    });
  const keepRows = (nextRows: MailQuietWindow[]) => keep(keptFromOnHours(nextRows), nextRows);
  const keepKept = (nextKept: MailQuietWindow[]) => keep(nextKept, rowsFor(nextKept));

  const toggleFollowAll = onFollowAll
    ? (follow: boolean) =>
        locked.attempt(
          follow
            ? scheduleLoosened(windows, allWindows ?? [])
            : // Its own hours start as always, until some are set.
              scheduleLoosened(windows, []),
          () => onFollowAll(follow)
        )
    : undefined;
  const [adding, setAdding] = React.useState<MailQuietWindow | null>(null);
  const suggestions = MAIL_QUIET_SUGGESTIONS.filter((suggestion) => !keptCovers(windows, suggestion.windows));
  // Hours set for another mailbox, for All, or for hiding: offered here too.
  const elsewhere = React.useMemo(() => quietHoursFromElsewhere(storedQuietHours(), windows), [windows]);
  /** Only the one rule that means always: nothing to take away. */
  const alwaysOnly = rows.length === 1 && isAllDay(rows[0]) && rows[0].days.length === 7;
  const lineKey = hiding ? "hoursShownLine" : "hoursNewMailLine";

  const patch = (index: number, part: Partial<MailQuietWindow>) =>
    keepRows(rows.map((window, i) => (i === index ? { ...window, ...part } : window)));
  const note = (window: MailQuietWindow) =>
    isAllDay(window) ? words.allDay : isOvernight(window) ? words.nextDay : "";

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
          {title ?? t(hiding ? "hoursShownTitle" : "hoursNewMailTitle")}
        </p>
      </div>
      {tabs ? <div className="mt-2">{tabs}</div> : null}
      <p className="mt-2 border-t border-stone-100 pt-2 text-xs text-stone-600">
        {what ?? t(hiding ? "hideScheduleWhat" : "quietHoursWhat")}
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
          : rows.map((window, index) => (
          <div key={index} className="rounded-lg bg-stone-50 p-2">
            <div className="flex items-center gap-2">
              <input
                type="time"
                aria-label={t("rhythmFrom")}
                value={window.start}
                onChange={(e) => patch(index, { start: e.target.value })}
                className={quietTimeClass}
              />
              <span className="text-stone-400">–</span>
              <input
                type="time"
                aria-label={t("rhythmTo")}
                value={window.end}
                onChange={(e) => patch(index, { end: e.target.value })}
                className={quietTimeClass}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-stone-500">{note(window)}</span>
              {alwaysOnly ? null : (
                <button
                  type="button"
                  aria-label={t("rhythmRemoveHours")}
                  title={t("rhythmRemoveHours")}
                  className="shrink-0 rounded p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                  onClick={() => keepRows(rows.filter((_, i) => i !== index))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <DayCircles days={window.days} onToggle={(day) => patch(index, { days: toggleDay(window.days, day) })} />
          </div>
        ))}

        {/* Hours to take rather than hours to invent. One press each; a
            suggestion already standing is not a suggestion, so it leaves. */}
        {followAll && account ? null : suggestions.length || elsewhere.length ? (
          <div className="pt-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              {t("quietSuggestions")}
            </p>
            <div className="mt-1.5 flex flex-col gap-2">
              {suggestions.map((suggestion) => (
                <SuggestionCard
                  key={suggestion.id}
                  name={t(SUGGESTION_WORDS[suggestion.id].name)}
                  line={t(lineKey, { hours: t(SUGGESTION_WORDS[suggestion.id].on) })}
                  onAdd={() => keepKept(addQuietSuggestion(windows, suggestion))}
                />
              ))}
              {elsewhere.map((window) => (
                <SuggestionCard
                  key={`${window.start}-${window.end}-${window.days.join()}`}
                  name={t("quietSetElsewhere")}
                  line={t(lineKey, {
                    hours: t("hoursExcept", {
                      hours: `${window.start} – ${window.end}${isOvernight(window) ? ` ${words.nextDay}` : ""}`,
                      days: daysPhrase(window.days, words, SCHEDULE_DAY_LABELS),
                    }),
                  })}
                  onAdd={() => keepKept([...windows, window])}
                />
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
            <DayCircles days={adding.days} onToggle={(day) => setAdding({ ...adding, days: toggleDay(adding.days, day) })} />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-stone-500">
                {adding.days.length ? onRulePhrase(adding, words, SCHEDULE_DAY_LABELS) : ""}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <button type="button" className="text-xs text-stone-500 hover:text-stone-800" onClick={() => setAdding(null)}>
                  {t("cancel")}
                </button>
                <button
                  type="button"
                  disabled={!adding.days.length}
                  className="rounded-md bg-teal-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                  onClick={() => {
                    // Hours added to "always" are the hours now, not more of always.
                    keepRows(alwaysOnly ? [adding] : [...rows, adding]);
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
            onClick={() => setAdding({ start: "08:00", end: "17:00", days: [...WEEKDAY_DAYS] })}
          >
            {accountLabel ? t("quietHoursAddFor", { account: accountLabel }) : t("quietHoursAdd")}
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

/** Each suggestion's name, and its hours said as the hours on. */
const SUGGESTION_WORDS: Record<string, { name: MailStringKey; on: MailStringKey }> = {
  nights: { name: "quietNightsName", on: "quietNightsOn" },
  worklife: { name: "quietWorkLifeName", on: "quietWorkLifeOn" },
  mornings: { name: "quietFocusMorningsName", on: "quietFocusMorningsOn" },
  weekend: { name: "quietWeekendsOffName", on: "quietWeekendsOffOn" },
};

function SuggestionCard({ name, line, onAdd }: { name: string; line: string; onAdd: () => void }) {
  const t = useMailT();
  return (
    <button
      type="button"
      title={t("quietSuggestionUse")}
      className="group flex items-center gap-2 rounded-lg border border-dashed border-stone-300 p-2 text-left hover:border-teal-600/60 hover:bg-teal-50/60"
      onClick={onAdd}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-stone-900">{name}</span>
        <span className="block text-xs text-stone-500">{line}</span>
      </span>
      <span
        aria-hidden
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-teal-600/60 text-teal-700 group-hover:bg-teal-700 group-hover:text-white"
      >
        <Plus className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

/** The words a rule is said in, in the reader's language. */
export function useOnHoursWords(): OnHoursWords {
  const t = useMailT();
  return React.useMemo(
    () => ({
      allDay: t("hoursAllDay"),
      nextDay: t("hoursNextDay"),
      daily: t("everyDayShort"),
      weekdays: t("weekdaysShort"),
      weekends: t("weekendsShort"),
    }),
    [t]
  );
}

export function DayCircles({
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

export const quietTimeClass =
  "h-7 w-[5.5rem] rounded-md border border-stone-300 bg-white px-1.5 text-sm font-semibold text-stone-900 focus:border-teal-600 focus:outline-none";

/** "None", or "Type 5 random words · ~1 min". */
export function frictionSummary(words: number, t: ReturnType<typeof useMailT>): string {
  if (!words) return t("pauseFrictionNone");
  return words === 1
    ? t("pauseFrictionSummaryOne")
    : t("pauseFrictionSummary", { count: words, minutes: unpauseMinutes(words) });
}

/** A "Hide again after" length in words: Never, 15 minutes, 1 hour, 8 hours. */
export function hideAgainLabel(minutes: number, t: ReturnType<typeof useMailT>): string {
  if (minutes === 0) return t("hideAgainNever");
  if (minutes < 60) return t("hideAgainMinutes", { count: minutes });
  if (minutes === 60) return t("hideAgainOneHour");
  return t("hideAgainHours", { count: minutes / 60 });
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
  after,
}: {
  words: number;
  /** While a pause runs: fewer words wait for the words (pause-lock.ts). */
  lock?: PauseLock;
  onChange: (count: number) => void;
  onBack: () => void;
  /** The heading and the explanation; the pause's when not given. */
  title?: string;
  explain?: string;
  /**
   * "Hide again after", under the words: a mailbox's panel has it, the
   * pause's does not. Minutes, 0 for Never. A longer time, or Never, is a
   * looser setting, held back like fewer words while a lock is on.
   */
  after?: { minutes: number; options: readonly number[]; onChange: (minutes: number) => void };
}) {
  const t = useMailT();
  const locked = useLockedEdits(lock);
  const afterLabel = (minutes: number) => hideAgainLabel(minutes, t);
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
      {after ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <span className="min-w-0">
            <span className="block text-sm text-stone-800">{t("hideAgainAfter")}</span>
            <span className="block text-xs leading-relaxed text-stone-500">{t("hideAgainHint")}</span>
          </span>
          <MenuSelect
            ariaLabel={t("hideAgainAfter")}
            value={after.minutes}
            options={after.options.map((minutes) => ({ value: minutes, label: afterLabel(minutes) }))}
            onChange={(next) => {
              const looser = next === 0 ? after.minutes !== 0 : after.minutes !== 0 && next > after.minutes;
              locked.attempt(looser, () => after.onChange(next));
            }}
            className="shrink-0"
          />
        </div>
      ) : null}
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
