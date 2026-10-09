/**
 * The pause menu offers the reader's own times, and the rest of today ends
 * at midnight.
 */

import { defaultPauseOptions } from "@/lib/mail/pause-options";
import { mailPauseOptions } from "@/lib/mail/quiet-hours";
import { normaliseOptionTime, optionTime, readOptionList, resolveOptions } from "@/lib/mail/timed-options";

import { check, suite } from "./harness.mjs";

const clock = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const dayClock = (d) => `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${clock(d)}`;
const say = (key) => key;

suite(async () => {
  // Friday 21 August 2026.
  const friday = (hm) => {
    const [h, m] = hm.split(":").map(Number);
    return new Date(2026, 7, 21, h, m, 0);
  };

  const mine = [
    { id: "a", label: "Two hours", unit: "hours", count: 2, weekday: 1, time: "08:00" },
    { id: "b", label: "Until the evening", unit: "today", count: 1, weekday: 1, time: "18:00" },
    { id: "c", label: "", unit: "weekday", count: 1, weekday: 2, time: "09:30" },
  ];
  const rows = mailPauseOptions(friday("09:26"), say, clock, dayClock, mine);
  check(
    "the menu offers the reader's own times, in their order",
    rows.map((r) => `${r.label} ${r.detail}`).join(" · ") ===
      "Two hours 11:26 · Until the evening 18:00 · Tue 09:30 ",
    rows.map((r) => `${r.label} ${r.detail}`).join(" · ")
  );
  check("an option with no name is called by its time", rows[2]?.label === "Tue 09:30");

  const evening = mailPauseOptions(friday("19:00"), say, clock, dayClock, mine);
  check("a time today that has passed is left out", !evening.some((r) => r.id === "b"), evening.map((r) => r.id).join());

  const today = defaultPauseOptions(say).find((o) => o.id === "today");
  const midnight = optionTime(today, friday("15:00"));
  check(
    "the rest of today ends at the midnight that closes it",
    midnight?.getDate() === 22 && midnight?.getHours() === 0,
    midnight
  );
  check(
    "and is said as 24:00",
    resolveOptions([today], friday("15:00"), clock, dayClock)[0]?.detail === "24:00"
  );

  check("24:00 is a time, 24:30 is not", normaliseOptionTime("24:00") === "24:00" && normaliseOptionTime("24:30") === null);
  check("9:05 is kept as 09:05", normaliseOptionTime("9:05") === "09:05");

  check(
    "nothing saved reads the five pause times",
    readOptionList(null, () => defaultPauseOptions(say)).map((o) => o.id).join() === "hour,noon,today,tomorrow,monday"
  );
  check(
    "a saved 24:00 survives being read back",
    readOptionList(JSON.stringify([today]), () => [])[0]?.time === "24:00"
  );
});
