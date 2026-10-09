/**
 * Where an invite goes when the reader says "add it".
 *
 * The one answer used to be the calendar application on this machine, which
 * is the wrong answer for anybody whose calendar lives on the web. These are
 * the three places, the addresses that reach the two web ones, and the memory
 * of which one was picked last.
 */

import type { ParsedCalendarInvite } from "@/lib/mail/ics";

export type CalendarTarget = "app" | "google" | "outlook";

export const CALENDAR_TARGETS: CalendarTarget[] = ["app", "google", "outlook"];

const CALENDAR_TARGET_KEY = "redd-plan-mail-calendar-target";

function isCalendarTarget(value: unknown): value is CalendarTarget {
  return (
    value === "app" || value === "google" || value === "outlook"
  );
}

/** The remembered pick, or null when there has never been one. */
export function readCalendarTarget(): CalendarTarget | null {
  try {
    const stored = localStorage.getItem(CALENDAR_TARGET_KEY);
    return isCalendarTarget(stored) ? stored : null;
  } catch {
    /* private mode */
    return null;
  }
}

export function writeCalendarTarget(target: CalendarTarget): void {
  try {
    localStorage.setItem(CALENDAR_TARGET_KEY, target);
  } catch {
    /* private mode */
  }
}

/** `20260915T093000Z` — the stamp both web calendars read for a timed event. */
function utcStamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/**
 * The day this date names, read off the local clock.
 *
 * An all-day date is parsed to noon local (see `parseIcsDate`), which is the
 * one time of day that survives being read back in any zone. Reading it in
 * UTC instead would name the day before for anybody far enough east, so an
 * all-day event has to be taken apart with the local getters.
 */
function localDayParts(at: Date): { y: number; m: number; d: number } {
  return { y: at.getFullYear(), m: at.getMonth() + 1, d: at.getDate() };
}

function compactDay(at: Date): string {
  const { y, m, d } = localDayParts(at);
  return `${y}${String(m).padStart(2, "0")}${String(d).padStart(2, "0")}`;
}

function dashedDay(at: Date): string {
  const { y, m, d } = localDayParts(at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A day later, for an all-day event that never said when it ended. */
function dayAfter(at: Date): Date {
  const next = new Date(at);
  next.setDate(next.getDate() + 1);
  return next;
}

/**
 * When the event ends, as the web calendars want it.
 *
 * iCalendar's DTEND is exclusive — an all-day event on the 15th ends on the
 * 16th — and both Google and Outlook read the end of an all-day event the
 * same way, so the value passes straight through. An hour is the guess for a
 * timed event with no end, which is the length of most meetings that forgot
 * to say.
 */
function endFor(invite: ParsedCalendarInvite, start: Date): Date {
  if (invite.end) return invite.end;
  if (invite.allDay) return dayAfter(start);
  return new Date(start.getTime() + 60 * 60 * 1000);
}

/** The join link is worth carrying over; it is the reason for half of these. */
function detailsFor(invite: ParsedCalendarInvite): string {
  return invite.joinUrl ?? "";
}

/**
 * The Google Calendar page that opens with the event already filled in.
 *
 * Null when the invite never said when it starts: there is nothing to hand
 * over, and a template with no date is worse than the file.
 */
export function googleCalendarUrl(invite: ParsedCalendarInvite): string | null {
  if (!invite.start) return null;
  const end = endFor(invite, invite.start);
  const dates = invite.allDay
    ? `${compactDay(invite.start)}/${compactDay(end)}`
    : `${utcStamp(invite.start)}/${utcStamp(end)}`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: invite.summary,
    dates,
  });
  if (invite.location) params.set("location", invite.location);
  const details = detailsFor(invite);
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * The Outlook on the web page that opens with the event already filled in.
 *
 * `outlook.office.com` is the work and school host. A personal outlook.com
 * calendar answers on `outlook.live.com` instead, and this app's Outlook
 * accounts are Microsoft 365 ones — see the admin-consent note in the mail
 * plan — so the work host is the one worth defaulting to.
 */
export function outlookCalendarUrl(invite: ParsedCalendarInvite): string | null {
  if (!invite.start) return null;
  const end = endFor(invite, invite.start);

  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: invite.summary,
    startdt: invite.allDay ? dashedDay(invite.start) : invite.start.toISOString(),
    enddt: invite.allDay ? dashedDay(end) : end.toISOString(),
  });
  if (invite.allDay) params.set("allday", "true");
  if (invite.location) params.set("location", invite.location);
  const details = detailsFor(invite);
  if (details) params.set("body", details);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** The address for a web target, or null for the calendar application. */
export function calendarTargetUrl(
  target: CalendarTarget,
  invite: ParsedCalendarInvite
): string | null {
  if (target === "google") return googleCalendarUrl(invite);
  if (target === "outlook") return outlookCalendarUrl(invite);
  return null;
}
