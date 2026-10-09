/**
 * Hours set somewhere else are offered as suggestions here (quiet-hours.ts):
 * each once, not when they stand here already, and not when they are one
 * of the built-in suggestions (work-life balance is one now).
 */

import { MAIL_QUIET_SUGGESTIONS, quietHoursFromElsewhere } from "@/lib/mail/quiet-hours";

import { check, suite } from "./harness.mjs";

const EVERY = [0, 1, 2, 3, 4, 5, 6];
const w = (start, end, days = EVERY) => ({ start, end, days });

suite(async () => {
  check("work-life balance is a suggestion", MAIL_QUIET_SUGGESTIONS.some((s) => s.id === "worklife" && s.windows[0].start === "18:00" && s.windows[0].end === "07:00"));
  const got = quietHoursFromElsewhere([w("17:30", "07:00"), w("17:30", "07:00"), w("18:00", "07:00"), w("12:00", "13:00", [0, 1])], [w("12:00", "13:00", [1, 0])]);
  check("hours from elsewhere are offered once", got.length === 1 && got[0].start === "17:30", JSON.stringify(got));
  check("not when the same hours stand here (days in any order)", !got.some((x) => x.start === "12:00"));
  check("nor when they are a built-in suggestion", !got.some((x) => x.start === "18:00"));
  check("a window with no days is not offered", quietHoursFromElsewhere([w("09:00", "10:00", [])], []).length === 0);
});
