/**
 * Hours on, dragged on the week chart (lib/mail/hours-drag.ts): a bar a
 * rule a day, ends that move the rule, and new hours drawn on an empty day.
 */

import { addDayRule, barAt, dragRuleEnd, insideBar, moveRule, ruleBars, snapMinute } from "@/lib/mail/hours-drag";

import { check, suite } from "./harness.mjs";

const WEEKDAYS = [0, 1, 2, 3, 4];
const work = [{ start: "08:00", end: "18:00", days: WEEKDAYS }];

suite(async () => {
  const bars = ruleBars(work);
  check("a weekday rule draws a bar on each weekday", bars.slice(0, 5).every((day) => day.length === 1) && bars[5].length === 0);
  check("from 08:00 to 18:00", bars[0][0].from === 480 && bars[0][0].to === 1080);

  const night = ruleBars([{ start: "22:00", end: "06:00", days: [0] }]);
  check("a night draws the evening on its day", night[0][0].from === 1320 && night[0][0].to === 1440 && !night[0][0].endHandle);
  check("and the morning on the next", night[1][0].from === 0 && night[1][0].to === 360 && !night[1][0].startHandle);

  const allDay = ruleBars([{ start: "00:00", end: "00:00", days: [5] }]);
  check("all day is the whole of its day", allDay[5][0].from === 0 && allDay[5][0].to === 1440);

  check("a drag snaps to a quarter hour", snapMinute(0.5 + 7 / 1440) === 720);
  check("and stays inside the day", snapMinute(-0.2) === 0 && snapMinute(1.3) === 1440);

  const later = dragRuleEnd(work, 0, "end", 1140);
  check("dragging the end moves it for every day of the rule", later[0].end === "19:00" && later[0].days.length === 5);
  check("dragging the start moves it", dragRuleEnd(work, 0, "start", 540)[0].start === "09:00");
  check("an end is not dragged past the start", dragRuleEnd(work, 0, "end", 300)[0].end === "08:15");
  check("a start is not dragged past the end", dragRuleEnd(work, 0, "start", 1300)[0].start === "17:45");
  check("an end dragged to the edge is midnight", dragRuleEnd(work, 0, "end", 1440)[0].end === "00:00");
  check("the other rules are left as they are", dragRuleEnd([...work, { start: "20:00", end: "21:00", days: [6] }], 0, "end", 1140)[1].start === "20:00");
  const nightRows = [{ start: "22:00", end: "06:00", days: [0] }];
  check("a rule past midnight is not dragged out of shape", dragRuleEnd(nightRows, 0, "end", 400) === nightRows);

  const added = addDayRule(work, 5, 600, 540);
  check("a drag on an empty day adds hours for that day alone", added.length === 2 && added[1].start === "09:00" && added[1].end === "10:00" && added[1].days.join() === "5");
  check("a click adds at least a quarter hour", addDayRule([], 6, 600, 600)[0].end === "10:15");

  check("inside a bar is inside", insideBar(bars[0], 600));
  check("an end is not inside: it is a handle", !insideBar(bars[0], 480));
  check("an empty stretch is not inside", !insideBar(bars[0], 1200));

  const moved = moveRule(work, 0, 60, 0);
  check("a bar dragged an hour later moves the whole rule, its length kept", moved[0].start === "09:00" && moved[0].end === "19:00");
  check("it stops at the end of the day", moveRule(work, 0, 600, 0)[0].end === "00:00" && moveRule(work, 0, 600, 0)[0].start === "14:00");
  check("and at the start", moveRule(work, 0, -900, 0)[0].start === "00:00");
  check("dragged a day down, all its days move", moveRule(work, 0, 0, 1)[0].days.join() === "1,2,3,4,5");
  check("it stops at the end of the week", moveRule(work, 0, 0, 5)[0].days.join() === "2,3,4,5,6");
  check("and at the start of it", moveRule(work, 0, 0, -3)[0].days.join() === "0,1,2,3,4");
  check("an all-day rule moves by days only", JSON.stringify(moveRule([{ start: "00:00", end: "00:00", days: [5] }], 0, 120, -1)[0]) === JSON.stringify({ start: "00:00", end: "00:00", days: [4] }));
  check("the bar under a press is found", barAt(bars[0], 600)?.rule === 0 && barAt(bars[0], 1200) === null);
});
