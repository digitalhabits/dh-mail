/**
 * The times a menu offers, as the reader sets them up in Settings.
 *
 * Snoozing a thread, sending later and pausing the mail each offer a short
 * list of times — "In 1 hour", "Tomorrow", "Until Monday". Each option is a
 * sentence: a name the reader writes, then a unit that says what the value
 * means.
 *
 * - `hours`: that many hours from now, with no clock time.
 * - `today`: later the same day, at a time. 24:00 is the end of the day.
 * - `days`: 1 is tomorrow, 2 the day after, at a time.
 * - `weekday`: the next Sat, Mon, … at a time. This covers both "this
 *   weekend" and "next week".
 *
 * Two options in one list cannot take the same slot. A new option opens on
 * the first slot nothing else uses, and a change onto a slot that is taken
 * is refused. Each list is kept in localStorage under its own key; until the
 * reader changes something, that list's defaults are read instead.
 *
 * No React here, so a test can run it directly.
 */

export type TimedUnit = "hours" | "today" | "days" | "weekday";

export const TIMED_UNITS: TimedUnit[] = ["hours", "today", "days", "weekday"];

export type TimedOption = {
  id: string;
  /** What the menu calls it. The reader's own words; can be empty. */
  label: string;
  unit: TimedUnit;
  /** Hours for `hours`, days for `days`. */
  count: number;
  /** 0 is Sunday, as `Date.getDay`. For `weekday`. */
  weekday: number;
  /** "HH:MM", or "24:00" for the end of the day. For every unit but `hours`. */
  time: string;
};

export const MAX_OPTION_HOURS = 72;
export const MAX_OPTION_DAYS = 60;

/** Hours and minutes from "HH:MM", or null. "24:00" is allowed: the end of a day. */
export function parseOptionTime(hm: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  // The rest of today ends at midnight, and midnight belongs to the day it
  // closes. Nothing past it.
  if (hours === 24 && minutes === 0) return { hours, minutes };
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes };
}

/** "9:5" is not a time; "9:05" becomes "09:05". Null when it is not one. */
export function normaliseOptionTime(hm: string): string | null {
  const parsed = parseOptionTime(hm);
  if (!parsed) return null;
  return `${String(parsed.hours).padStart(2, "0")}:${String(parsed.minutes).padStart(2, "0")}`;
}

/**
 * The slot an option takes. Two options with the same slot are the same
 * option under two names.
 */
export function optionSlot(option: TimedOption): string {
  switch (option.unit) {
    case "hours":
      return `hours:${option.count}`;
    case "today":
      return `today@${option.time}`;
    case "days":
      return `days:${option.count}@${option.time}`;
    case "weekday":
      return `weekday:${option.weekday}@${option.time}`;
  }
}

/** The other option already on this one's slot, or null. */
export function optionClash(list: TimedOption[], candidate: TimedOption): TimedOption | null {
  const slot = optionSlot(candidate);
  return list.find((o) => o.id !== candidate.id && optionSlot(o) === slot) ?? null;
}

/** Midnight at the start of the day `ahead` days from `now`, at a clock time. */
function onDay(now: Date, ahead: number, hours: number, minutes: number): Date {
  const at = new Date(now);
  at.setHours(0, 0, 0, 0);
  at.setDate(at.getDate() + ahead);
  // 24:00 rolls to the next midnight, which is what it means.
  at.setHours(hours, minutes, 0, 0);
  return at;
}

/**
 * When an option comes to, seen from `now`. Null when its time has passed
 * today, so the menu leaves it out.
 */
