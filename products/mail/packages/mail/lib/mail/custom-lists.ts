/** Client-persisted custom mail tabs that filter by selected people. */

export type MailCustomListMember = {
  email: string;
  name: string;
};

/**
 * Days for a schedule window: Monday = 0 … Sunday = 6
 * (same convention as Digital Habits Blocker).
 */
export type MailScheduleDay = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type MailCustomList = {
  id: string;
  name: string;
  members: MailCustomListMember[];
  /** Prefer this tab when local clock matches the schedule window + days. */
  scheduleDefault?: boolean;
  /** Local time "HH:MM" (24h). */
  scheduleFrom?: string;
  /** Local time "HH:MM" (24h). */
  scheduleTo?: string;
  /** Mon0…Sun6. Omitted when schedule is off; defaults to weekdays when on. */
  scheduleDays?: MailScheduleDay[];
};

export type MailCustomListSchedule = {
  enabled: boolean;
  from: string;
  to: string;
  days: MailScheduleDay[];
};

const MAIL_CUSTOM_LISTS_KEY = "redd-plan-mail-custom-lists";
export const MAIL_CUSTOM_LISTS_EVENT = "redd-plan-mail-custom-lists-changed";

/** Stable empty snapshot for SSR / useSyncExternalStore. */
const EMPTY_CUSTOM_LISTS: MailCustomList[] = [];

/**
 * Cached parse of localStorage. useSyncExternalStore requires getSnapshot to
 * return the same reference when data hasn't changed — a fresh [] each call
 * causes an infinite re-render loop.
 */
let cachedRaw: string | null | undefined;
let cachedLists: MailCustomList[] = EMPTY_CUSTOM_LISTS;

export const DEFAULT_SCHEDULE_FROM = "09:00";
export const DEFAULT_SCHEDULE_TO = "12:00";
export const WEEKDAY_DAYS: MailScheduleDay[] = [0, 1, 2, 3, 4];
export const WEEKEND_DAYS: MailScheduleDay[] = [5, 6];
export const EVERY_DAY: MailScheduleDay[] = [0, 1, 2, 3, 4, 5, 6];

export const SCHEDULE_DAY_LABELS: { day: MailScheduleDay; label: string }[] = [
  { day: 0, label: "Mon" },
  { day: 1, label: "Tue" },
  { day: 2, label: "Wed" },
  { day: 3, label: "Thu" },
  { day: 4, label: "Fri" },
  { day: 5, label: "Sat" },
  { day: 6, label: "Sun" },
];

export function customListTabId(listId: string): string {
  return `custom:${listId}`;
}

export function parseCustomListTabId(tab: string): string | null {
  return tab.startsWith("custom:") ? tab.slice("custom:".length) : null;
}

export function isCustomListTab(tab: string): boolean {
  return tab.startsWith("custom:");
}

function newListId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Minutes from midnight, or null if not HH:MM. */
export function parseTimeToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
}

export function normalizeTimeHm(value: string, fallback: string): string {
  const mins = parseTimeToMinutes(value);
  if (mins == null) return fallback;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** JS Sunday=0 → Mon0…Sun6. */
export function jsDayToMon0(date: Date): MailScheduleDay {
  const js = date.getDay();
  return (js === 0 ? 6 : js - 1) as MailScheduleDay;
}

export function normalizeScheduleDays(raw: unknown): MailScheduleDay[] {
  if (!Array.isArray(raw)) return [...WEEKDAY_DAYS];
  const seen = new Set<MailScheduleDay>();
  const out: MailScheduleDay[] = [];
  for (const value of raw) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0 || n > 6) continue;
    const day = n as MailScheduleDay;
    if (seen.has(day)) continue;
    seen.add(day);
    out.push(day);
  }
  out.sort((a, b) => a - b);
  return out.length ? out : [...WEEKDAY_DAYS];
}

export function sameDaySet(
  a: readonly MailScheduleDay[],
  b: readonly MailScheduleDay[]
): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  return left.every((d, i) => d === right[i]);
}

/**
 * True when local `now` falls in the schedule window on an allowed day.
 * Overnight windows (e.g. 22:00–06:00) count the morning against the
 * previous day's selection (same as Digital Habits Blocker).
 */
export function isScheduleActiveNow(
  schedule: Pick<
    MailCustomListSchedule,
    "enabled" | "from" | "to" | "days"
  >,
  now: Date = new Date()
): boolean {
  if (!schedule.enabled || !schedule.days.length) return false;
  const start = parseTimeToMinutes(schedule.from);
  const end = parseTimeToMinutes(schedule.to);
  if (start == null || end == null) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const day = jsDayToMon0(now);
  const days = new Set(schedule.days);

  if (start === end) {
    return days.has(day);
  }
  if (start < end) {
    return days.has(day) && cur >= start && cur < end;
  }
  // Overnight.
  if (cur >= start) return days.has(day);
  if (cur < end) {
    const prev = (day === 0 ? 6 : day - 1) as MailScheduleDay;
    return days.has(prev);
  }
  return false;
}

/**
 * Tab id for the first custom list scheduled for the current local time,
 * or null when none apply.
 */
export function scheduledCustomListTabId(
  lists: MailCustomList[],
  now: Date = new Date()
): string | null {
  return scheduledCustomListTabIds(lists, now)[0] ?? null;
}

