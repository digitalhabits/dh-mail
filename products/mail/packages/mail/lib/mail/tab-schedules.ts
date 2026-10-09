"use client";

/**
 * When a built-in filter should be the one waiting for you.
 *
 * A reader's own list can already ask to be the tab Mail opens on between,
 * say, nine and eleven — that is what `scheduleDefault` on a custom list is.
 * The built-in four could not, and they are the ones most people live in: In
 * Contacts in the morning, All after lunch.
 *
 * So the same schedule, kept for them too. Only the schedule: there is
 * nothing else about All or In Contacts to change — no name of yours, no
 * list of people — which is why the editor they open is the schedule alone.
 *
 * Local, like the lists themselves and like every other way of arranging
 * this app.
 */

import * as React from "react";

import {
  DEFAULT_SCHEDULE_FROM,
  DEFAULT_SCHEDULE_TO,
  isScheduleActiveNow,
  normalizeScheduleDays,
  type MailScheduleDay,
} from "@/lib/mail/custom-lists";

export const MAIL_TAB_SCHEDULE_KEY = "redd-plan-mail-tab-schedules";
export const MAIL_TAB_SCHEDULE_EVENT = "redd-plan-mail-tab-schedules-changed";

export type MailTabSchedule = {
  enabled: boolean;
  /** "HH:MM", 24-hour. */
  from: string;
  to: string;
  days: MailScheduleDay[];
};

export type MailTabSchedules = Record<string, MailTabSchedule>;

function normalize(value: unknown): MailTabSchedule | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<MailTabSchedule>;
  if (!raw.enabled) return null;
  return {
    enabled: true,
    from: typeof raw.from === "string" ? raw.from : DEFAULT_SCHEDULE_FROM,
    to: typeof raw.to === "string" ? raw.to : DEFAULT_SCHEDULE_TO,
    days: normalizeScheduleDays(raw.days),
  };
}

export function readTabSchedules(): MailTabSchedules {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(MAIL_TAB_SCHEDULE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: MailTabSchedules = {};
    for (const [tab, value] of Object.entries(parsed)) {
      const schedule = normalize(value);
      if (schedule) out[tab] = schedule;
    }
    return out;
  } catch {
    return {};
  }
}

/** A schedule that is off is not stored — it is the absence of one. */
export function setTabSchedule(
  tab: string,
  schedule: MailTabSchedule | null
): void {
  if (typeof window === "undefined") return;
  const all = readTabSchedules();
  if (schedule?.enabled) all[tab] = { ...schedule, days: normalizeScheduleDays(schedule.days) };
  else delete all[tab];
  try {
    localStorage.setItem(MAIL_TAB_SCHEDULE_KEY, JSON.stringify(all));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(MAIL_TAB_SCHEDULE_EVENT));
}

/**
 * The built-in tab scheduled for now, or null.
 *
 * `order` is the row as the reader has it, so two overlapping schedules are
 * settled the way the row is read: the first one wins.
 */
/** Every built-in filter whose set times are now; All is no filter. */
export function scheduledBuiltinTabIds(order: readonly string[], now: Date = new Date()): string[] {
  const schedules = readTabSchedules();
  return order.filter((tab) => tab !== "all" && schedules[tab] && isScheduleActiveNow(schedules[tab], now));
}

export function scheduledBuiltinTabId(
  order: readonly string[],
  now: Date = new Date()
): string | null {
  const schedules = readTabSchedules();
  for (const tab of order) {
    const schedule = schedules[tab];
    if (schedule && isScheduleActiveNow(schedule, now)) return tab;
  }
  return null;
}

let cached: MailTabSchedules | null = null;
const EMPTY: MailTabSchedules = {};

export function useTabSchedules(): MailTabSchedules {
  return React.useSyncExternalStore(
    (onChange) => {
      const listener = () => {
        cached = null;
        onChange();
      };
      window.addEventListener(MAIL_TAB_SCHEDULE_EVENT, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(MAIL_TAB_SCHEDULE_EVENT, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => (cached ??= readTabSchedules()),
    () => EMPTY
  );
}
