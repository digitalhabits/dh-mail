"use client";

/**
 * The panels the pause menu opens, and the mailbox menu borrows: the weekly
 * hours (a card each, days as circles) and the friction slider. Each takes
 * its own words, so the same panel can be about pausing the mail or about
 * hiding a mailbox.
 */

import { TIME_FIELD_CLASS } from "@/components/mail/date-time-pick";
import { hideAgainLabel } from "@/lib/mail/mailbox-hide";
import * as React from "react";
import { ChevronLeft, Lock } from "lucide-react";
import { AccountMark } from "@/components/mail/AccountMark";
import { useAccountMarks } from "@/lib/mail/account-mark";
import { mailProviderFor, useIsOutlookAccount } from "@/lib/mail/use-outlook-accounts";
import { LockedChip, LockedSaveBar, RuleText, UnlockBox, WeekChart } from "@/components/mail/hours-editor-parts";
import { DayCircles, HoursRuleCards } from "@/components/mail/hours-rule-cards";

export { DayCircles };

import { SCHEDULE_DAY_LABELS, WEEKDAY_DAYS } from "@/lib/mail/custom-lists";
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import {
  ALWAYS_RULE,
  daysPhrase,
  isAllDay,
  isOvernight,
  keptFromOnHours,
  onHoursFromKept,
  sameWeek,
  type OnHoursWords,
} from "@/lib/mail/account-rhythm";
import { MenuSelect } from "@/components/mail/menu-select";
import { readPauseState, type MailQuietWindow } from "@/lib/mail/quiet-hours";
import { cn } from "@/lib/utils";
import { readHideState } from "@/lib/mail/mailbox-hide";
import { MAIL_PAUSE_KEY } from "@/components/mail/use-mail-pause";
import { MAILBOX_HIDE_KEY } from "@/components/mail/use-mailbox-hide";
import { MAX_UNPAUSE_WORDS, unpauseMinutes } from "@/lib/mail/unpause-friction";
import { frictionLowered, scheduleLoosened, type PauseLock } from "@/lib/mail/pause-lock";

