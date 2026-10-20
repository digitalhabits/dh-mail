/**
 * How a mailbox fits the week: when it is shown in Mail, and when new mail
 * is fetched for it. Asked right after a mailbox is connected.
 *
 * The reader thinks in the times a mailbox is on. The settings underneath
 * keep the times it is off: the hiding schedule (mailbox-hide.ts) holds the
 * windows it is hidden in, and the pause (quiet-hours.ts) the windows
 * nothing is fetched. This turns one into the other, both ways, with no
 * change to how either is read.
 *
 * Two shapes carry a whole day or a day's end, as the schedule matcher
 * reads them (isScheduleActiveNow): "00:00"–"00:00" is the whole day, and
 * "17:00"–"00:00" runs from 17:00 to midnight.
 *
 * No React here, and no storage: the rules are the part a suite reads.
 */

import { EVERY_DAY, type MailScheduleDay } from "@/lib/mail/custom-lists";
import { formatClock, parseClock, type MailQuietWindow } from "@/lib/mail/quiet-hours";

/** The times a mailbox is on, as windows of the week. */
export type AccountRhythm = {
  /** When the mailbox and its mail are in Mail. */
  shown: MailQuietWindow[];
  /** When new mail is fetched. Only while it is shown. */
  fetching: MailQuietWindow[];
};

const WEEKDAYS: MailScheduleDay[] = [0, 1, 2, 3, 4];
const allDay = (days: MailScheduleDay[]): MailQuietWindow => ({ start: "00:00", end: "00:00", days });

/*
  The answers each question of the dialog offers (AccountRhythmDialog),
  as the hours on. The first is the default: a new mailbox is shown, and
  gets new mail, around the clock.
*/

export type ShownPreset = "always" | "weekdays" | "work";
export const SHOWN_PRESETS: Record<ShownPreset, MailQuietWindow[]> = {
  always: [allDay(EVERY_DAY)],
  weekdays: [allDay(WEEKDAYS)],
  work: [{ start: "08:00", end: "18:00", days: WEEKDAYS }],
};
export const SHOWN_PRESET_ORDER: ShownPreset[] = ["always", "weekdays", "work"];

export type FetchPreset = "always" | "twice" | "work";
export const FETCH_PRESETS: Record<FetchPreset, MailQuietWindow[]> = {
  always: [allDay(EVERY_DAY)],
  twice: [
    { start: "09:00", end: "10:00", days: WEEKDAYS },
    { start: "15:00", end: "16:00", days: WEEKDAYS },
  ],
  work: [{ start: "08:00", end: "18:00", days: WEEKDAYS }],
};
export const FETCH_PRESET_ORDER: FetchPreset[] = ["always", "twice", "work"];

/** Which answer these hours are, or null for hours of the reader's own. */
export function presetOf<P extends string>(
  presets: Record<P, MailQuietWindow[]>,
  order: P[],
  rows: MailQuietWindow[]
): P | null {
  return order.find((name) => sameWeek(presets[name], rows)) ?? null;
}

/** Minutes of one day, [from, to), from 0 to 1440. */
type Span = [number, number];

function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

/** Each day's minutes inside the windows, Monday first. */
export function daySpans(windows: MailQuietWindow[]): Span[][] {
  const days: Span[][] = EVERY_DAY.map(() => []);
  for (const window of windows) {
    const start = parseClock(window.start);
    const end = parseClock(window.end);
    if (start == null || end == null) continue;
    for (const day of window.days) {
      if (start === end) days[day].push([0, 1440]);
      else if (start < end) days[day].push([start, end]);
      else {
        // Over midnight: the evening on its day, the morning on the next.
        days[day].push([start, 1440]);
        if (end > 0) days[(day + 1) % 7].push([0, end]);
      }
    }
  }
  return days.map(merge);
}

function complement(spans: Span[]): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const [from, to] of spans) {
    if (from > at) out.push([at, from]);
    at = Math.max(at, to);
  }
  if (at < 1440) out.push([at, 1440]);
  return out;
}

/** Spans back to windows: days with the same hours share one window. */
function toWindows(days: Span[][]): MailQuietWindow[] {
  const byHours = new Map<string, MailQuietWindow>();
  days.forEach((spans, day) => {
    for (const [from, to] of spans) {
      const start = formatClock(from);
      const end = to >= 1440 ? "00:00" : formatClock(to);
      const key = `${start}-${end}`;
      const window = byHours.get(key) ?? { start, end, days: [] };
      window.days.push(day as MailScheduleDay);
      byHours.set(key, window);
    }
  });
  return [...byHours.values()].sort((a, b) => a.days[0] - b.days[0] || a.start.localeCompare(b.start));
}

/** The times it is off, from the times it is on — and the other way round. */
export function invertWindows(windows: MailQuietWindow[]): MailQuietWindow[] {
  return toWindows(daySpans(windows).map(complement));
}

/** One canonical form, so two ways of writing the same week compare equal. */
export function sameWeek(a: MailQuietWindow[], b: MailQuietWindow[]): boolean {
  return JSON.stringify(daySpans(a)) === JSON.stringify(daySpans(b));
}

