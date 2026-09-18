/**
 * Pausing the mail, and the quiet hours that pause it by themselves.
 *
 * New mail arriving all morning is new mail deciding what the morning is
 * about. These are the rules for not letting it: a pause that ends at a
 * time, and the standing hours underneath it.
 */

import {
  addQuietSuggestion,
  formatClock,
  mailPauseOptions,
  mailPauseVerdict,
  parseClock,
  quietSuggestionApplied,
  readPauseState,
  withinWindow,
  MAIL_QUIET_SUGGESTIONS,
} from "@/lib/mail/quiet-hours";

import { check, suite } from "./harness.mjs";

/** A clock, on a day that does not matter. */
const at = (clock) => {
  const [h, m] = clock.split(":").map(Number);
  return new Date(2026, 7, 21, h, m, 0);
};

suite(async () => {
  check("a clock reads as minutes", parseClock("08:30") === 510);
  check("and back again", formatClock(510) === "08:30");
  check("half past midnight is not half past twenty-four", formatClock(1470) === "00:30");
  check("nonsense is not a time", parseClock("25:00") === null && parseClock("") === null);

  // The window, and the one that crosses midnight.
  check(
    "a morning window holds the morning",
    withinWindow(parseClock("09:00"), parseClock("08:00"), parseClock("12:00")) === true
  );
  check(
    "and lets the afternoon through",
    withinWindow(parseClock("13:00"), parseClock("08:00"), parseClock("12:00")) === false
  );
  check(
    "a night window holds the night on both sides of midnight",
    withinWindow(parseClock("23:30"), parseClock("22:00"), parseClock("08:00")) === true &&
      withinWindow(parseClock("02:00"), parseClock("22:00"), parseClock("08:00")) === true
  );
  check(
    "and lets the day through",
    withinWindow(parseClock("12:00"), parseClock("22:00"), parseClock("08:00")) === false
  );
  check(
    "the end is the moment it wakes, not the last minute asleep",
    withinWindow(parseClock("08:00"), parseClock("22:00"), parseClock("08:00")) === false
  );
  check(
    "a window of no width stops nothing — a half-typed time must not stop the mail",
    withinWindow(parseClock("09:00"), parseClock("09:00"), parseClock("09:00")) === false
  );

  // The verdict, over a week that is not one shape.
  const everyDay = [0, 1, 2, 3, 4, 5, 6];
  const weekdays = [0, 1, 2, 3, 4];
  const weekend = [5, 6];
  /** 21 Aug 2026 is a Friday; the 22nd a Saturday. */
  const friday = (clock) => at(clock);
  const saturday = (clock) => {
    const d = at(clock);
    d.setDate(d.getDate() + 1);
    return d;
  };

  const calmMorning = {
    paused: false,
    quietHours: [{ start: "00:00", end: "12:00", days: weekdays }],
  };
  check(
    "a calm weekday morning: asleep at nine, and it says when it wakes",
    JSON.stringify(mailPauseVerdict(calmMorning, friday("09:00"))) ===
      JSON.stringify({ paused: true, reason: "quiet", until: null, untilClock: "12:00" })
  );
  check("awake at noon", mailPauseVerdict(calmMorning, friday("12:00")).paused === false);
  check(
    "and awake all Saturday, which the hours do not name",
    mailPauseVerdict(calmMorning, saturday("09:00")).paused === false
  );

  // The point of several: different hours on different days.
  const week = {
    quietHours: [
      { start: "00:00", end: "12:00", days: weekdays },
      { start: "00:00", end: "16:00", days: weekend },
    ],
  };
  check(
    "the weekend keeps its own longer morning",
    mailPauseVerdict(week, saturday("14:00")).untilClock === "16:00"
  );
  check(
    "and the weekday one is over by then",
    mailPauseVerdict(week, friday("14:00")).paused === false
  );

  const overlapping = {
    quietHours: [
      { start: "22:00", end: "08:00", days: everyDay },
      { start: "00:00", end: "12:00", days: everyDay },
    ],
  };
  check(
    "two that overlap are one sleep, ending at the later of them",
    mailPauseVerdict(overlapping, friday("07:00")).untilClock === "12:00"
  );

  check(
    "a pause the reader set wins while it lasts",
    JSON.stringify(mailPauseVerdict({ ...week, pausedUntil: at("16:00").getTime() }, friday("15:00"))) ===
      JSON.stringify({ paused: true, reason: "pause", until: at("16:00"), untilClock: "16:00" })
  );
  check(
    "no pause and no hours is an ordinary mailbox",
    mailPauseVerdict({ quietHours: [] }, friday("09:00")).paused === false
  );

  // What a stored value means.
  check(
    "hours with days come back as they were",
    JSON.stringify(
      readPauseState({ quietHours: [{ start: "22:00", end: "08:00", days: weekdays }] })
    ) === JSON.stringify({ quietHours: [{ start: "22:00", end: "08:00", days: weekdays }] })
  );
  check(
    "the one shape from before a week could differ becomes every day",
    JSON.stringify(readPauseState({ schedule: { start: "22:00", end: "08:00" } }).quietHours) ===
      JSON.stringify([{ start: "22:00", end: "08:00", days: everyDay }])
  );
  check(
    "hours on no days are no hours, rather than hours that never come round",
    readPauseState({ quietHours: [{ start: "09:00", end: "12:00", days: [] }] }).quietHours.length === 0
  );
  check(
    "a broken time is dropped, and does not stop the mail for ever",
    readPauseState({ quietHours: [{ start: "nope", end: "08:00", days: everyDay }] }).quietHours.length === 0
  );
  check(
    "and nothing at all is the ordinary mailbox",
    readPauseState(null).pausedUntil === undefined &&
      readPauseState("x").quietHours.length === 0
  );
  check(
    "a pause with no end, from before pauses had one, becomes an hour",
    Math.abs(
      (readPauseState({ paused: true }).pausedUntil ?? 0) - (Date.now() + 3600_000)
    ) < 5_000
  );

  // A pause that runs out inside the quiet hours does not start the mail up
  // in the middle of them.
  const night = { quietHours: [{ start: "22:00", end: "08:00", days: everyDay }] };
  const ranOut = { ...night, pausedUntil: at("23:00").getTime() };
  check(
    "when the pause is over the hours are asked, not the mail",
    mailPauseVerdict(ranOut, at("23:30")).reason === "quiet" &&
      mailPauseVerdict(ranOut, at("23:30")).untilClock === "08:00"
  );

  // The rows the menu offers.
  const say = (key) => key;
  const clock = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const morning = mailPauseOptions(friday("09:26"), say, clock, clock);
  check(
    "on a Friday morning: an hour, noon, today, tomorrow, Monday",
    morning.map((o) => o.id).join() === "hour,noon,today,tomorrow,monday",
    morning.map((o) => `${o.id} ${o.detail}`).join(" · ")
  );
  check(
    "and the hour is an hour away",
    morning.find((o) => o.id === "hour")?.detail === "10:26"
  );
  const afternoon = mailPauseOptions(friday("15:00"), say, clock, clock);
  check(
    "past noon, Until noon is not offered — it would end the pause before it started",
    !afternoon.some((o) => o.id === "noon"),
    afternoon.map((o) => o.id).join()
  );
  const sunday = (clock2) => {
    const d = at(clock2);
    d.setDate(d.getDate() + 2);
    return d;
  };
  check(
    "on a Sunday, tomorrow is Monday, so Monday is not a second row for it",
    mailPauseOptions(sunday("15:00"), say, clock, clock)
      .map((o) => o.id)
      .join() === "hour,today,tomorrow",
    mailPauseOptions(sunday("15:00"), say, clock, clock).map((o) => o.id).join()
  );

  // The suggestions: hours to take rather than hours to invent.
  const weekendOff = MAIL_QUIET_SUGGESTIONS.find((s) => s.id === "weekend");
  const nightly = MAIL_QUIET_SUGGESTIONS.find((s) => s.id === "nights");
  check(
    "the three suggestions are there, and every one of them is hours on days",
    MAIL_QUIET_SUGGESTIONS.length === 3 &&
      MAIL_QUIET_SUGGESTIONS.every((s) =>
        s.windows.every((w) => parseClock(w.start) != null && w.days.length)
      )
  );
  const once = addQuietSuggestion([], nightly);
  check("a suggestion taken is hours standing", once.length === 1);
  check("and taken again is the same one", addQuietSuggestion(once, nightly).length === 1);
  check("which is why it stops being a suggestion", quietSuggestionApplied(once, nightly));
  check("while the others still are", !quietSuggestionApplied(once, weekendOff));

  // Friday evening to Monday morning is one stretch to a reader, and that
  // is what the weekend suggestion has to come to.
  const off = { quietHours: addQuietSuggestion([], weekendOff) };
  const day = (date, clock2) => {
    const [h, m] = clock2.split(":").map(Number);
    return new Date(2026, 7, date, h, m, 0);
  };
  check("Friday teatime still fetches", !mailPauseVerdict(off, day(21, "16:00")).paused);
  check("Friday evening does not", mailPauseVerdict(off, day(21, "18:00")).paused);
  check("nor Saturday night", mailPauseVerdict(off, day(22, "02:00")).paused);
  check("nor Saturday afternoon", mailPauseVerdict(off, day(22, "13:00")).paused);
  check("nor Sunday evening", mailPauseVerdict(off, day(23, "23:00")).paused);
  check("nor Monday before eight", mailPauseVerdict(off, day(24, "07:00")).paused);
  check("and Monday morning the week starts again", !mailPauseVerdict(off, day(24, "09:00")).paused);
});
