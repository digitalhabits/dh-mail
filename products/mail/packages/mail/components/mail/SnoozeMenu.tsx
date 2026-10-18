"use client";

/**
 * Picking when a thread should come back.
 *
 * The offered times are worked out from the current time — "this evening" is
 * gone by 9pm, "tomorrow" starts at 8am — so the list changes through the day
 * and an option that has passed is never shown.
 */

import * as React from "react";
import { ChevronRight, RotateCwFadingClock } from "lucide-react";

import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { currentMailLocale, useMailT } from "@/lib/mail/i18n";
import { CalendarTimePicker, MenuHeading, PresetRow, pickedLabel } from "@/components/mail/date-time-pick";
import { readSnoozeSettings, snoozeLabelsFor } from "@/lib/mail/snooze-settings";
import { resolveOptions } from "@/lib/mail/timed-options";
import { cn } from "@/lib/utils";

/** One offered time: what it is called, when it is, and the time itself. */
export type SnoozeOption = {
  id: string;
  label: string;
  detail: string;
  iso: string;
};
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
  const now = new Date();
  return resolveOptions(
    snoozeLabelsFor(readSnoozeSettings(), now),
    now,
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

  // Recompute times each time the menu opens. `open` is in the list for that
  // purpose, although the body does not read it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const options = React.useMemo(() => snoozeOptions(), [open]);

  const choose = (iso: string) => {
    setOpen(false);
    setStep("presets");
    onSnooze(iso);
  };

  /** Where the calendar opens: tomorrow's date is picked by the reader; 09:00. */
  const calendarStart = () => {
    const at = new Date();
    at.setHours(9, 0, 0, 0);
    return at;
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setStep("presets");
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
        className={cn(step === "presets" ? "w-64" : "w-[280px]", "rounded-xl p-1.5")}
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
            <MenuHeading>{t("snoozeUntilHeading")}</MenuHeading>
            {currentUntil ? (
              <p className="px-2.5 pb-1 text-[11px] text-stone-400">
                {t("snoozedUntilNow", { when: formatSnoozeWakeLabel(currentUntil) })}
              </p>
            ) : null}
            {options.map((option) => (
              <PresetRow key={option.id} label={option.label} detail={option.detail} onClick={() => choose(option.iso)} />
            ))}
            <div className="mx-1.5 my-1 border-t border-stone-100" />
            <PresetRow
              label={t("pickDateAndTime")}
              onClick={() => setStep("custom")}
              trailing={<ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />}
            />
            {onCancelSnooze ? (
              <>
                <div className="mx-1.5 my-1 border-t border-stone-100" />
                <button
                  type="button"
                  className="flex w-full rounded-lg px-2.5 py-1.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
                  onClick={() => {
                    setOpen(false);
                    setStep("presets");
                    onCancelSnooze();
                  }}
                >
                  {t("cancelSnooze")}
                </button>
              </>
            ) : null}
          </div>
        ) : (
          <div>
            <MenuHeading onBack={() => setStep("presets")}>{t("snoozeUntilHeading")}</MenuHeading>
            <CalendarTimePicker
              initial={calendarStart()}
              pickDay
              action={(at) => t("snoozeUntilWhen", { when: pickedLabel(at, t("todayLower")) })}
              onPick={(at) => choose(at.toISOString())}
            />
          </div>
        )}
      </MailPopoverContent>
    </Popover>
  );
}