/** What the settings keep: hidden windows, and windows nothing is fetched. */
export function rhythmToSettings(rhythm: AccountRhythm): {
  hiddenHours: MailQuietWindow[];
  quietHours: MailQuietWindow[];
} {
  // No rules, or a whole week of them, is always — never "never".
  return { hiddenHours: keptFromOnHours(rhythm.shown), quietHours: keptFromOnHours(rhythm.fetching) };
}

/** And back: the week as the reader sees it, from what the settings keep. */
export function rhythmFromSettings(hiddenHours: MailQuietWindow[], quietHours: MailQuietWindow[]): AccountRhythm {
  return { shown: invertWindows(hiddenHours), fetching: invertWindows(quietHours) };
}

export type RhythmState = "hidden" | "shown" | "fetching";

/**
 * Each day as runs of one state, for the week's picture: hidden, shown with
 * nothing new arriving, or shown with new mail arriving. Fetching counts
 * only while shown.
 */
export function rhythmSegments(rhythm: AccountRhythm): { from: number; to: number; state: RhythmState }[][] {
  const shown = daySpans(rhythm.shown);
  const fetching = daySpans(rhythm.fetching);
  const inside = (spans: Span[], minute: number) => spans.some(([from, to]) => minute >= from && minute < to);
  return EVERY_DAY.map((day) => {
    const edges = new Set<number>([0, 1440]);
    for (const [from, to] of [...shown[day], ...fetching[day]]) {
      edges.add(from);
      edges.add(to);
    }
    const points = [...edges].sort((a, b) => a - b);
    const runs: { from: number; to: number; state: RhythmState }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const from = points[i];
      const to = points[i + 1];
      const state: RhythmState = !inside(shown[day], from) ? "hidden" : inside(fetching[day], from) ? "fetching" : "shown";
      const last = runs[runs.length - 1];
      if (last && last.state === state) last.to = to;
      else runs.push({ from, to, state });
    }
    return runs;
  });
}

/*
  The settings screens speak the same way as the rhythm: a schedule says
  when a mailbox is shown, or when new mail does arrive, never when it does
  not. These turn what the two settings keep into those words and back.

  Nothing kept is "always": shown, or fetching, around the clock. The
  screens show that as one rule, "All day", every day. Taking every rule
  away, or setting one that covers the whole week, is "always" again —
  never "never", which would hide a mailbox for good by a slip.
*/

const WHOLE_WEEK: MailQuietWindow[] = [allDay(EVERY_DAY)];

/** The rules as the screens show them: the hours on. Empty is always. */
export function onHoursFromKept(kept: MailQuietWindow[]): MailQuietWindow[] {
  return kept.length ? invertWindows(kept) : [];
}

/** What the setting keeps for these hours on. Empty, or the whole week, keeps nothing. */
export function keptFromOnHours(on: MailQuietWindow[]): MailQuietWindow[] {
  if (!on.length || sameWeek(on, WHOLE_WEEK)) return [];
  return invertWindows(on);
}

/** The rule "always" is shown as, when nothing is kept. */
export const ALWAYS_RULE: MailQuietWindow = allDay(EVERY_DAY);

export function isAllDay(window: MailQuietWindow): boolean {
  return window.start === window.end && parseClock(window.start) === 0;
}

/** Runs past midnight into the next day. */
export function isOvernight(window: MailQuietWindow): boolean {
  const start = parseClock(window.start);
  const end = parseClock(window.end);
  return start != null && end != null && end < start;
}

export type OnHoursWords = {
  allDay: string;
  nextDay: string;
  daily: string;
  weekdays: string;
  weekends: string;
};

/** "daily", "weekdays", "weekends", or the days by name. */
export function daysPhrase(days: MailScheduleDay[], words: OnHoursWords, labels: { day: MailScheduleDay; label: string }[]): string {
  const sorted = [...days].sort((a, b) => a - b).join();
  if (days.length === 7) return words.daily;
  if (sorted === "0,1,2,3,4") return words.weekdays;
  if (sorted === "5,6") return words.weekends;
  return [...days]
    .sort((a, b) => a - b)
    .map((day) => labels.find((d) => d.day === day)?.label ?? "")
    .filter(Boolean)
    .join(" ");
}

/** One rule in words: "07:15 – 18:00 daily", "All day weekdays", "22:00 – 06:00 next day daily". */
export function onRulePhrase(window: MailQuietWindow, words: OnHoursWords, labels: { day: MailScheduleDay; label: string }[]): string {
  const days = daysPhrase(window.days, words, labels);
  if (isAllDay(window)) return `${words.allDay} ${days}`;
  const end = isOvernight(window) ? `${window.end} ${words.nextDay}` : window.end;
  return `${window.start} – ${end} ${days}`;
}

/** The hours on in a line, or null for always. */
export function onHoursSummary(
  kept: MailQuietWindow[],
  words: OnHoursWords,
  labels: { day: MailScheduleDay; label: string }[]
): string | null {
  const on = onHoursFromKept(kept);
  if (!on.length) return null;
  return on.map((window) => onRulePhrase(window, words, labels)).join(" · ");
}

/** Is everything a suggestion keeps already kept? Compared as weeks, whatever the shape. */
export function keptCovers(kept: MailQuietWindow[], extra: MailQuietWindow[]): boolean {
  return sameWeek([...kept, ...extra], kept);
}
