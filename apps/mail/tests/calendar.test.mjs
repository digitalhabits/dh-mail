/**
 * The calendar's arithmetic.
 *
 * The grid is where a date picker goes quietly wrong: a month that starts on
 * the wrong weekday, or a February that is a day short, still renders and
 * still looks like a calendar. None of this needs a browser, so it is checked
 * here rather than by eye.
 */

import {
  daysInMonth,
  firstWeekdayIndex,
  formatDateKey,
  monthCells,
  parseDateKey,
  stepMonth,
  toDateKey,
} from "@/components/ui/calendar-dates";
import { check, suite } from "./harness.mjs";

suite(async () => {
  // ---- Keys ----------------------------------------------------------------
  // Built from local parts, never from toISOString: east of UTC that would
  // name yesterday for anyone before their own midday.
  check("a key is yyyy-mm-dd, zero padded", toDateKey(2026, 4, 9) === "2026-05-09",
    toDateKey(2026, 4, 9));
  check("the month is one-based in the text and zero-based in the call",
    toDateKey(2026, 0, 1) === "2026-01-01", toDateKey(2026, 0, 1));

  const parsed = parseDateKey("2026-05-19");
  check("a key parses back to the same day",
    parsed?.year === 2026 && parsed?.month === 4 && parsed?.day === 19,
    JSON.stringify(parsed));
  check("nonsense parses to nothing", parseDateKey("19/05/2026") === null);
  check("an empty value parses to nothing", parseDateKey("") === null);
  check("a month of 13 is refused", parseDateKey("2026-13-01") === null);

  check("a key formats for reading", formatDateKey("2026-05-19") === "19 May 2026",
    formatDateKey("2026-05-19"));
  check("an unset date formats to nothing", formatDateKey("") === "");

  // ---- Month lengths -------------------------------------------------------
  check("April has 30 days", daysInMonth(2026, 3) === 30, daysInMonth(2026, 3));
  check("May has 31", daysInMonth(2026, 4) === 31);
  check("February 2026 has 28", daysInMonth(2026, 1) === 28, daysInMonth(2026, 1));
  check("February 2028 has 29, being a leap year", daysInMonth(2028, 1) === 29,
    daysInMonth(2028, 1));
  check("February 2100 has 28: a century is not a leap year unless it divides by 400",
    daysInMonth(2100, 1) === 28, daysInMonth(2100, 1));
  check("February 2000 has 29, because 2000 does divide by 400",
    daysInMonth(2000, 1) === 29, daysInMonth(2000, 1));

  // ---- Weeks start on Monday -----------------------------------------------
  // 1 May 2026 is a Friday, so it sits in the fifth column.
  check("a month starting on Friday leads with four blanks",
    firstWeekdayIndex(2026, 4) === 4, firstWeekdayIndex(2026, 4));
  // 1 March 2026 is a Sunday — the last column, not the first.
  check("a month starting on Sunday leads with six blanks, not none",
    firstWeekdayIndex(2026, 2) === 6, firstWeekdayIndex(2026, 2));
  // 1 June 2026 is a Monday.
  check("a month starting on Monday leads with no blanks",
    firstWeekdayIndex(2026, 5) === 0, firstWeekdayIndex(2026, 5));

  // ---- The grid ------------------------------------------------------------
  const may = monthCells(2026, 4);
  check("the grid holds the blanks and every day", may.length === 4 + 31, may.length);
  check("the blanks come first", may.slice(0, 4).every((c) => c === null));
  check("the first day follows them", may[4] === 1);
  check("the last day is the last cell", may[may.length - 1] === 31);

  const march = monthCells(2026, 2);
  check("a Sunday start pushes the 1st to the seventh cell",
    march[6] === 1 && march[5] === null, JSON.stringify(march.slice(0, 8)));

  // ---- Stepping ------------------------------------------------------------
  check("next month moves on",
    JSON.stringify(stepMonth(2026, 4, 1)) === JSON.stringify({ year: 2026, month: 5 }),
    JSON.stringify(stepMonth(2026, 4, 1)));
  check("December rolls into January of the next year",
    JSON.stringify(stepMonth(2026, 11, 1)) === JSON.stringify({ year: 2027, month: 0 }),
    JSON.stringify(stepMonth(2026, 11, 1)));
  check("January rolls back into December of the year before",
    JSON.stringify(stepMonth(2026, 0, -1)) === JSON.stringify({ year: 2025, month: 11 }),
    JSON.stringify(stepMonth(2026, 0, -1)));

  // ---- Comparison ----------------------------------------------------------
  // The out-of-office range relies on this: keys compare as text.
  check("a later day sorts after an earlier one as plain text",
    "2026-05-22" > "2026-05-19" && "2026-01-01" < "2026-02-01");
  check("and across a year end", "2027-01-01" > "2026-12-31");
});