export function optionTime(option: TimedOption, now: Date): Date | null {
  if (option.unit === "hours") {
    return new Date(now.getTime() + option.count * 60 * 60 * 1000);
  }
  const hm = parseOptionTime(option.time);
  if (!hm) return null;
  if (option.unit === "today") {
    const at = onDay(now, 0, hm.hours, hm.minutes);
    return at.getTime() > now.getTime() ? at : null;
  }
  if (option.unit === "days") {
    return onDay(now, option.count, hm.hours, hm.minutes);
  }
  // The next such day whose time is still ahead: today if it is that day and
  // the time has not come, else within the week.
  for (let ahead = 0; ahead <= 7; ahead++) {
    const day = onDay(now, ahead, 0, 0);
    if (day.getDay() !== option.weekday) continue;
    const at = onDay(now, ahead, hm.hours, hm.minutes);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export type ResolvedOption = {
  id: string;
  label: string;
  /** The time it comes to, said the way the menu says it. */
  detail: string;
  at: Date;
};

/**
 * The rows a menu shows, worked out from now.
 *
 * An option whose time has passed is left out, and so is one that comes to
 * the same moment as a row above it: on a Sunday "Tomorrow" and "Until
 * Monday" are both Monday 08:00, and two rows for one time is one too many.
 * An option with no name is called by its time.
 */
export function resolveOptions(
  list: TimedOption[],
  now: Date,
  clock: (at: Date) => string,
  dayClock: (at: Date) => string
): ResolvedOption[] {
  const rows: ResolvedOption[] = [];
  for (const option of list) {
    const at = optionTime(option, now);
    if (!at) continue;
    if (rows.some((row) => row.at.getTime() === at.getTime())) continue;
    // A time today needs no day in front of it. The end of today is said as
    // 24:00, not as the 00:00 of the day after.
    const detail =
      option.unit === "today" && option.time === "24:00"
        ? "24:00"
        : option.unit === "today" || (option.unit === "hours" && sameCalendarDay(at, now))
          ? clock(at)
          : dayClock(at);
    const label = option.label.trim();
    rows.push({ id: option.id, label: label || detail, detail: label ? detail : "", at });
  }
  return rows;
}

function newId(): string {
  return `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * A new, unnamed option on the first slot nothing else uses: the first
 * number of days at 08:00 that is free.
 */
export function newOption(list: TimedOption[]): TimedOption {
  const draft: TimedOption = {
    id: newId(),
    label: "",
    unit: "days",
    count: 1,
    weekday: 1,
    time: "08:00",
  };
  while (optionClash(list, draft) && draft.count < MAX_OPTION_DAYS) draft.count++;
  return draft;
}

function readOption(value: unknown): TimedOption | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (!TIMED_UNITS.includes(v.unit as TimedUnit)) return null;
  const unit = v.unit as TimedUnit;
  const max = unit === "hours" ? MAX_OPTION_HOURS : MAX_OPTION_DAYS;
  const count =
    Number.isInteger(v.count) && (v.count as number) >= 1 && (v.count as number) <= max
      ? (v.count as number)
      : 1;
  const weekday =
    Number.isInteger(v.weekday) && (v.weekday as number) >= 0 && (v.weekday as number) <= 6
      ? (v.weekday as number)
      : 1;
  const time =
    typeof v.time === "string" ? (normaliseOptionTime(v.time) ?? "08:00") : "08:00";
  return {
    id: v.id,
    label: typeof v.label === "string" ? v.label : "",
    unit,
    count,
    weekday,
    time,
  };
}

/**
 * A saved list, or the defaults when nothing is saved or it cannot be read.
 * An option on a slot already taken is left out.
 */
export function readOptionList(raw: string | null, defaults: () => TimedOption[]): TimedOption[] {
  if (raw == null) return defaults();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return defaults();
  }
  if (!Array.isArray(value)) return defaults();
  const list: TimedOption[] = [];
  for (const item of value) {
    const option = readOption(item);
    if (!option || list.some((o) => o.id === option.id)) continue;
    if (optionClash(list, option)) continue;
    list.push(option);
  }
  return list;
}

/** Where one list is kept, and what it holds until the reader changes it. */
export type TimedOptionStore = {
  key: string;
  event: string;
  defaults: () => TimedOption[];
};

export function storedOptionsRaw(store: TimedOptionStore): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(store.key);
  } catch {
    return null;
  }
}

export function readStoredOptions(store: TimedOptionStore): TimedOption[] {
  return readOptionList(storedOptionsRaw(store), store.defaults);
}

export function saveStoredOptions(store: TimedOptionStore, list: TimedOption[]): void {
  try {
    localStorage.setItem(store.key, JSON.stringify(list));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(store.event));
}

export function resetStoredOptions(store: TimedOptionStore): void {
  try {
    localStorage.removeItem(store.key);
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(store.event));
}
