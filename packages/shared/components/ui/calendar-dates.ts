/**
 * Calendar arithmetic, with no React in it.
 *
 * Kept apart from the component so it can be checked without a browser — the
 * grid is where a date picker goes quietly wrong, and a month that starts on
 * the wrong weekday still looks like a calendar.
 *
 * Dates are `yyyy-mm-dd` strings. That is the shape the forms and the API
 * already hold, it compares and sorts as text, and it carries no time or zone
 * to go wrong.
 */

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Monday first. */
export const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export type YearMonthDay = { year: number; month: number; day: number };

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * `yyyy-mm-dd` for a local calendar day.
 *
 * Built from local parts on purpose. `toISOString` would name yesterday for
 * anyone east of UTC before their own midday.
 */
export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

export function parseDateKey(key: string): YearMonthDay | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function todayDateKey(): string {
  const now = new Date();
  return toDateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

/** "19 May 2026". Fixed names, so the server and the browser agree. */
export function formatDateKey(key: string): string {
  const parsed = parseDateKey(key);
  if (!parsed) return "";
  return `${parsed.day} ${MONTHS[parsed.month]} ${parsed.year}`;
}

export function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/** Monday-based index of the weekday a month starts on (0 = Monday). */
export function firstWeekdayIndex(year: number, month: number): number {
  return (new Date(year, month, 1).getDay() + 6) % 7;
}

/**
 * One month as grid cells: leading nulls for the days before the 1st, then
 * every day of the month.
 */
export function monthCells(year: number, month: number): (number | null)[] {
  const lead = firstWeekdayIndex(year, month);
  const total = daysInMonth(year, month);
  return [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
}

/** Move a year/month by whole months, rolling the year over. */
export function stepMonth(
  year: number,
  month: number,
  by: number
): { year: number; month: number } {
  // Day 1 keeps this safe on the 31st: month 0 → 12 rolls the year.
  const d = new Date(year, month + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
