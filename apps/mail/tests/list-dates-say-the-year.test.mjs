/**
 * A list date in an earlier year says the year.
 *
 * Under one "Earlier" heading, 18 Oct of last year stood below 9 Sep of
 * this one as if it came first. There is no heading per year: the year
 * after the date is enough.
 */

import { dayBucket, rowTime } from "@/lib/mail/date-format";

import { check, suite } from "./harness.mjs";

const year = new Date().getFullYear();
const on = (y, month, day) => new Date(y, month, day, 12).toISOString();

suite(async () => {
  const lastYear = on(year - 1, 9, 18);
  check("a day last year says its year", rowTime(lastYear).includes(String(year - 1)), rowTime(lastYear));
  check("and stays under Earlier", dayBucket(lastYear) === "bucketEarlier");
  check("so does two years back", rowTime(on(year - 2, 3, 1)).includes(String(year - 2)));

  // Early this year is only "Earlier" from March on.
  if (new Date().getMonth() >= 3) {
    const earlier = on(year, 0, 5);
    check("a day earlier this year has no year", !rowTime(earlier).includes(String(year)), rowTime(earlier));
  }
});
