/**
 * How mail shows dates and times in the list and in a thread.
 *
 * Pure functions. They read the clock and the viewer's locale, and nothing
 * else, so a change here shows up the same way in every surface.
 */

import {
  currentMailLocale,
  type MailStringKey,
  type MailT,
} from "@/lib/mail/i18n-strings";

export function startOfDay(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

/** The heading a day belongs under, as a key into `@/lib/mail/i18n`. */
export function dayBucket(iso: string): MailStringKey {
  const now = new Date();
  const today = startOfDay(now);
  const then = startOfDay(new Date(iso));
  const dayMs = 24 * 60 * 60 * 1000;
  if (then >= today) return "bucketToday";
  if (then >= today - dayMs) return "bucketYesterday";
  const daysAgo = Math.floor((today - then) / dayMs);
  const weekday = now.getDay() === 0 ? 7 : now.getDay(); // Monday-based
  if (daysAgo < weekday) return "bucketEarlierThisWeek";
  if (daysAgo < weekday + 7) return "bucketLastWeek";
  return "bucketEarlier";
}

export function rowTime(iso: string, options?: { withYear?: boolean }): string {
  const d = new Date(iso);
  const locale = currentMailLocale();
  if (options?.withYear) {
    // Search spans years — always show an absolute date.
    return d.toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }
  const bucket = dayBucket(iso);
  // Today / Yesterday already have section headers — show the clock time.
  if (bucket === "bucketToday" || bucket === "bucketYesterday") {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  if (bucket === "bucketEarlierThisWeek") {
    return d.toLocaleDateString(locale, { weekday: "short" });
  }
  return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
}

/**
 * The clock time, always — no "yesterday", no weekday.
 *
 * For a chat bubble, where the day is a heading further up and the only
 * question left about a message is what time it was said.
 */
export function timeOfDay(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(currentMailLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** True when two timestamps fall on the same calendar day, locally. */
export function sameDay(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}

/**
 * The heading over a day's messages in a chat.
 *
 * `dayBucket` answers a different question — it groups a list into Today,
 * Earlier this week, Last week — and "Earlier" over a run of bubbles says
 * nothing about which day they were. This names the day.
 */
export function chatDayLabel(iso: string | null, t: MailT): string {
  if (!iso) return "";
  const then = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  const dayMs = 24 * 60 * 60 * 1000;
  if (then === today) return t("bucketToday");
  if (then === today - dayMs) return t("bucketYesterday");
  const d = new Date(iso);
  const withinYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(currentMailLocale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withinYear ? null : { year: "numeric" }),
  });
}

export function shortDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(currentMailLocale(), {
    day: "numeric",
    month: "short",
  });
}

export function messageStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${shortDate(iso)}, ${d.toLocaleTimeString(currentMailLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * Client-side mirror of the server's Gmail-style quote appendix, so the
 * optimistic local bubble can collapse it behind "…" just like a fetched one.
 */

/**
 * A meeting's when, said in full: the day of the week, the date as digits,
 * and the hours it runs.
 *
 * "03/09/2026, 14:00" is what a native picker shows, in whichever order the
 * machine's locale puts the numbers — and it is the same nine digits either
 * way round, so a reader checking a date against a thread has to know which
 * convention they are looking at. The weekday settles it on its own, and
 * the date is written the one way that cannot be read backwards.
 *
 * The end time is here because it is what a duration means. "30" beside a
 * start time is a number; "14:00–14:30" is the meeting.
 */
export function meetingWhenLabel(
  start: string,
  durationMinutes: number
): string {
  const at = new Date(start);
  if (Number.isNaN(at.getTime())) return "";
  const locale = currentMailLocale();
  const weekday = at.toLocaleDateString(locale, { weekday: "long" });
  const date = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(
    at.getDate()
  ).padStart(2, "0")}`;
  const clock = (d: Date) =>
    d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false });
  const ends = new Date(at.getTime() + Math.max(0, durationMinutes) * 60_000);
  return `${weekday} ${date} · ${clock(at)}–${clock(ends)}`;
}
