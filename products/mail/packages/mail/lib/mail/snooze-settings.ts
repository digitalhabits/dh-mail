/**
 * The snooze options: the times the snooze menu and Send later offer.
 *
 * The rules for a list of times are in timed-options, shared with the pause
 * menu's list. This file holds what is the snooze menu's own: where its list
 * is kept, and the five times it starts with.
 *
 * No React here, so a test can run it directly.
 */

import { mailSay } from "@/lib/mail/i18n-strings";
import {
  MAX_OPTION_DAYS,
  MAX_OPTION_HOURS,
  TIMED_UNITS,
  newOption,
  optionClash,
  optionSlot,
  optionTime,
  parseOptionTime,
  readOptionList,
  readStoredOptions,
  resetStoredOptions,
  saveStoredOptions,
  storedOptionsRaw,
  type TimedOption,
  type TimedOptionStore,
  type TimedUnit,
} from "@/lib/mail/timed-options";

export type SnoozeUnit = TimedUnit;
export type SnoozeSetting = TimedOption;

export const SNOOZE_UNITS = TIMED_UNITS;
export const MAX_SNOOZE_HOURS = MAX_OPTION_HOURS;
export const MAX_SNOOZE_DAYS = MAX_OPTION_DAYS;

export const SNOOZE_SETTINGS_KEY = "redd-plan-mail-snooze-options";
export const SNOOZE_SETTINGS_EVENT = "redd-plan-mail-snooze-options-changed";

export function defaultSnoozeSettings(): SnoozeSetting[] {
  const base = { count: 1, weekday: 1, time: "08:00" };
  return [
    { ...base, id: "1h", label: mailSay("snoozeInOneHour"), unit: "hours" },
    { ...base, id: "later", label: mailSay("snoozeLaterToday"), unit: "today", time: "15:00" },
    { ...base, id: "tomorrow", label: mailSay("snoozeTomorrow"), unit: "days" },
    { ...base, id: "weekend", label: mailSay("snoozeThisWeekend"), unit: "weekday", weekday: 6, time: "10:00" },
    { ...base, id: "nextweek", label: mailSay("snoozeNextWeek"), unit: "weekday", weekday: 1 },
  ];
}

/**
 * "This weekend" said as "Next weekend" once this weekend's time has gone.
 *
 * On a Saturday after its 10:00 (or the time the reader set), or on a
 * Sunday, the weekend row comes to the Saturday a week on — and "This
 * weekend" read as later today or tomorrow. Only the row the list starts
 * with, under the name it starts with: a name the reader chose is theirs.
 */
export function snoozeLabelsFor(list: SnoozeSetting[], now: Date): SnoozeSetting[] {
  const weekendDay = now.getDay() === 6 || now.getDay() === 0;
  if (!weekendDay) return list;
  const defaultNames = new Set(["This weekend", "Denne weekend", mailSay("snoozeThisWeekend")]);
  return list.map((option) => {
    if (option.id !== "weekend" || !defaultNames.has(option.label.trim())) return option;
    const at = optionTime(option, now);
    if (!at || at.getTime() - now.getTime() < 2 * 24 * 60 * 60 * 1000) return option;
    return { ...option, label: mailSay("snoozeNextWeekend") };
  });
}

/** The snooze list's place in storage. */
export const SNOOZE_OPTIONS: TimedOptionStore = {
  key: SNOOZE_SETTINGS_KEY,
  event: SNOOZE_SETTINGS_EVENT,
  defaults: defaultSnoozeSettings,
};

export const parseSnoozeTime = parseOptionTime;
export const snoozeSlot = optionSlot;
export const snoozeClash = optionClash;
export const snoozeSettingTime = optionTime;
export const newSnoozeSetting = newOption;

export function parseSnoozeSettings(raw: string | null): SnoozeSetting[] {
  return readOptionList(raw, defaultSnoozeSettings);
}

export function readSnoozeSettings(): SnoozeSetting[] {
  return readStoredOptions(SNOOZE_OPTIONS);
}

/** Whether the reader has changed the list from the defaults. */
export function snoozeSettingsCustomised(): boolean {
  return storedOptionsRaw(SNOOZE_OPTIONS) != null;
}

export function saveSnoozeSettings(settings: SnoozeSetting[]): void {
  saveStoredOptions(SNOOZE_OPTIONS, settings);
}

export function resetSnoozeSettings(): void {
  resetStoredOptions(SNOOZE_OPTIONS);
}
