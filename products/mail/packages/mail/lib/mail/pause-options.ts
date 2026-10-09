/**
 * The pause options: the times the menu for pausing new mail offers.
 *
 * The rules for a list of times are in timed-options, shared with the snooze
 * menu's list. This file holds what is the pause menu's own: where its list
 * is kept, and the five times it starts with — the same five the menu always
 * had. "Rest of today" ends at 24:00, the midnight that closes the day.
 *
 * No React here, so a test can run it directly.
 */

import { mailSay } from "@/lib/mail/i18n-strings";
import {
  readStoredOptions,
  type TimedOption,
  type TimedOptionStore,
} from "@/lib/mail/timed-options";

export type PauseOptionWord =
  | "pauseHour"
  | "pauseNoon"
  | "pauseToday"
  | "pauseTomorrow"
  | "pauseMonday";

/** The five times, named in the words `say` gives. */
export function defaultPauseOptions(
  say: (key: PauseOptionWord) => string = (key) => mailSay(key)
): TimedOption[] {
  const base = { count: 1, weekday: 1, time: "08:00" };
  return [
    { ...base, id: "hour", label: say("pauseHour"), unit: "hours" },
    { ...base, id: "noon", label: say("pauseNoon"), unit: "today", time: "12:00" },
    { ...base, id: "today", label: say("pauseToday"), unit: "today", time: "24:00" },
    { ...base, id: "tomorrow", label: say("pauseTomorrow"), unit: "days" },
    { ...base, id: "monday", label: say("pauseMonday"), unit: "weekday", weekday: 1 },
  ];
}

/** The pause list's place in storage. */
export const PAUSE_OPTIONS: TimedOptionStore = {
  key: "redd-plan-mail-pause-options",
  event: "redd-plan-mail-pause-options-changed",
  defaults: () => defaultPauseOptions(),
};

export function readPauseOptions(): TimedOption[] {
  return readStoredOptions(PAUSE_OPTIONS);
}
