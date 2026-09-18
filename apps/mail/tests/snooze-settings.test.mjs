/**
 * The snooze options a reader sets up come back at the right times, and two
 * options cannot take the same slot.
 */

import {
  defaultSnoozeSettings,
  newSnoozeSetting,
  parseSnoozeSettings,
  snoozeClash,
  snoozeSettingTime,
} from "@/lib/mail/snooze-settings";

import { check, suite } from "./harness.mjs";

const at = (s) => new Date(s);
const hm = (d) => (d ? `${d.getDay()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}` : "null");

suite(async () => {
  const defaults = defaultSnoozeSettings();
  const byId = Object.fromEntries(defaults.map((s) => [s.id, s]));

  // Tuesday 15 September 2026, 16:00.
  const tuesdayAfternoon = at("2026-09-15T16:00:00");
  check("in 1 hour is 17:00", hm(snoozeSettingTime(byId["1h"], tuesdayAfternoon)) === "2 17:00");
  check(
    "later today is left out once 15:00 has passed",
    snoozeSettingTime(byId.later, tuesdayAfternoon) === null
  );
  check(
    "later today is offered in the morning",
    hm(snoozeSettingTime(byId.later, at("2026-09-15T09:00:00"))) === "2 15:00"
  );
  check("tomorrow is Wed 08:00", hm(snoozeSettingTime(byId.tomorrow, tuesdayAfternoon)) === "3 08:00");
  check("this weekend is Sat 10:00", hm(snoozeSettingTime(byId.weekend, tuesdayAfternoon)) === "6 10:00");
  check("next week is Mon 08:00", hm(snoozeSettingTime(byId.nextweek, tuesdayAfternoon)) === "1 08:00");

  const saturdayMorning = at("2026-09-19T09:00:00");
  const weekend = snoozeSettingTime(byId.weekend, saturdayMorning);
  check("on Saturday at 09:00, this weekend is today", weekend?.getDate() === 19, hm(weekend));
  const lateSaturday = snoozeSettingTime(byId.weekend, at("2026-09-19T11:00:00"));
  check("after 10:00 on Saturday, it is the next Saturday", lateSaturday?.getDate() === 26, lateSaturday);

  const fresh = newSnoozeSetting(defaults);
  check(
    "a new option opens on the first free slot, in 2 days at 08:00",
    fresh.unit === "days" && fresh.count === 2 && fresh.time === "08:00" && fresh.label === "",
    JSON.stringify(fresh)
  );
  check("and clashes with nothing", snoozeClash(defaults, fresh) === null);

  const onto = { ...fresh, unit: "weekday", weekday: 6, time: "10:00" };
  check("a change onto a taken slot names the option there", snoozeClash(defaults, onto)?.id === "weekend");
  check("an option does not clash with itself", snoozeClash(defaults, byId.weekend) === null);

  check("nothing saved reads the defaults", parseSnoozeSettings(null).length === 5);
  check("an unreadable list reads the defaults", parseSnoozeSettings("{oops").length === 5);
  check("an empty saved list stays empty", parseSnoozeSettings("[]").length === 0);
  const saved = parseSnoozeSettings(
    JSON.stringify([
      { id: "a", label: "Soon", unit: "hours", count: 3, weekday: 1, time: "08:00" },
      { id: "b", label: "Also soon", unit: "hours", count: 3, weekday: 1, time: "08:00" },
      { id: "c", label: "Odd", unit: "fortnights", count: 1 },
      { id: "d", label: "", unit: "days", count: 999, weekday: 9, time: "25:00" },
    ])
  );
  check(
    "a saved list drops a clash and an unknown unit, and repairs values out of range",
    saved.map((s) => s.id).join(",") === "a,d" && saved[1].count === 1 && saved[1].time === "08:00",
    JSON.stringify(saved)
  );
});
