"use client";

/**
 * Picking when a thread should come back.
 *
 * The offered times are worked out from the current time — "this evening" is
 * gone by 9pm, "tomorrow" starts at 8am — so the list changes through the day
 * and an option that has passed is never shown.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight, RotateCwFadingClock } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { currentMailLocale, mailSay, useMailT } from "@/lib/mail/i18n";
import { readSnoozeSettings } from "@/lib/mail/snooze-settings";
import { resolveOptions } from "@/lib/mail/timed-options";
import { cn } from "@/lib/utils";

/** One offered time: what it is called, when it is, and the time itself. */
export type SnoozeOption = {
  id: string;
  label: string;
  detail: string;
  iso: string;
};
const SNOOZE_TIME_CHIPS = ["08:00", "09:00", "13:00", "17:00"] as const;
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
/** 24h clock matching the snooze menu mockups, e.g. "15:00". */
export function formatSnoozeClock(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
/** Weekday + clock, e.g. "Thu 08:00". */
export function formatSnoozeDayTime(d: Date): string {
  const day = d.toLocaleDateString(currentMailLocale(), { weekday: "short" });
  return `${day} ${formatSnoozeClock(d)}`;
}
/** Full commit label, e.g. "Tue 4 Aug, 09:00". */
function formatSnoozeCommitLabel(d: Date): string {
  const day = d.toLocaleDateString(currentMailLocale(), { weekday: "short" });
  const date = d.toLocaleDateString(currentMailLocale(), { day: "numeric", month: "short" });
  return `${day} ${date}, ${formatSnoozeClock(d)}`;
}
/** Toast / wake label — time only when still today. */
export function formatSnoozeWakeLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return formatSnoozeClock(d);
  }
  return formatSnoozeDayTime(d);
}
function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
/** Calendar-day Date (midnight local) — distinct from list helper `startOfDay` (epoch ms). */
function snoozeDayStart(d: Date): Date {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}
/** Monday-start month grid (6 weeks) for the custom snooze calendar. */
function snoozeMonthGrid(month: Date): { date: Date; inMonth: boolean }[] {
  const year = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(year, m, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, m, 1 - mondayOffset);
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    cells.push({ date, inMonth: date.getMonth() === m });
  }
  return cells;
}
function combineSnoozeDateTime(date: Date, hm: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}
/**
 * The times on offer, worked out from now, from the options the reader set
 * up under Settings → Snooze options.
 *
 * Send later shows the same list, so the two menus cannot drift into
 * offering different hours for the same words.
 */
