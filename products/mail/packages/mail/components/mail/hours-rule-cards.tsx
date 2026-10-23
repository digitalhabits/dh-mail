"use client";

/**
 * The hours on, as a card a rule: two times, an All day switch, the days as
 * circles, and "+ Add more hours" under them.
 *
 * One editor for every place that sets hours: "Shown in Mail" and "New mail
 * arrives" in the menus (pause-panels.tsx), and the questions asked when a
 * mailbox is connected (AccountRhythmDialog.tsx). The rules are the hours
 * on; what a setting keeps is worked out from them (account-rhythm.ts).
 */

import { X } from "lucide-react";

import { TimeField } from "@/components/mail/date-time-pick";
import { SwitchTrack } from "@/components/mail/settings-ui";
import { ALWAYS_RULE, isAllDay } from "@/lib/mail/account-rhythm";
import { SCHEDULE_DAY_LABELS, WEEKDAY_DAYS, type MailScheduleDay } from "@/lib/mail/custom-lists";
import { useMailT } from "@/lib/mail/i18n";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { cn } from "@/lib/utils";

/** The hours a new rule starts with: the working day. */
export const WORKING_DAY: MailQuietWindow = { start: "08:00", end: "17:00", days: [...WEEKDAY_DAYS] };

/** Only the one rule that means always: nothing to take away. */
export function isAlwaysOnly(rows: MailQuietWindow[]): boolean {
  return rows.length === 1 && isAllDay(rows[0]) && rows[0].days.length === 7;
}

export function toggleDay(days: MailScheduleDay[], day: MailScheduleDay): MailScheduleDay[] {
  return days.includes(day) ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b);
}

/** The rules as cards. `onRows` gets the whole list after each change. */
export function HoursRuleCards({
  rows,
  onRows,
  className,
}: {
  rows: MailQuietWindow[];
  onRows: (rows: MailQuietWindow[]) => void;
  className?: string;
}) {
  const t = useMailT();
  const alwaysOnly = isAlwaysOnly(rows);
  const keep = (next: MailQuietWindow[]) => onRows(next.length ? next : [ALWAYS_RULE]);
  const patch = (index: number, part: Partial<MailQuietWindow>) =>
    keep(rows.map((window, i) => (i === index ? { ...window, ...part } : window)));
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {rows.map((window, index) => (
        <div key={index} className="rounded-control bg-[var(--mail-hours-card)] p-2.5">
          <div className="flex items-center gap-2">
            <TimeField
              label={t("rhythmFrom")}
              value={window.start}
              onChange={(start) => patch(index, { start })}
              className={isAllDay(window) ? "opacity-40" : undefined}
            />
            <span className="text-stone-400">–</span>
            <TimeField
              label={t("rhythmTo")}
              value={window.end}
              onChange={(end) => patch(index, { end })}
              className={isAllDay(window) ? "opacity-40" : undefined}
            />
            <span className="min-w-0 flex-1" />
            {/* All day as a switch, not 00:00 – 00:00 (2026-10-18). Off
                again goes back to the working day. */}
            <SmallSwitch
              label={t("hoursAllDay")}
              on={isAllDay(window)}
              onChange={(on) => patch(index, on ? { start: "00:00", end: "00:00" } : { start: "08:00", end: "17:00" })}
            />
            {alwaysOnly || rows.length < 2 ? null : (
              <button
                type="button"
                aria-label={t("rhythmRemoveHours")}
                title={t("rhythmRemoveHours")}
                className="shrink-0 rounded p-0.5 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => keep(rows.filter((_, i) => i !== index))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <DayCircles days={window.days} onToggle={(day) => patch(index, { days: toggleDay(window.days, day) })} />
        </div>
      ))}
      <button
        type="button"
        className="self-start px-1 text-xs font-semibold text-[var(--mail-hours-accent)] hover:text-[var(--mail-hours-accent-hover)]"
        onClick={() => keep(alwaysOnly ? [WORKING_DAY] : [...rows, WORKING_DAY])}
      >
        {t("addMoreHours")}
      </button>
    </div>
  );
}

/** A small on/off switch, drawn as the Stacks switch is. */
export function SmallSwitch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="flex shrink-0 items-center gap-1.5 text-xs text-stone-600"
      onClick={() => onChange(!on)}
    >
      {label}
      <SwitchTrack small on={on} className={on ? "bg-[var(--mail-switch-on)]" : "bg-stone-300"} />
    </button>
  );
}

export function DayCircles({
  days,
  onToggle,
}: {
  days: MailScheduleDay[];
  onToggle: (day: MailScheduleDay) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {SCHEDULE_DAY_LABELS.map(({ day, label }) => {
        const on = days.includes(day);
        return (
          <button
            key={day}
            type="button"
            aria-pressed={on}
            aria-label={label}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold",
              on
                ? "bg-[var(--mail-hours-accent)] text-white"
                : "border border-stone-300 bg-white text-stone-500 hover:border-stone-400"
            )}
            onClick={() => onToggle(day)}
          >
            {label.slice(0, 1)}
          </button>
        );
      })}
    </div>
  );
}
