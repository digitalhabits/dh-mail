/**
 * The addresses that hand an invite to a web calendar.
 *
 * This is date arithmetic dressed as a URL, which is the kind that fails
 * without looking like it has: a stamp an hour out, or an all-day event that
 * lands on the day before, still produces a link that opens a calendar. The
 * two traps are here. A timed event is stamped in UTC. An all-day one is
 * parsed to noon local — read that in UTC and anybody far enough east is
 * given yesterday — so it has to be taken apart with the local getters.
 */

import {
  googleCalendarUrl,
  outlookCalendarUrl,
  readCalendarTarget,
} from "@/lib/mail/calendar-targets";
import { check, suite } from "./harness.mjs";

const timed = {
  summary: "Weekly planning",
  start: new Date(Date.UTC(2026, 8, 15, 9, 0, 0)),
  end: new Date(Date.UTC(2026, 8, 15, 10, 30, 0)),
  allDay: false,
  location: "Room 2",
  joinUrl: "https://meet.example/abc",
};

/** As `parseIcsDate` builds one: the named day, at noon on the local clock. */
const allDay = {
  summary: "Company day",
  start: new Date(2026, 8, 15, 12, 0, 0, 0),
  end: new Date(2026, 8, 16, 12, 0, 0, 0),
  allDay: true,
  location: "",
  joinUrl: null,
};

suite(async () => {
  // ---- Google --------------------------------------------------------------
  const g = new URL(googleCalendarUrl(timed));
  check("google is asked for a new event",
    g.searchParams.get("action") === "TEMPLATE");
  check("a timed event is stamped in UTC, start and end",
    g.searchParams.get("dates") === "20260915T090000Z/20260915T103000Z",
    g.searchParams.get("dates"));
  check("the subject travels", g.searchParams.get("text") === "Weekly planning");
  check("the place travels", g.searchParams.get("location") === "Room 2");
  check("the join link travels, being the reason for half of these",
    g.searchParams.get("details") === "https://meet.example/abc");

  const gAll = new URL(googleCalendarUrl(allDay));
  check("an all-day event is named by its day, not by an instant",
    gAll.searchParams.get("dates") === "20260915/20260916",
    gAll.searchParams.get("dates"));

  // The end of an all-day event is exclusive in iCalendar and in Google, so
  // a one-day event that never said when it ended still ends the next day.
  const gOpen = new URL(
    googleCalendarUrl({ ...allDay, end: null })
  );
  check("an all-day event with no end gets the next day",
    gOpen.searchParams.get("dates") === "20260915/20260916",
    gOpen.searchParams.get("dates"));

  const gNoEnd = new URL(googleCalendarUrl({ ...timed, end: null }));
  check("a timed event with no end is given an hour",
    gNoEnd.searchParams.get("dates") === "20260915T090000Z/20260915T100000Z",
    gNoEnd.searchParams.get("dates"));

  // ---- Outlook -------------------------------------------------------------
  const o = new URL(outlookCalendarUrl(timed));
  check("outlook is asked for a new event",
    o.searchParams.get("rru") === "addevent" &&
      o.searchParams.get("path") === "/calendar/action/compose");
  check("the work host, which is where this app's Outlook accounts live",
    o.host === "outlook.office.com", o.host);
  check("a timed event goes as an instant",
    o.searchParams.get("startdt") === "2026-09-15T09:00:00.000Z",
    o.searchParams.get("startdt"));
  check("the subject travels to outlook too",
    o.searchParams.get("subject") === "Weekly planning");
  check("a timed event is not marked all-day",
    o.searchParams.get("allday") === null);

  const oAll = new URL(outlookCalendarUrl(allDay));
  check("an all-day event is marked as one",
    oAll.searchParams.get("allday") === "true");
  check("and is named by its day",
    oAll.searchParams.get("startdt") === "2026-09-15" &&
      oAll.searchParams.get("enddt") === "2026-09-16",
    `${oAll.searchParams.get("startdt")}/${oAll.searchParams.get("enddt")}`);

  // ---- Nothing to hand over ------------------------------------------------
  const undated = { ...timed, start: null };
  check("an invite with no start makes no google link",
    googleCalendarUrl(undated) === null);
  check("an invite with no start makes no outlook link",
    outlookCalendarUrl(undated) === null);

  // ---- The remembered pick -------------------------------------------------
  // No localStorage in Node: reading has to answer "never picked" rather
  // than throw, or the card cannot render at all.
  check("with no storage to read, there is no remembered pick",
    readCalendarTarget() === null);
});
