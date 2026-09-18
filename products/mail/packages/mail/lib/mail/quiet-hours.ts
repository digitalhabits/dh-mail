import {
  EVERY_DAY,
  isScheduleActiveNow,
  type MailScheduleDay,
} from "@/lib/mail/custom-lists";
import { defaultPauseOptions, type PauseOptionWord } from "@/lib/mail/pause-options";
import { resolveOptions, type TimedOption } from "@/lib/mail/timed-options";

/**
 * Pausing the mail, and the quiet hours that pause it by themselves.
 *
 * New mail arriving all morning is new mail deciding what the morning is
 * about. This is the mute: nothing is fetched, the inbox holds what it
 * held, and it says until when.
 *
 * Two ways in. A pause is a decision about the next hour or two, taken now
 * and ending at a time — the same shape as snoozing a thread, which is the
 * same wish about one letter. Quiet hours are the standing version: the
 * night, the mornings kept clear, whatever the week is shaped like.
 *
 * Nothing is lost by either. The mail is at the provider anyway; what
 * changes is when this window goes and asks.
 *
 * No React here, and no storage: the rules are the part a suite reads.
 */

export type MailQuietWindow = {
  /** "HH:MM" in the reader's own day. */
  start: string;
  /** "HH:MM", and earlier than the start when the window crosses midnight. */
  end: string;
  days: MailScheduleDay[];
};

export type MailPauseState = {
  /**
   * Paused until this moment, in epoch milliseconds. Absent when it is not.
   *
   * A time rather than a flag: a mute with no end is one somebody forgets
   * they set, and then wonders for a week where their mail went.
   *
   * This is All: every mailbox. One mailbox has its own row in `accounts`.
   */
  pausedUntil?: number;
  /** The hours that pause it every week. Empty when the reader set none. */
  quietHours: MailQuietWindow[];
  /**
   * One mailbox's own pause and hours, keyed by the address in lower case.
   *
   * Missing hours on a row means that mailbox uses All's hours. An empty
   * list means it has its own schedule, and that schedule is none.
   */
  accounts?: Record<string, MailAccountPause>;
};

/** What one mailbox holds on top of All. */
export type MailAccountPause = {
  pausedUntil?: number;
  quietHours?: MailQuietWindow[];
};

export const MAIL_PAUSE_DEFAULT: MailPauseState = { quietHours: [] };

/** The key a mailbox is stored under. */
export function pauseAccountKey(email: string): string {
  return email.trim().toLowerCase();
}

/** The row for one mailbox, if it has one. */
export function accountPauseRow(
  state: MailPauseState,
  email: string
): MailAccountPause | undefined {
  return state.accounts?.[pauseAccountKey(email)];
}

/**
 * The hours that apply to this mailbox.
 *
 * Its own list, when it has one. All's hours when it does not, so a night
 * set on All is a night on every mailbox until one of them says otherwise.
 */
export function quietHoursForAccount(
  state: MailPauseState,
  email: string
): MailQuietWindow[] {
  const row = accountPauseRow(state, email);
  return row?.quietHours ?? state.quietHours;
}

/** True when this mailbox has not set hours of its own. */
export function accountFollowsAllHours(
  state: MailPauseState,
  email: string
): boolean {
  return accountPauseRow(state, email)?.quietHours == null;
}

