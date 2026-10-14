/**
 * Reading a calendar file: the time in the zone it names, and what the file
 * is (an invitation, an answer to one, or a calling-off).
 *
 * Reported 2026-10-13: an acceptance from an Outlook in Copenhagen showed
 * an hour late, and its "Add to Calendar" found no event to add. Every
 * name, address and event here is invented.
 */

import { parseCalendarInvite } from "@/lib/mail/ics";
import { check, suite } from "./harness.mjs";

const ics = (method, event) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", method ? `METHOD:${method}` : null, "BEGIN:VEVENT", ...event, "END:VEVENT", "END:VCALENDAR"]
    .filter(Boolean)
    .join("\r\n");

const iso = (d) => d?.toISOString() ?? "none";

suite(async () => {
  // ---- Times in a named zone ------------------------------------------------
  const copenhagen = parseCalendarInvite(
    ics("REQUEST", ["SUMMARY:Planning chat", "DTSTART;TZID=Europe/Copenhagen:20261013T143000", "DTEND;TZID=Europe/Copenhagen:20261013T151000"])
  );
  check("a time in a named zone is that zone's clock (summer, +2)", iso(copenhagen?.start) === "2026-10-13T12:30:00.000Z", iso(copenhagen?.start));
  check("and so is its end", iso(copenhagen?.end) === "2026-10-13T13:10:00.000Z", iso(copenhagen?.end));

  const outlook = parseCalendarInvite(
    ics("REQUEST", ["SUMMARY:Planning chat", 'DTSTART;TZID="Romance Standard Time":20261013T143000'])
  );
  check("Outlook's Windows zone names are read too", iso(outlook?.start) === "2026-10-13T12:30:00.000Z", iso(outlook?.start));

  const winter = parseCalendarInvite(ics("", ["SUMMARY:Board call", "DTSTART;TZID=America/New_York:20260115T090000"]));
  check("in winter the zone's own offset (-5)", iso(winter?.start) === "2026-01-15T14:00:00.000Z", iso(winter?.start));

  const utc = parseCalendarInvite(ics("", ["SUMMARY:Board call", "DTSTART:20260115T090000Z"]));
  check("a UTC time is as it was", iso(utc?.start) === "2026-01-15T09:00:00.000Z", iso(utc?.start));

  const unknown = parseCalendarInvite(ics("", ["SUMMARY:Board call", "DTSTART;TZID=Nowhere Standard Time:20260115T090000"]));
  check(
    "a zone nobody knows is read as local time, as before",
    unknown?.start?.getHours() === 9 && unknown?.start?.getMinutes() === 0,
    iso(unknown?.start)
  );

  // ---- What the file is -----------------------------------------------------
  const accepted = parseCalendarInvite(
    ics("REPLY", [
      "SUMMARY:Accepted: Planning chat",
      "DTSTART;TZID=Europe/Copenhagen:20261013T143000",
      'ATTENDEE;PARTSTAT=ACCEPTED;CN="Rasmus Holm":mailto:rasmus@example.org',
    ])
  );
  check("an answer is a REPLY", accepted?.method === "REPLY", accepted?.method);
  check(
    "it says who answered, and how",
    accepted?.reply?.name === "Rasmus Holm" && accepted?.reply?.status === "accepted",
    JSON.stringify(accepted?.reply)
  );

  const declined = parseCalendarInvite(
    ics("REPLY", ["SUMMARY:Planning chat", "DTSTART:20261013T123000Z", "ATTENDEE;PARTSTAT=DECLINED:mailto:rasmus@example.org"])
  );
  check(
    "with no name, the address stands in",
    declined?.reply?.name === "rasmus@example.org" && declined?.reply?.status === "declined",
    JSON.stringify(declined?.reply)
  );

  const invitation = parseCalendarInvite(
    ics("REQUEST", ["SUMMARY:Planning chat", "DTSTART:20261013T123000Z", "ATTENDEE;PARTSTAT=NEEDS-ACTION;CN=Rasmus Holm:mailto:rasmus@example.org"])
  );
  check("an invitation is a REQUEST, with no answer in it", invitation?.method === "REQUEST" && invitation?.reply === null, JSON.stringify(invitation?.reply));

  const cancelled = parseCalendarInvite(ics("CANCEL", ["SUMMARY:Planning chat", "DTSTART:20261013T123000Z"]));
  check("a calling-off is a CANCEL", cancelled?.method === "CANCEL", cancelled?.method);
});