/**
 * The standing hours: a card each, days as circles, and a new one folded
 * out where it will sit.
 *
 * Saved as they are edited rather than behind a button — every change here
 * is one press of a circle or one time, and a panel that hoards them until
 * Done is a panel that loses them when it is dismissed.
 *
 * Except while a lock is on: a change that adds hours waits at the foot,
 * with how much it adds, for Unlock to save (2026-10-18). The week chart
 * shows those hours hatched until then.
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
  /** Hours that add time while the lock is on: kept here until Unlock to save. */
  const [waiting, setWaiting] = React.useState<MailQuietWindow[] | null>(null);
  const keptRef = React.useRef(windows);
  // The hours as last seen from outside: a fresh array of the same hours is
  // not a change, and must not throw away a change waiting for the words.
  const seenRef = React.useRef(windows);
  React.useEffect(() => {
    if (sameWeek(windows, seenRef.current)) return;
    seenRef.current = windows;
    if (!sameWeek(windows, keptRef.current)) {
      setRows(rowsFor(windows));
      setWaiting(null);
    }
    keptRef.current = windows;
  }, [windows]);

  /** Every change goes through here: one that adds hours waits for the words. */
  const keep = (nextKept: MailQuietWindow[], nextRows: MailQuietWindow[]) => {
    keptRef.current = nextKept;
    setRows(nextRows.length ? nextRows : [ALWAYS_RULE]);
    if (locked.active && scheduleLoosened(windows, nextKept)) {
      setWaiting(nextKept);
      return;
    }
    setWaiting(null);
    onChange(nextKept);
  };
  const keepRows = (nextRows: MailQuietWindow[]) => keep(keptFromOnHours(nextRows), nextRows);
  const cancelWaiting = () => {
    keptRef.current = windows;
    setRows(rowsFor(windows));
    setWaiting(null);
  };

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
  // Hours set for another mailbox, for All, or for hiding: offered here too.
  // Read again when the hours change: one saved here is no longer "elsewhere".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elsewhere = React.useMemo(() => storedSchedules(t), [windows, t]);
  // A mailbox's hours carry its mark, as its tab does: "Same as vera" is
  // two mailboxes for someone with vera@ at two places.
  const marks = useAccountMarks();
  const isOutlookAccount = useIsOutlookAccount();
  const markOf = (email: string) => (
    <AccountMark
      mark={marks[email.trim().toLowerCase()]}
      provider={mailProviderFor(email, isOutlookAccount)}
      className="h-3.5 w-3.5"
    />
  );
  const ownHours = !(followAll && account);

  /** One rule in the panel's words: "07:00 – 18:00 · weekdays", "18:00 – 07:00 +1 day · weekdays". */
  const rulePhrase = (window: MailQuietWindow) =>
    `${isAllDay(window) ? words.allDay.toLocaleLowerCase() : `${window.start} – ${window.end}${isOvernight(window) ? ` ${t("hoursPlusDay")}` : ""}`} · ${daysPhrase(window.days, words, SCHEDULE_DAY_LABELS)}`;
  /**
   * What Use offers: the suggestions, then hours set elsewhere, named by
   * where. Use puts them in place of the hours there are. Never the hours
   * standing now, nor one twice. One that adds time while the lock is on
   * carries the lock.
   */
  const offers = (() => {
    const seen = new Set<string>();
    return [
      ...ON_SUGGESTIONS.map((s) => ({ key: s.id, name: t(s.name), email: null as string | null, rules: s.rules })),
      // Not the hours saved here: they are this setting's own, not elsewhere.
      ...elsewhere
        .filter((source) => !sameWeek(source.kept, windows))
        .map((source, i) => ({ key: `elsewhere-${i}`, name: source.name, email: source.email, rules: rowsFor(source.kept) })),
    ].flatMap((offer) => {
      const id = JSON.stringify(keptFromOnHours(offer.rules));
      const nextKept = keptFromOnHours(offer.rules);
      if (seen.has(id) || sameWeek(nextKept, keptFromOnHours(rows))) return [];
      seen.add(id);
      return [{ ...offer, locks: locked.active && scheduleLoosened(windows, nextKept) }];
    });
  })();

  return (
    <div className="p-3">
      <div className="flex items-center gap-1.5 border-b border-stone-100 pb-2">
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
        {hiding ? null : (
          <span className="min-w-0 truncate text-xs text-stone-400">{accountLabel ?? t("hoursAllMailboxes")}</span>
        )}
        {locked.active ? <LockedChip /> : null}
      </div>
      {tabs ? <div className="mt-2">{tabs}</div> : null}

      {/* The week and its hours on the left, the suggestions in a rail on
          the right: one above the other made the panel taller than the
          window (2026-10-18). */}
      <div className={cn("mt-3 grid gap-x-9 gap-y-5", ownHours && offers.length && "sm:grid-cols-[minmax(0,1fr)_14rem]")}>
        <div className="min-w-0">
          {ownHours ? (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">{t("hoursYourWeek")}</p>
              <WeekChart
                saved={windows}
                draft={waiting ?? windows}
                onLabel={t(hiding ? "hoursLegendShown" : "hoursLegendNewMail")}
              />
            </>
          ) : null}
          <p className="mt-2 text-xs leading-relaxed text-stone-600">
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
            {ownHours ? null : <p className="text-xs text-stone-500">{t("quietHoursUsesAll")}</p>}
            {ownHours ? <HoursRuleCards rows={rows} onRows={keepRows} /> : null}
          </div>

            {waiting && lock ? (
              <LockedSaveBar
                words={lock.words}
                hiding={hiding}
                onCancel={cancelWaiting}
                onSave={() => {
                  locked.unlock();
                  setWaiting(null);
                  onChange(waiting);
                }}
              />
            ) : (
              <div className="mt-3 flex items-center justify-end gap-2 border-t border-stone-100 pt-3">
                <button
                  type="button"
                  className="rounded-md bg-[var(--mail-hours-accent)] px-3 py-1 text-xs font-semibold text-white hover:bg-[var(--mail-hours-accent-hover)]"
                  onClick={onDone}
                >
                  {t("done")}
                </button>
              </div>
            )}
        </div>

        {/* Hours to take rather than hours to invent: Use puts them in
            place of the fields. Hours already standing are not offered. */}
        {ownHours && offers.length ? (
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">
              {t("quietSuggestions")}
            </p>
            <div className="mt-1 flex flex-col gap-1">
              {offers.map((offer) => (
                <SuggestionRow
                  key={offer.key}
                  mark={offer.email ? markOf(offer.email) : null}
                  name={offer.name}
                  lines={offer.rules.map(rulePhrase)}
                  action={t("useSuggestion")}
                  locks={offer.locks}
                  onUse={() => keepRows(offer.rules)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The hours offered, as the hours on (2026-10-18). Add puts them with the
 * fields above.
 */
const ON_SUGGESTIONS: { id: string; name: MailStringKey; rules: MailQuietWindow[] }[] = [
  {
    id: "twice",
    name: "quietTwiceADayName",
    rules: [
      { start: "09:00", end: "11:00", days: [...WEEKDAY_DAYS] },
      { start: "15:00", end: "17:00", days: [...WEEKDAY_DAYS] },
    ],
  },
  { id: "work", name: "quietWorkHoursName", rules: [{ start: "08:00", end: "17:00", days: [...WEEKDAY_DAYS] }] },
  { id: "nights", name: "quietNightsName", rules: [{ start: "08:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] }] },
];

/** A suggestion in the rail: its name, its hours a rule a line, and Use — with the lock when it adds time while locked. */
function SuggestionRow({
  mark,
  name,
  lines,
  action,
  locks,
  onUse,
}: {
  /** The mailbox's mark, for hours set on a mailbox. */
  mark: React.ReactNode;
  name: string;
  lines: string[];
  action: string;
  locks: boolean;
  onUse: () => void;
}) {
  return (
    <button
      type="button"
      className="mail-menu-pick flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left"
      onClick={onUse}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-stone-900">
          {mark}
          <span className="truncate">{name}</span>
        </span>
        {lines.map((line) => (
          <span key={line} className="block text-xs tabular-nums text-stone-500">
            {line}
          </span>
        ))}
      </span>
      {locks ? <Lock className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden /> : null}
      <span className="shrink-0 text-sm font-semibold text-[var(--mail-hours-accent)]">{action}</span>
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

/**
 * Every schedule kept on this machine, as kept (the hours off), named by
 * where it is set: new mail's, each mailbox's new mail, and each mailbox's
 * hours shown. "Same as team" for team@….
 */
function storedSchedules(
  t: ReturnType<typeof useMailT>
): { name: string; email: string | null; kept: MailQuietWindow[] }[] {
  const out: { name: string; email: string | null; kept: MailQuietWindow[] }[] = [];
  const sameAs = (email: string) => t("sameAsSource", { name: email.split("@")[0] || email });
  try {
    const pause = readPauseState(JSON.parse(window.localStorage.getItem(MAIL_PAUSE_KEY) ?? "null"));
    out.push({ name: t("sameAsNewMail"), email: null, kept: pause.quietHours });
    for (const [email, a] of Object.entries(pause.accounts ?? {})) out.push({ name: sameAs(email), email, kept: a.quietHours ?? [] });
  } catch {
    /* no storage: nothing to offer */
  }
  try {
    const hide = readHideState(JSON.parse(window.localStorage.getItem(MAILBOX_HIDE_KEY) ?? "null"));
    for (const [email, a] of Object.entries(hide.accounts)) out.push({ name: sameAs(email), email, kept: a.hours ?? [] });
  } catch {
    /* no storage: nothing to offer */
  }
  // A schedule with nothing kept is Always: nothing to add.
  return out.filter((source) => source.kept.some((w) => w.days.length));
}

/** The hours' time boxes: the one time field (date-time-pick). */
export const quietTimeClass = `${TIME_FIELD_CLASS} w-28`;

/** "None", or "Type 5 random words · ~1 min". */
export function frictionSummary(words: number, t: ReturnType<typeof useMailT>): string {
  if (!words) return t("pauseFrictionNone");
  return words === 1
    ? t("pauseFrictionSummaryOne")
    : t("pauseFrictionSummary", { count: words, minutes: unpauseMinutes(words) });
}

export { hideAgainLabel };

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
  rule,
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
  /**
   * How a schedule may change, said once here: less time is free, more asks
   * for the words. In the editor, the lock chip and Unlock to save carry it.
   */
  rule?: string;
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
      {rule ? (
        <div className="mt-3 border-t border-stone-100 pt-3">
          <p className="text-sm text-stone-800">{t("hideRuleTitle")}</p>
          <RuleText text={rule} className="mt-0.5 text-xs leading-relaxed text-stone-600" />
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
  /** The lock is on and not yet opened in this visit. */
  active: boolean;
  /** The words were typed elsewhere in the panel: open it for this visit. */
  unlock: () => void;
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
  return { attempt, box, active, unlock: () => setUnlocked(true) };
}
