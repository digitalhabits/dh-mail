/**
 * What may change while a pause, or a hidden mailbox, is running.
 *
 * Blocker's rule, for Mail: while a block runs, its schedule can only be
 * made stricter, and a change that loosens it asks for the same words as
 * stopping early. Without it the words guard nothing. A reader paused on a
 * Monday could take Monday off the schedule, or set the words to zero, and
 * fetch at once without typing a thing (reported by a tester, 2026-10-05).
 *
 * Stricter is free: more hours, more days, more words. Looser asks: fewer
 * hours or days, a window taken away, a mailbox that stops following All's
 * hours (and so has none), fewer words.
 *
 * No React here, on purpose: this is the part a suite reads.
 */

import { isScheduleActiveNow } from "@/lib/mail/custom-lists";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";

/** A Monday, for walking the minutes of a week. Its time zone does not matter. */
const REFERENCE_MONDAY = { year: 2026, month: 0, day: 5 };
const MINUTES_PER_DAY = 24 * 60;

/** True when `windows` cover this minute of the week (0 is Monday 00:00). */
function covers(windows: MailQuietWindow[], minuteOfWeek: number): boolean {
  const day = Math.floor(minuteOfWeek / MINUTES_PER_DAY);
  const minute = minuteOfWeek % MINUTES_PER_DAY;
  const at = new Date(
    REFERENCE_MONDAY.year,
    REFERENCE_MONDAY.month,
    REFERENCE_MONDAY.day + day,
    Math.floor(minute / 60),
    minute % 60
  );
  return windows.some((window) =>
    isScheduleActiveNow({ enabled: true, from: window.start, to: window.end, days: window.days }, at)
  );
}

/**
 * Does `after` leave out any minute of the week that `before` covered?
 *
 * The same test the pause asks each minute (`isScheduleActiveNow`), walked
 * over one week, so a window across midnight and a window with equal start
 * and end count exactly as they pause. Adding a window, a day, or time is
 * never looser; taking any of them away is.
 */
export function scheduleLoosened(before: MailQuietWindow[], after: MailQuietWindow[]): boolean {
  if (!before.length) return false;
  for (let minute = 0; minute < 7 * MINUTES_PER_DAY; minute++) {
    if (covers(before, minute) && !covers(after, minute)) return true;
  }
  return false;
}

/** Fewer words is looser; more, or the same, is not. */
export function frictionLowered(before: number, after: number): boolean {
  return after < before;
}

/** What a panel needs to know to hold looser changes back. */
export type PauseLock = {
  /** The words the reader must type, as for ending the pause early. */
  words: number;
};
