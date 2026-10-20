/**
 * How a mailbox fits the week: the times it is on, turned into the times
 * the settings keep it off, and read back by the rules that use them.
 */

import {
  ALWAYS_RULE,
  FETCH_PRESET_ORDER,
  FETCH_PRESETS,
  SHOWN_PRESET_ORDER,
  SHOWN_PRESETS,
  keptFromOnHours,
  onHoursFromKept,
  onHoursSummary,
  invertWindows,
  presetOf,
  rhythmFromSettings,
  rhythmSegments,
  rhythmToSettings,
  sameWeek,
} from "@/lib/mail/account-rhythm";
import { mailboxHideVerdict } from "@/lib/mail/mailbox-hide";
import { mailPauseVerdict } from "@/lib/mail/quiet-hours";

import { check, suite } from "./harness.mjs";

// 5 Oct 2026 is a Monday.
const at = (day, h, m = 0) => new Date(2026, 9, 5 + day, h, m);

// The two answers of the dialog, put together as a week.
const RHYTHMS = {
  always: { shown: SHOWN_PRESETS.always, fetching: FETCH_PRESETS.always },
  offWeekends: { shown: SHOWN_PRESETS.weekdays, fetching: FETCH_PRESETS.always },
  workHours: { shown: SHOWN_PRESETS.always, fetching: FETCH_PRESETS.work },
};

suite(async () => {
  const always = rhythmToSettings(RHYTHMS.always);
  check("always on keeps nothing hidden and nothing quiet", always.hiddenHours.length === 0 && always.quietHours.length === 0);

  const offWeekends = rhythmToSettings(RHYTHMS.offWeekends);
  check("off on weekends hides Saturday and Sunday whole", JSON.stringify(offWeekends.hiddenHours) === JSON.stringify([{ start: "00:00", end: "00:00", days: [5, 6] }]));
  const hiddenRow = { hours: offWeekends.hiddenHours };
  check("so a Saturday afternoon is hidden", mailboxHideVerdict(hiddenRow, at(5, 15)).hidden);
  check("and Sunday just before midnight", mailboxHideVerdict(hiddenRow, at(6, 23, 59)).hidden);
  check("and Friday evening is not", !mailboxHideVerdict(hiddenRow, at(4, 22)).hidden);

  const work = rhythmToSettings(RHYTHMS.workHours);
  const quiet = { quietHours: work.quietHours };
  check("work hours: Tuesday 10:00 fetches", !mailPauseVerdict(quiet, at(1, 10)).paused);
  check("Tuesday 07:59 does not", mailPauseVerdict(quiet, at(1, 7, 59)).paused);
  check("Tuesday 17:30 does", !mailPauseVerdict(quiet, at(1, 17, 30)).paused);
  check("Tuesday 18:00 does not", mailPauseVerdict(quiet, at(1, 18)).paused);
  check("Tuesday 23:30 does not", mailPauseVerdict(quiet, at(1, 23, 30)).paused);
  check("Saturday noon does not", mailPauseVerdict(quiet, at(5, 12)).paused);
  check("and work hours stay shown all week", work.hiddenHours.length === 0);

  check("a night over midnight turns into evening and morning", sameWeek(
    invertWindows([{ start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }]),
    [{ start: "07:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] }]
  ));
  check("turned over twice is the same week", sameWeek(invertWindows(invertWindows(FETCH_PRESETS.work)), FETCH_PRESETS.work));

  for (const name of SHOWN_PRESET_ORDER) {
    const kept = keptFromOnHours(SHOWN_PRESETS[name]);
    check(`shown "${name}" is known again from what is kept`, presetOf(SHOWN_PRESETS, SHOWN_PRESET_ORDER, rhythmFromSettings(kept, []).shown) === name);
  }
  for (const name of FETCH_PRESET_ORDER) {
    const kept = keptFromOnHours(FETCH_PRESETS[name]);
    check(`new mail "${name}" is known again from what is kept`, presetOf(FETCH_PRESETS, FETCH_PRESET_ORDER, rhythmFromSettings([], kept).fetching) === name);
  }
  check("hours of one's own are no answer", presetOf(FETCH_PRESETS, FETCH_PRESET_ORDER, [{ start: "09:00", end: "12:00", days: [0] }]) === null);
  check("twice a day is 09:00 – 10:00 and 15:00 – 16:00 on weekdays", sameWeek(FETCH_PRESETS.twice, [
    { start: "09:00", end: "10:00", days: [0, 1, 2, 3, 4] },
    { start: "15:00", end: "16:00", days: [0, 1, 2, 3, 4] },
  ]));

  const monday = rhythmSegments(RHYTHMS.workHours)[0];
  check("Monday of work hours: shown, then new mail, then shown", JSON.stringify(monday.map((r) => r.state)) === JSON.stringify(["shown", "fetching", "shown"]));
  // The settings screens: when it is on, never when it is not.
  const words = { allDay: "All day", nextDay: "next day", daily: "daily", weekdays: "weekdays", weekends: "weekends" };
  const labels = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][day] }));
  check("nothing kept is always: no summary", onHoursSummary([], words, labels) === null);
  check("hidden 18:00 – 07:15 reads as shown 07:15 – 18:00 daily",
    onHoursSummary([{ start: "18:00", end: "07:15", days: [0, 1, 2, 3, 4, 5, 6] }], words, labels) === "07:15 – 18:00 daily");
  check("quiet at the weekend reads as all day on weekdays",
    onHoursSummary([{ start: "00:00", end: "00:00", days: [5, 6] }], words, labels) === "All day weekdays");
  check("a night of new mail says next day",
    onHoursSummary(keptFromOnHours([{ start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6] }]), words, labels).includes("next day"));
  check("no rules left is always, not never", keptFromOnHours([]).length === 0);
  check("one rule over the whole week is always too", keptFromOnHours([ALWAYS_RULE]).length === 0);
  check("and always shows as no rules of its own", onHoursFromKept([]).length === 0);

  const saturday = rhythmSegments(RHYTHMS.offWeekends)[5];
  check("Saturday off on weekends: hidden all day", saturday.length === 1 && saturday[0].state === "hidden");
});