/** Minutes since midnight, or null when it is not a clock time. */
export function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatClock(minutes: number): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(
    whole % 60
  ).padStart(2, "0")}`;
}

/**
 * Is `now` inside the window?
 *
 * A window that ends before it starts is a night: 22:00 to 08:00 is ten
 * hours across midnight, not fourteen hours of daylight. Start and end
 * equal is nothing at all rather than everything — a reader who has not
 * finished typing a time should not find the mail stopped.
 */
export function withinWindow(nowMinutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return nowMinutes >= start && nowMinutes < end;
  return nowMinutes >= start || nowMinutes < end;
}

/** Minutes since midnight, from a clock. */
export function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

export type MailPauseVerdict = {
  paused: boolean;
  /** What decided it: the pause the reader set, or the standing hours. */
  reason: "pause" | "quiet" | null;
  /** When mail starts arriving again. A Date for a pause, "HH:MM" for hours. */
  until: Date | null;
  untilClock: string | null;
};

/**
 * Is the mail paused, and until when?
 *
 * A pause the reader set wins while it lasts: they meant it now, whatever
 * the hours say. When it runs out the hours are asked, so a pause that ends
 * inside the night does not start the mail up in the night.
 */
export function mailPauseVerdict(
  state: MailPauseState,
  now: Date
): MailPauseVerdict {
  if (state.pausedUntil && state.pausedUntil > now.getTime()) {
    const until = new Date(state.pausedUntil);
    return {
      paused: true,
      reason: "pause",
      until,
      untilClock: formatClock(minutesOfDay(until)),
    };
  }
  /*
    Inside any of them is quiet, and the one ending last says when it ends:
    two that overlap — the night, and a morning kept clear — are one quiet,
    and starting up at the end of the first would be starting up in the
    middle of the second.
  */
  const ends = state.quietHours
    .filter((window) =>
      isScheduleActiveNow(
        { enabled: true, from: window.start, to: window.end, days: window.days },
        now
      )
    )
    .map((window) => parseClock(window.end))
    .filter((end): end is number => end != null);
  if (!ends.length) {
    return { paused: false, reason: null, until: null, untilClock: null };
  }
  const nowMinutes = minutesOfDay(now);
  const latest = ends.reduce((furthest, end) => {
    const until = (end - nowMinutes + 1440) % 1440;
    const best = (furthest - nowMinutes + 1440) % 1440;
    return until > best ? end : furthest;
  }, ends[0]);
  return {
    paused: true,
    reason: "quiet",
    until: null,
    untilClock: formatClock(latest),
  };
}

/**
 * Is this mailbox fetching, and until when?
 *
 * All's pause covers every mailbox: a mute on All is a mute here too. A
 * pause on the mailbox itself is asked next. Hours come last, and a
 * mailbox with no hours of its own uses All's.
 */
export function mailPauseVerdictForAccount(
  state: MailPauseState,
  email: string,
  now: Date
): MailPauseVerdict {
  const allPause = mailPauseVerdict(
    { pausedUntil: state.pausedUntil, quietHours: [] },
    now
  );
  if (allPause.paused) return allPause;
  const row = accountPauseRow(state, email);
  return mailPauseVerdict(
    {
      pausedUntil: row?.pausedUntil,
      quietHours: row?.quietHours ?? state.quietHours,
    },
    now
  );
}

/**
 * The verdict for the tab the reader has open in the pause menu.
 *
 * `null` is All: only All's own pause and hours, not a mix of mailboxes.
 * An address is that mailbox, with All's pause laid over it.
 */
export function mailPauseVerdictForScope(
  state: MailPauseState,
  scope: string | null,
  now: Date
): MailPauseVerdict {
  if (!scope) {
    return mailPauseVerdict(
      { pausedUntil: state.pausedUntil, quietHours: state.quietHours },
      now
    );
  }
  return mailPauseVerdictForAccount(state, scope, now);
}

/** Addresses that are still allowed to fetch. */
export function fetchingAccounts(
  state: MailPauseState,
  accounts: readonly string[],
  now: Date
): string[] {
  return accounts.filter(
    (email) => !mailPauseVerdictForAccount(state, email, now).paused
  );
}

export type MailPauseChip = {
  paused: boolean;
  /** All is paused, or All's hours are on. The chip does not name a mailbox. */
  global: boolean;
  /** The one mailbox the chip names, when only that one is quiet. */
  account: string | null;
  until: Date | null;
  untilClock: string | null;
};

/**
 * What the pill beside search says.
 *
 * All's own mute is named as quiet, with no mailbox. One mailbox paused on
 * its own is named. Two or more, without All, is quiet again — the menu
 * is where the list of who lives.
 */
export function mailPauseChip(
  state: MailPauseState,
  accounts: readonly string[],
  now: Date
): MailPauseChip {
  const all = mailPauseVerdict(
    { pausedUntil: state.pausedUntil, quietHours: state.quietHours },
    now
  );
  if (all.paused) {
    return {
      paused: true,
      global: true,
      account: null,
      until: all.until,
      untilClock: all.untilClock,
    };
  }
  const quieted = accounts.filter((email) => {
    const row = accountPauseRow(state, email);
    return mailPauseVerdict(
      {
        pausedUntil: row?.pausedUntil,
        quietHours: row?.quietHours ?? [],
      },
      now
    ).paused;
  });
  if (quieted.length === 1) {
    const row = accountPauseRow(state, quieted[0]);
    const local = mailPauseVerdict(
      {
        pausedUntil: row?.pausedUntil,
        quietHours: row?.quietHours ?? [],
      },
      now
    );
    return {
      paused: true,
      global: false,
      account: quieted[0],
      until: local.until,
      untilClock: local.untilClock,
    };
  }
  if (quieted.length > 1) {
    const first = mailPauseVerdict(
      {
        pausedUntil: accountPauseRow(state, quieted[0])?.pausedUntil,
        quietHours: accountPauseRow(state, quieted[0])?.quietHours ?? [],
      },
      now
    );
    return {
      paused: true,
      global: true,
      account: null,
      until: first.until,
      untilClock: first.untilClock,
    };
  }
  return {
    paused: false,
    global: false,
    account: null,
    until: null,
    untilClock: null,
  };
}

/** How long a stretch of quiet hours runs, for the line under a row. */
export function quietHoursLength(window: MailQuietWindow): number {
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  if (start == null || end == null) return 0;
  return ((end - start + 1440) % 1440) / 60;
}

/**
 * What a stored value means, whatever is in the store — including the two
 * shapes from before this was a pause with an end and hours with days.
 */
export function readPauseState(raw: unknown): MailPauseState {
  if (!raw || typeof raw !== "object") return MAIL_PAUSE_DEFAULT;
  const value = raw as {
    paused?: unknown;
    pausedUntil?: unknown;
    quietHours?: unknown;
    windows?: unknown;
    schedule?: { start?: unknown; end?: unknown } | null;
  };
  const quietHours: MailQuietWindow[] = [];
  const take = (start: unknown, end: unknown, days: unknown) => {
    if (typeof start !== "string" || typeof end !== "string") return;
    if (parseClock(start) == null || parseClock(end) == null) return;
    const named = Array.isArray(days)
      ? days.filter((d): d is MailScheduleDay =>
          [0, 1, 2, 3, 4, 5, 6].includes(d as number)
        )
      : EVERY_DAY;
    if (!named.length) return;
    quietHours.push({
      start,
      end,
      days: [...new Set(named)].sort((a, b) => a - b),
    });
  };
  const rows = Array.isArray(value.quietHours)
    ? value.quietHours
    : Array.isArray(value.windows)
      ? value.windows
      : null;
  if (rows) {
    for (const row of rows) {
      const w = row as Partial<MailQuietWindow>;
      take(w?.start, w?.end, w?.days);
    }
  } else if (value.schedule) {
    take(value.schedule.start, value.schedule.end, EVERY_DAY);
  }
  /*
    A pause with no end, from before pauses had one: given an hour from the
    reading rather than kept for ever. Somebody who set it meant "not now",
    and an hour is what "not now" is worth once nobody can remember setting
    it.
  */
  const pausedUntil =
    typeof value.pausedUntil === "number" && Number.isFinite(value.pausedUntil)
      ? value.pausedUntil
      : value.paused === true
        ? Date.now() + 60 * 60 * 1000
        : undefined;
  const accounts = readAccountPauses((value as { accounts?: unknown }).accounts);
  return {
    ...(pausedUntil ? { pausedUntil } : null),
    quietHours,
    ...(accounts ? { accounts } : null),
  };
}

function readAccountPauses(
  raw: unknown
): Record<string, MailAccountPause> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, MailAccountPause> = {};
  for (const [email, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!email.trim() || !row || typeof row !== "object") continue;
    const value = row as {
      pausedUntil?: unknown;
      quietHours?: unknown;
    };
    const parsedHours = Array.isArray(value.quietHours)
      ? readQuietHourRows(value.quietHours)
      : undefined;
    const until =
      typeof value.pausedUntil === "number" &&
      Number.isFinite(value.pausedUntil)
        ? value.pausedUntil
        : undefined;
    if (until == null && parsedHours == null) continue;
    out[pauseAccountKey(email)] = {
      ...(until != null ? { pausedUntil: until } : null),
      ...(parsedHours ? { quietHours: parsedHours } : null),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

function readQuietHourRows(rows: unknown[]): MailQuietWindow[] {
  const quietHours: MailQuietWindow[] = [];
  for (const row of rows) {
    const w = row as Partial<MailQuietWindow>;
    if (typeof w?.start !== "string" || typeof w?.end !== "string") continue;
    if (parseClock(w.start) == null || parseClock(w.end) == null) continue;
    const named = Array.isArray(w.days)
      ? w.days.filter((d): d is MailScheduleDay =>
          [0, 1, 2, 3, 4, 5, 6].includes(d as number)
        )
      : EVERY_DAY;
    if (!named.length) continue;
    quietHours.push({
      start: w.start,
      end: w.end,
      days: [...new Set(named)].sort((a, b) => a - b),
    });
  }
  return quietHours;
}

export type MailPauseOption = {
  id: string;
  label: string;
  /** The time it comes to, said the way a snooze row says it. */
  detail: string;
  until: number;
};

/**
 * How long to pause for, in the words a reader would use.
 *
 * The same shape as snoozing a thread, because it is the same wish about
 * the whole mailbox — and the same rule about what to leave out: an option
 * whose time has been is not an option. "Until noon" at three in the
 * afternoon would be a row that ends the pause before it starts. And one
 * time is one row: on a Sunday, tomorrow is Monday 08:00, and "Until Monday"
 * is not offered as a second row for it.
 *
 * The times are the reader's, set under Settings → Snooze & schedule. Not
 * given, they are the five the menu starts with, named by `say`.
 */
export function mailPauseOptions(
  now: Date,
  say: (key: PauseOptionWord) => string,
  clock: (at: Date) => string,
  dayClock: (at: Date) => string,
  options: TimedOption[] = defaultPauseOptions(say)
): MailPauseOption[] {
  return resolveOptions(options, now, clock, dayClock).map((row) => ({
    id: row.id,
    label: row.label,
    detail: row.detail,
    until: row.at.getTime(),
  }));
}

/**
 * Hours worth having, ready to take.
 *
 * Nobody opens this panel wanting to invent a week from nothing. These are
 * the three shapes people actually ask for — the night, a morning kept for
 * work, and a weekend that stays a weekend — as one press each, and every
 * one of them a card the reader can then change or throw away.
 *
 * `range` is clock times, so it is not translated; the name and the days
 * under it are.
 */
export type MailQuietSuggestion = {
  id: string;
  /** The hours as they read on the card. */
  range: string;
  nameKey: "quietNights" | "quietFocusMornings" | "quietWeekendsOff";
  whenKey: "everyDay" | "weekdays" | "quietSatSun";
  /**
   * What it comes to. More than one where a stretch of the week cannot be
   * said in a single window — a window belongs to the day it starts on.
   */
  windows: MailQuietWindow[];
};

export const MAIL_QUIET_SUGGESTIONS: MailQuietSuggestion[] = [
  {
    id: "nights",
    range: "22:00 – 08:00",
    nameKey: "quietNights",
    whenKey: "everyDay",
    windows: [{ start: "22:00", end: "08:00", days: [...EVERY_DAY] }],
  },
  {
    id: "mornings",
    range: "09:00 – 12:00",
    nameKey: "quietFocusMornings",
    whenKey: "weekdays",
    windows: [{ start: "09:00", end: "12:00", days: [0, 1, 2, 3, 4] }],
  },
  {
    id: "weekend",
    range: "Fri 17:00 – Mon 08:00",
    nameKey: "quietWeekendsOff",
    whenKey: "quietSatSun",
    /*
      Two windows for one weekend: the evenings, which run into the next
      morning, and the two days between them. Friday evening to Monday
      morning is one stretch to a reader and three nights and two days to a
      week that is kept a day at a time.
    */
    windows: [
      { start: "17:00", end: "08:00", days: [4, 5, 6] },
      { start: "08:00", end: "17:00", days: [5, 6] },
    ],
  },
];

/** The same hours on the same days — how a suggestion knows it is already in. */
export function sameQuietWindow(a: MailQuietWindow, b: MailQuietWindow): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    [...a.days].sort((x, y) => x - y).join() ===
      [...b.days].sort((x, y) => x - y).join()
  );
}

/** Is every window of the suggestion standing already? */
export function quietSuggestionApplied(
  windows: MailQuietWindow[],
  suggestion: MailQuietSuggestion
): boolean {
  return suggestion.windows.every((part) =>
    windows.some((window) => sameQuietWindow(window, part))
  );
}

/**
 * The hours with the suggestion in them.
 *
 * What is there already stays as it is: pressing a suggestion twice is one
 * suggestion, not two rows saying the same thing.
 */
export function addQuietSuggestion(
  windows: MailQuietWindow[],
  suggestion: MailQuietSuggestion
): MailQuietWindow[] {
  const added = suggestion.windows.filter(
    (part) => !windows.some((window) => sameQuietWindow(window, part))
  );
  return added.length ? [...windows, ...added] : windows;
}

/** "22:00–08:00 daily · 09:00–12:00 weekdays" — the standing hours in a line. */
export function quietHoursSummary(
  windows: MailQuietWindow[],
  say: (key: "everyDayShort" | "weekdaysShort" | "weekendsShort") => string,
  dayLabels: { day: MailScheduleDay; label: string }[]
): string {
  return windows
    .map((window) => {
      const days = [...window.days].sort((a, b) => a - b);
      const named =
        days.length === 7
          ? say("everyDayShort")
          : days.join() === "0,1,2,3,4"
            ? say("weekdaysShort")
            : days.join() === "5,6"
              ? say("weekendsShort")
              : days
                  .map((day) => dayLabels.find((d) => d.day === day)?.label ?? "")
                  .filter(Boolean)
                  .join(" ");
      return `${window.start}–${window.end} ${named}`.trim();
    })
    .join(" · ");
}