/** Every list of yours whose set times are now: they apply together. */
export function scheduledCustomListTabIds(
  lists: MailCustomList[],
  now: Date = new Date()
): string[] {
  const out: string[] = [];
  for (const list of lists) {
    if (!list.scheduleDefault) continue;
    const schedule: MailCustomListSchedule = {
      enabled: true,
      from: list.scheduleFrom || DEFAULT_SCHEDULE_FROM,
      to: list.scheduleTo || DEFAULT_SCHEDULE_TO,
      days: normalizeScheduleDays(list.scheduleDays),
    };
    if (isScheduleActiveNow(schedule, now)) out.push(customListTabId(list.id));
  }
  return out;
}

function parseCustomLists(raw: string | null): MailCustomList[] {
  if (!raw) return EMPTY_CUSTOM_LISTS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY_CUSTOM_LISTS;
    const out: MailCustomList[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const id = String((item as MailCustomList).id || "").trim();
      const name = String((item as MailCustomList).name || "").trim();
      const membersRaw = (item as MailCustomList).members;
      if (!id || !name || seen.has(id) || !Array.isArray(membersRaw)) continue;
      const members: MailCustomListMember[] = [];
      const seenEmail = new Set<string>();
      for (const m of membersRaw) {
        if (!m || typeof m !== "object") continue;
        const email = String((m as MailCustomListMember).email || "")
          .trim()
          .toLowerCase();
        if (!email || seenEmail.has(email)) continue;
        seenEmail.add(email);
        members.push({
          email,
          name: String((m as MailCustomListMember).name || "").trim(),
        });
      }
      seen.add(id);
      const scheduleDefault = Boolean(
        (item as MailCustomList).scheduleDefault
      );
      out.push({
        id,
        name,
        members,
        scheduleDefault,
        scheduleFrom: scheduleDefault
          ? normalizeTimeHm(
              String((item as MailCustomList).scheduleFrom || ""),
              DEFAULT_SCHEDULE_FROM
            )
          : undefined,
        scheduleTo: scheduleDefault
          ? normalizeTimeHm(
              String((item as MailCustomList).scheduleTo || ""),
              DEFAULT_SCHEDULE_TO
            )
          : undefined,
        scheduleDays: scheduleDefault
          ? normalizeScheduleDays((item as MailCustomList).scheduleDays)
          : undefined,
      });
    }
    return out.length ? out : EMPTY_CUSTOM_LISTS;
  } catch {
    return EMPTY_CUSTOM_LISTS;
  }
}

export function readCustomLists(): MailCustomList[] {
  if (typeof window === "undefined") return EMPTY_CUSTOM_LISTS;
  try {
    const raw = localStorage.getItem(MAIL_CUSTOM_LISTS_KEY);
    if (raw === cachedRaw) return cachedLists;
    cachedRaw = raw;
    cachedLists = parseCustomLists(raw);
    return cachedLists;
  } catch {
    return EMPTY_CUSTOM_LISTS;
  }
}

export function writeCustomLists(lists: MailCustomList[]): void {
  const raw = JSON.stringify(lists);
  try {
    localStorage.setItem(MAIL_CUSTOM_LISTS_KEY, raw);
  } catch {
    /* private mode */
  }
  cachedRaw = raw;
  cachedLists = lists.length ? lists : EMPTY_CUSTOM_LISTS;
  window.dispatchEvent(new Event(MAIL_CUSTOM_LISTS_EVENT));
}

function scheduleFields(
  schedule?: MailCustomListSchedule
): Pick<
  MailCustomList,
  "scheduleDefault" | "scheduleFrom" | "scheduleTo" | "scheduleDays"
> {
  if (!schedule?.enabled) {
    return { scheduleDefault: false };
  }
  return {
    scheduleDefault: true,
    scheduleFrom: normalizeTimeHm(schedule.from, DEFAULT_SCHEDULE_FROM),
    scheduleTo: normalizeTimeHm(schedule.to, DEFAULT_SCHEDULE_TO),
    scheduleDays: normalizeScheduleDays(schedule.days),
  };
}

export function createCustomList(
  name: string,
  members: MailCustomListMember[],
  schedule?: MailCustomListSchedule
): MailCustomList {
  const list: MailCustomList = {
    id: newListId(),
    name: name.trim(),
    members: members.map((m) => ({
      email: m.email.trim().toLowerCase(),
      name: m.name.trim(),
    })),
    ...scheduleFields(schedule),
  };
  writeCustomLists([...readCustomLists(), list]);
  return list;
}

export function updateCustomList(
  id: string,
  patch: {
    name: string;
    members: MailCustomListMember[];
    schedule?: MailCustomListSchedule;
  }
): MailCustomList | null {
  const lists = readCustomLists();
  const index = lists.findIndex((l) => l.id === id);
  if (index < 0) return null;
  const next: MailCustomList = {
    id,
    name: patch.name.trim(),
    members: patch.members.map((m) => ({
      email: m.email.trim().toLowerCase(),
      name: m.name.trim(),
    })),
    ...scheduleFields(patch.schedule),
  };
  const copy = lists.slice();
  copy[index] = next;
  writeCustomLists(copy);
  return next;
}

export function deleteCustomList(id: string): void {
  writeCustomLists(readCustomLists().filter((l) => l.id !== id));
}

/** True when any external participant is in the list. */
export function threadMatchesCustomList(
  thread: {
    fromEmail: string;
    externalParticipants?: { email: string }[];
  },
  list: MailCustomList
): boolean {
  if (!list.members.length) return false;
  const wanted = new Set(list.members.map((m) => m.email.toLowerCase()));
  const participants =
    thread.externalParticipants && thread.externalParticipants.length
      ? thread.externalParticipants
      : [{ email: thread.fromEmail }];
  return participants.some((p) => wanted.has(p.email.toLowerCase()));
}
