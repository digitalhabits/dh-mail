/**
 * How a mailbox fits the week: the times it is on, turned into the times
 * the settings keep it off, and read back by the rules that use them.
 */

import {
  ALWAYS_RULE,
  RHYTHM_PRESETS,
  keptFromOnHours,
  onHoursFromKept,
  onHoursSummary,
  invertWindows,
  rhythmFromSettings,
  rhythmPreset,
  rhythmSegments,
  rhythmToSettings,
  sameWeek,
} from "@/lib/mail/account-rhythm";
import { mailboxHideVerdict } from "@/lib/mail/mailbox-hide";
import { mailPauseVerdict } from "@/lib/mail/quiet-hours";

import { check, suite } from "./harness.mjs";

// 5 Oct 2026 is a Monday.
const at = (day, h, m = 0) => new Date(2026, 9, 5 + day, h, m);

suite(async () => {
  const always = rhythmToSettings(RHYTHM_PRESETS.always);
  check("always on keeps nothing hidden and nothing quiet", always.hiddenHours.length === 0 && always.quietHours.length === 0);

  const offWeekends = rhythmToSettings(RHYTHM_PRESETS.offWeekends);
  check("off on weekends hides Saturday and Sunday whole", JSON.stringify(offWeekends.hiddenHours) === JSON.stringify([{ start: "00:00", end: "00:00", days: [5, 6] }]));
  const hiddenRow = { hours: offWeekends.hiddenHours };
  check("so a Saturday afternoon is hidden", mailboxHideVerdict(hiddenRow, at(5, 15)).hidden);
  check("and Sunday just before midnight", mailboxHideVerdict(hiddenRow, at(6, 23, 59)).hidden);
  check("and Friday evening is not", !mailboxHideVerdict(hiddenRow, at(4, 22)).hidden);

  const work = rhythmToSettings(RHYTHM_PRESETS.workHours);
  const quiet = { quietHours: work.quietHours };
  check("work hours: Tuesday 10:00 fetches", !mailPauseVerdict(quiet, at(1, 10)).paused);
  check("Tuesday 07:59 does not", mailPauseVerdict(quiet, at(1, 7, 59)).paused);
  check("Tuesday 17:00 does not", mailPauseVerdict(quiet, at(1, 17)).paused);
  check("Tuesday 23:30 does not", mailPauseVerdict(quiet, at(1, 23, 30)).paused);
  check("Saturday noon does not", mailPauseVerdict(quiet, at(5, 12)).paused);
  check("and work hours stay shown all week", work.hiddenHours.length === 0);

  check("a night over midnight turns into evening and morning", sameWeek(
    invertWindows([{ start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }]),
    [{ start: "07:00", end: "22:00", days: [0, 1, 2, 3, 4, 5, 6] }]
  ));
  check("turned over twice is the same week", sameWeek(invertWindows(invertWindows(RHYTHM_PRESETS.workHours.fetching)), RHYTHM_PRESETS.workHours.fetching));

  for (const name of ["always", "quietWeekends", "offWeekends", "workHours"]) {
    const kept = rhythmToSettings(RHYTHM_PRESETS[name]);
    check(`${name} is known again from what is kept`, rhythmPreset(rhythmFromSettings(kept.hiddenHours, kept.quietHours)) === name);
  }
  check("hours of one's own are no preset", rhythmPreset({ shown: RHYTHM_PRESETS.always.shown, fetching: [{ start: "09:00", end: "12:00", days: [0] }] }) === null);

  const monday = rhythmSegments(RHYTHM_PRESETS.workHours)[0];
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

  const saturday = rhythmSegments(RHYTHM_PRESETS.offWeekends)[5];
  check("Saturday off on weekends: hidden all day", saturday.length === 1 && saturday[0].state === "hidden");
});
