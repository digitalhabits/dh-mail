/**
 * Hours on, changed by dragging them on a week chart (HoursWeekEditor).
 *
 * The chart draws each rule on each of its days as a bar with a handle at
 * each end. Dragging a handle moves that end of the rule, for all of the
 * rule's days, as typing a time in its card does. Dragging on an empty part
 * of a day makes a new rule for that day alone. Dragging the middle of a
 * bar moves the whole rule: sideways in time, keeping its length, and up or
 * down by whole days, all of its days together.
 *
 * Times snap to a quarter hour. A rule never gets shorter than a quarter
 * hour, and an end is never dragged past the other end: a bar that turned
 * inside out would run past midnight, which is not what a drag means.
 *
 * No React here, so a suite can read it.
 */

import { EVERY_DAY, type MailScheduleDay } from "@/lib/mail/custom-lists";
import { formatClock, parseClock, type MailQuietWindow } from "@/lib/mail/quiet-hours";

export const DAY_MINUTES = 24 * 60;
/** The step a drag snaps to, in minutes. */
export const SNAP_MINUTES = 15;

/** One rule's bar on one day. `from` and `to` are minutes, 0 to 1440. */
export type RuleBar = {
  rule: number;
  from: number;
  to: number;
  /** The rule's start is at `from` here, so its handle is drawn. */
  startHandle: boolean;
  /** The rule's end is at `to` here. */
  endHandle: boolean;
};

/** Each day's bars, Monday first. A rule past midnight ends on the next day. */
export function ruleBars(rows: MailQuietWindow[]): RuleBar[][] {
  const days: RuleBar[][] = EVERY_DAY.map(() => []);
  rows.forEach((row, rule) => {
    const start = parseClock(row.start);
    const end = parseClock(row.end);
    if (start == null || end == null) return;
    for (const day of row.days) {
      if (start < end) {
        days[day].push({ rule, from: start, to: end, startHandle: true, endHandle: true });
      } else if (start === end) {
        // The whole day ("00:00" – "00:00").
        days[day].push({ rule, from: 0, to: DAY_MINUTES, startHandle: true, endHandle: true });
      } else {
        // Past midnight: the evening here, and the morning on the next day.
        days[day].push({ rule, from: start, to: DAY_MINUTES, startHandle: true, endHandle: end === 0 });
        if (end > 0) days[(day + 1) % 7].push({ rule, from: 0, to: end, startHandle: false, endHandle: true });
      }
    }
  });
  return days;
}

/** A minute of the day from a place on the bar, 0 to 1, on the snap. */
export function snapMinute(fraction: number): number {
  const minute = Math.round((fraction * DAY_MINUTES) / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(DAY_MINUTES, Math.max(0, minute));
}

function clock(minute: number): string {
  return minute >= DAY_MINUTES ? "00:00" : formatClock(minute);
}

/** The minutes of a rule's end, with midnight at the end of the day as 1440. */
function endMinutes(row: MailQuietWindow): number {
  const end = parseClock(row.end) ?? 0;
  return end === 0 ? DAY_MINUTES : end;
}

/**
 * Move one end of a rule to `minute`. Only a rule within one day moves:
 * a rule past midnight keeps its shape, and is changed in its card.
 */
export function dragRuleEnd(
  rows: MailQuietWindow[],
  rule: number,
  end: "start" | "end",
  minute: number
): MailQuietWindow[] {
  const row = rows[rule];
  if (!row) return rows;
  const start = parseClock(row.start) ?? 0;
  const stop = endMinutes(row);
  if (stop <= start) return rows;
  const next =
    end === "start"
      ? { ...row, start: clock(Math.min(Math.max(0, minute), stop - SNAP_MINUTES)) }
      : { ...row, end: clock(Math.max(Math.min(DAY_MINUTES, minute), start + SNAP_MINUTES)) };
  return rows.map((r, i) => (i === rule ? next : r));
}

/**
 * Move a whole rule: `minutes` later (or earlier), and `days` down (or up)
 * the week. It stays inside the day and inside the week: a move that would
 * push it out stops at the edge. A rule past midnight, or all day, does not
 * move in time.
 */
export function moveRule(rows: MailQuietWindow[], rule: number, minutes: number, days: number): MailQuietWindow[] {
  const row = rows[rule];
  if (!row || !row.days.length) return rows;
  const start = parseClock(row.start) ?? 0;
  const stop = endMinutes(row);
  const within = stop > start && !(start === 0 && stop === DAY_MINUTES);
  const shift = within ? Math.min(Math.max(minutes, -start), DAY_MINUTES - stop) : 0;
  const first = Math.min(...row.days);
  const last = Math.max(...row.days);
  const dayShift = Math.min(Math.max(days, -first), 6 - last);
  const next: MailQuietWindow = {
    ...row,
    ...(shift ? { start: clock(start + shift), end: clock(stop + shift) } : null),
    days: row.days.map((day) => (day + dayShift) as MailScheduleDay),
  };
  return rows.map((r, i) => (i === rule ? next : r));
}

/** The rule whose bar a minute of a day is inside, or null. */
export function barAt(bars: RuleBar[], minute: number): RuleBar | null {
  return bars.find((bar) => minute > bar.from && minute < bar.to) ?? null;
}

/** A new rule for one day, from where a drag began to where it is now. */
export function addDayRule(rows: MailQuietWindow[], day: MailScheduleDay, a: number, b: number): MailQuietWindow[] {
  const from = Math.min(a, b);
  const to = Math.max(Math.max(a, b), from + SNAP_MINUTES);
  return [...rows, { start: clock(from), end: clock(Math.min(to, DAY_MINUTES)), days: [day] }];
}

/** Whether a minute of a day is inside one of its bars. */
export function insideBar(bars: RuleBar[], minute: number): boolean {
  return bars.some((bar) => minute > bar.from && minute < bar.to);
}