export function snoozeOptions(): SnoozeOption[] {
  // Rows whose time has passed, or that come to the same time as a row above
  // them, are left out — see resolveOptions.
  return resolveOptions(
    readSnoozeSettings(),
    new Date(),
    formatSnoozeClock,
    formatSnoozeDayTime
  ).map((row) => ({
    id: row.id,
    label: row.label,
    detail: row.detail,
    iso: row.at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
/** Click-a-row presets; custom is a second step with calendar + time chips. */
export function SnoozeMenu({
  onSnooze,
  onCancelSnooze,
  currentUntil,
  trigger,
  openSignal,
  onOpenChange,
  title = "Snooze",
}: {
  onSnooze: (untilIso: string) => void;
  onCancelSnooze?: () => void;
  currentUntil?: string;
  trigger?: React.ReactNode;
  /** Bump to open the menu from elsewhere — the keyboard shortcut does. */
  openSignal?: number;
  /**
   * Told when the menu opens and closes. A trigger that only exists on hover
   * needs this: it must stay on screen while the menu is open, or the pointer
   * moving to the menu unmounts the trigger under it.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * What the trigger says on hover. Given by the caller, because the key
   * that opens this is the caller's to know and the reader's to be told.
   */
  title?: string;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  // One report for every path that opens or closes the menu — the trigger, the
  // keyboard signal, and each row that commits a time.
  React.useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  React.useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);
  const [step, setStep] = React.useState<"presets" | "custom">("presets");
  const [viewMonth, setViewMonth] = React.useState(() => snoozeDayStart(new Date()));
  const [selectedDate, setSelectedDate] = React.useState<Date | null>(null);
  const [timeHm, setTimeHm] = React.useState("09:00");

  const listRef = React.useRef<HTMLDivElement | null>(null);

  /** The rows of the presets step, in the order they are read. */
  const presetButtons = React.useCallback(
    () =>
      Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])"
        ) ?? []
      ),
    []
  );

  /**
   * Up and Down walk the times; Enter takes the one you are on.
   *
   * A popover is not a menu — Radix moves no focus between its children —
   * so the keys were leaving the menu entirely and reaching the window
   * handler that moves the selected thread. Opening the snooze menu with
   * the keyboard and then pressing Down changed which conversation you
   * were about to snooze, silently.
   *
   * `stopPropagation` is the half that fixes that: whatever this does or
   * does not do with the key, it does not travel on to the list.
   */
  const onListKeyDown = (event: React.KeyboardEvent) => {
    // The custom step has a calendar and a time box of its own, where an
    // arrow key means something else and the caret needs its own.
    if (step !== "presets") return;
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const buttons = presetButtons();
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? at < 0
          ? 0
          : (at + 1) % buttons.length
        : at < 0
          ? buttons.length - 1
          : (at - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  // Recompute times each time the menu opens.
  const options = React.useMemo(() => snoozeOptions(), [open]);
  const today = snoozeDayStart(new Date());
  const monthCells = React.useMemo(() => snoozeMonthGrid(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleDateString(currentMailLocale(), {
    month: "long",
    year: "numeric",
  });

  const resetCustom = () => {
    const now = new Date();
    setStep("presets");
    setViewMonth(snoozeDayStart(now));
    setSelectedDate(null);
    setTimeHm("09:00");
  };

  const choose = (iso: string) => {
    setOpen(false);
    resetCustom();
    onSnooze(iso);
  };

  const customUntil = selectedDate
    ? combineSnoozeDateTime(selectedDate, timeHm)
    : null;
  const customValid =
    customUntil != null && customUntil.getTime() > Date.now();

  const submitCustom = () => {
    if (!customValid || !customUntil) {
      toast.error(mailSay("pickTimeInFuture"));
      return;
    }
    choose(customUntil.toISOString());
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetCustom();
      }}
    >
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("snooze")}
            title={title}
            className={THREAD_ACTION_CLASS}
          >
            <RotateCwFadingClock />
          </Button>
        )}
      </PopoverTrigger>
      <MailPopoverContent
        /* Named, so a menu this one opens out of can tell a press in here
           from a press outside itself — see ThreadToolbarOverflow. */
        data-mail-snooze-menu
        align="start"
        className={cn(
          step === "presets" ? "w-64 p-1.5" : "w-[280px] p-3",
          "rounded-xl"
        )}
        onKeyDown={onListKeyDown}
        /**
         * The first time, focused, rather than the box it sits in. Radix
         * focuses the content element itself, which takes the keys without
         * being able to act on any of them: Enter did nothing and the
         * arrows went to the thread list.
         */
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          if (step === "custom") return;
          requestAnimationFrame(() => presetButtons()[0]?.focus());
        }}
      >
        {step === "presets" ? (
          <div ref={listRef}>
            {currentUntil ? (
              <p className="px-2.5 pb-1 pt-1 text-[11px] text-stone-400">
                Currently until {formatSnoozeWakeLabel(currentUntil)}
              </p>
            ) : null}
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                /* `mail-menu-pick`: the row under the pointer or the
                   arrow keys takes the navy the rail marks a chosen folder
                   with, so what is about to happen is unmistakable. */
                className="mail-menu-pick flex w-full items-baseline justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm"
                onClick={() => choose(option.iso)}
              >
                <span className="font-semibold text-stone-800">{option.label}</span>
                <span className="text-sm tabular-nums text-stone-400">
                  {option.detail}
                </span>
              </button>
            ))}
            <div className="mx-1.5 my-1 border-t border-stone-100" />
            <button
              type="button"
              className="mail-menu-pick flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-stone-800"
              onClick={() => setStep("custom")}
            >
              <span>
                {t("pickDateAndTime")}
              </span>
              <ChevronRight className="h-4 w-4 text-stone-400" aria-hidden />
            </button>
            {onCancelSnooze ? (
              <>
                <div className="mx-1.5 my-1 border-t border-stone-100" />
                <button
                  type="button"
                  className="flex w-full rounded-lg px-2.5 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setOpen(false);
                    resetCustom();
                    onCancelSnooze();
                  }}
                >
                  {t("cancelSnooze")}
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label={t("previousMonth")}
                className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                onClick={() =>
                  setViewMonth((m) => {
                    const next = new Date(m);
                    next.setMonth(next.getMonth() - 1);
                    return snoozeDayStart(next);
                  })
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <p className="font-serif text-[15px] font-bold text-stone-900">{monthLabel}</p>
              <button
                type="button"
                aria-label={t("nextMonth")}
                className="rounded-md p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                onClick={() =>
                  setViewMonth((m) => {
                    const next = new Date(m);
                    next.setMonth(next.getMonth() + 1);
                    return snoozeDayStart(next);
                  })
                }
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center">
              {["M", "T", "W", "T", "F", "S", "S"].map((label, i) => (
                <span
                  key={`${label}-${i}`}
                  className="py-1 text-[11px] font-medium text-stone-400"
                >
                  {label}
                </span>
              ))}
              {monthCells.map(({ date, inMonth }) => {
                const disabled = snoozeDayStart(date).getTime() < today.getTime();
                const selected =
                  selectedDate != null && sameCalendarDay(date, selectedDate);
                const isToday = sameCalendarDay(date, today);
                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setSelectedDate(snoozeDayStart(date));
                      if (date.getMonth() !== viewMonth.getMonth()) {
                        setViewMonth(snoozeDayStart(date));
                      }
                    }}
                    className={cn(
                      "mx-auto flex h-8 w-8 items-center justify-center rounded-lg text-sm tabular-nums transition-colors",
                      !inMonth && "text-stone-300",
                      inMonth && !selected && "text-stone-700",
                      disabled && "cursor-not-allowed opacity-40",
                      !disabled && !selected && "hover:bg-stone-100",
                      isToday && !selected && "ring-1 ring-stone-300",
                      selected && "bg-teal-700 font-semibold text-white hover:bg-teal-700"
                    )}
                  >
                    {date.getDate()}
                  </button>
                );
              })}
            </div>

            {/*
              The time is a field you can always see and type in, and the
              chips under it are shortcuts that fill it. There used to be a
              "…" chip that opened the field, and nobody could tell what the
              dots were for. The field shows the time that will be used, so
              the chips have no chosen look of their own.
            */}
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 border-t border-stone-100 pt-3">
              <span className="text-sm text-stone-400">at</span>
              <input
                type="time"
                aria-label={t("customTime")}
                value={timeHm}
                onChange={(e) => setTimeHm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  submitCustom();
                }}
                className="w-full rounded-lg border border-teal-600 bg-white px-2.5 py-1.5 text-sm tabular-nums text-stone-800 outline-none focus:ring-2 focus:ring-teal-600/20"
              />
              <span aria-hidden />
              <div className="grid grid-cols-4 gap-1.5">
                {SNOOZE_TIME_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setTimeHm(chip)}
                    className="rounded-lg border border-stone-200 py-1 text-xs font-medium tabular-nums text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              disabled={!customValid}
              onClick={submitCustom}
              className={cn(
                "w-full rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                customValid
                  ? "bg-teal-700 text-white hover:bg-teal-800"
                  : "cursor-not-allowed bg-stone-100 text-stone-400"
              )}
            >
              {customValid && customUntil
                ? `Snooze until ${formatSnoozeCommitLabel(customUntil)}`
                : selectedDate
                  ? "Pick a future time"
                  : "Pick a date"}
            </button>
          </div>
        )}
      </MailPopoverContent>
    </Popover>
  );
}
