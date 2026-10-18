/**
 * The week an hours editor draws (lib/mail/hours-week.ts): when a mailbox
 * is shown, and which hours an unsaved change adds. Given as the settings
 * keep them: the hours off.
 */

import { keptFromOnHours } from "@/lib/mail/account-rhythm";
import { weekRuns } from "@/lib/mail/hours-week";

import { check, suite } from "./harness.mjs";

const WEEKDAYS = [0, 1, 2, 3, 4];
// Shown 08:00 – 17:00 on weekdays, kept as the hours off.
const workOnly = keptFromOnHours([{ start: "08:00", end: "17:00", days: WEEKDAYS }]);
// The same until 18:00: one hour more a weekday.
const workTillSix = keptFromOnHours([{ start: "08:00", end: "18:00", days: WEEKDAYS }]);

suite(async () => {
  const same = weekRuns(workOnly, workOnly);
  check(
    "a weekday is on 08:00 – 17:00, nothing added",
    JSON.stringify(same[0]) === JSON.stringify([{ from: 480, to: 1020, kind: "on" }]),
    JSON.stringify(same[0])
  );
  check("a Saturday is off", same[5].length === 0);

  const later = weekRuns(workOnly, workTillSix);
  check(
    "ending an hour later adds 17:00 – 18:00",
    JSON.stringify(later[2]) ===
      JSON.stringify([
        { from: 480, to: 1020, kind: "on" },
        { from: 1020, to: 1080, kind: "added" },
      ]),
    JSON.stringify(later[2])
  );
  check("nothing kept is always on: a whole day of on", JSON.stringify(weekRuns([], [])[3]) === JSON.stringify([{ from: 0, to: 1440, kind: "on" }]));

  // From twice a day to the hours around it: nothing shown now stays, so
  // every hour shown is new, and the hours taken away are simply off.
  const twice = keptFromOnHours([
    { start: "09:00", end: "11:00", days: WEEKDAYS },
    { start: "15:00", end: "17:00", days: WEEKDAYS },
  ]);
  const around = keptFromOnHours([
    { start: "00:00", end: "09:00", days: WEEKDAYS },
    { start: "17:00", end: "00:00", days: WEEKDAYS },
  ]);
  check(
    "hours swapped for others: the new ones are added, the old ones off",
    JSON.stringify(weekRuns(twice, around)[1]) ===
      JSON.stringify([
        { from: 0, to: 540, kind: "added" },
        { from: 1020, to: 1440, kind: "added" },
      ]),
    JSON.stringify(weekRuns(twice, around)[1])
  );
});
