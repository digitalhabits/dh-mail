/**
 * The date on a chat message: a time in the bubble, a day over the run.
 *
 * `dayBucket` answers a different question — it groups a list into Today,
 * Earlier this week, Last week — and "Earlier" over a run of bubbles says
 * nothing about which day they were.
 */

import { chatDayLabel, sameDay, timeOfDay } from "@/lib/mail/date-format";
import { makeMailT } from "@/lib/mail/i18n-strings";

import { check, suite } from "./harness.mjs";

/** The heading names a day in the reader's language, so it is given one. */
const t = makeMailT("en");

const at = (daysAgo, hours = 12, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
};

suite(async () => {
  // --- The time in the bubble ---------------------------------------------
  //
  // Always the clock, whatever day it was: the day is a heading further up,
  // and the only question left about a message is what time it was said.
  check("a time comes back", /\d/.test(timeOfDay(at(0, 14, 7))));
  check("for an old message too", /\d/.test(timeOfDay(at(400, 9, 5))));
  check("and nothing for no date", timeOfDay(null) === "");

  // --- The day over the run -----------------------------------------------
  check("today says so", chatDayLabel(at(0), t) === "Today");
  check("yesterday says so", chatDayLabel(at(1), t) === "Yesterday");
  // Not "Earlier this week": a heading over bubbles has to name the day.
  {
    const label = chatDayLabel(at(3), t);
    check(
      "older names the day",
      label !== "Today" && label !== "Yesterday" && label.length > 0,
      label
    );
    check("and it reads as a date", /[A-Za-z]/.test(label), label);
  }
  check("nothing for no date", chatDayLabel(null, t) === "");

  // --- Where a heading goes ------------------------------------------------
  check(
    "two messages the same day need one heading",
    sameDay(at(1, 9), at(1, 22)) === true
  );
  check("across midnight they need two", sameDay(at(1, 23), at(0, 1)) === false);
  check("a message with no date starts nothing", sameDay(null, at(0)) === false);
  check("nor does one after it", sameDay(at(0), null) === false);
});
