/**
 * What may change while a pause, or a hidden mailbox, is running: stricter
 * is free, looser asks for the words (lib/mail/pause-lock.ts). The first
 * case is a tester's: paused on a Monday, he took Monday off the schedule and
 * the mail came back without a word typed.
 */

import { frictionLowered, scheduleLoosened } from "@/lib/mail/pause-lock";

import { check, suite } from "./harness.mjs";

const WEEKDAYS = [0, 1, 2, 3, 4];
const work = { start: "09:00", end: "17:00", days: WEEKDAYS };
const night = { start: "22:00", end: "08:00", days: [0] };

suite(async () => {
  check(
    "taking Monday off a weekday schedule is looser",
    scheduleLoosened([work], [{ ...work, days: [1, 2, 3, 4] }])
  );
  check("adding Saturday is not looser", !scheduleLoosened([work], [{ ...work, days: [...WEEKDAYS, 5] }]));
  check("ending later is not looser", !scheduleLoosened([work], [{ ...work, end: "18:00" }]));
  check("ending earlier is looser", scheduleLoosened([work], [{ ...work, end: "16:00" }]));
  check("starting later is looser", scheduleLoosened([work], [{ ...work, start: "09:30" }]));
  check("taking the window away is looser", scheduleLoosened([work], []));
  check("adding a second window is not looser", !scheduleLoosened([work], [work, night]));
  check(
    "a window inside another one can go: the minutes stay covered",
    !scheduleLoosened([work, { start: "10:00", end: "11:00", days: [0] }], [work])
  );
  check(
    "a night across midnight: the morning after counts as its day's",
    scheduleLoosened([night], [{ ...night, end: "07:00" }]) &&
      !scheduleLoosened([night], [{ ...night, days: [0, 1] }])
  );
  check(
    "the same hours written as two windows are not looser",
    !scheduleLoosened([work], [
      { start: "09:00", end: "13:00", days: WEEKDAYS },
      { start: "13:00", end: "17:00", days: WEEKDAYS },
    ])
  );
  check("no hours before: nothing can be looser", !scheduleLoosened([], []));

  check("fewer words is looser", frictionLowered(10, 1));
  check("words off is looser", frictionLowered(10, 0));
  check("more words, or the same, is not", !frictionLowered(10, 20) && !frictionLowered(10, 10));
});
