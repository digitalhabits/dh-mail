"use client";

/**
 * The times the snooze, Send later and pause menus offer, as the Snooze &
 * schedule category in Settings.
 *
 * Two lists on one page, drawn the same way: the snooze options, which Send
 * later offers too, and the pause options. Each row reads as a sentence: a
 * name, then a value and a unit that say when ("Tomorrow · in 1 days at
 * 08:00"). The unit decides what the value box is: a number for hours and
 * days, a list of days for weekday, and nothing for today. "hours" has no
 * clock time, so "at" and the time box go away for it.
 *
 * Changes save as they are made, the way the other settings do. A change
 * that would put two options on the same slot is refused, and the row says
 * which option already has it.
 */

import * as React from "react";
import { ChevronsUpDown, GripVertical, Plus, X } from "lucide-react";

import { SettingsHeading, SettingsPane } from "@/components/mail/settings-ui";
import { currentMailLocale, useMailT, type MailT } from "@/lib/mail/i18n";
import { PAUSE_OPTIONS } from "@/lib/mail/pause-options";
import { SNOOZE_OPTIONS } from "@/lib/mail/snooze-settings";
import {
  MAX_OPTION_DAYS,
  MAX_OPTION_HOURS,
  TIMED_UNITS,
  newOption,
  normaliseOptionTime,
  optionClash,
  readOptionList,
  resetStoredOptions,
  saveStoredOptions,
  type TimedOption,
  type TimedOptionStore,
  type TimedUnit,
} from "@/lib/mail/timed-options";
import { cn } from "@/lib/utils";

/** One list, and whether it differs from its defaults. */
export function useTimedOptions(store: TimedOptionStore): {
  options: TimedOption[];
  customised: boolean;
} {
  const t = useMailT();
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      window.addEventListener(store.event, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(store.event, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    [store.event]
  );
  const readRaw = React.useCallback(() => {
    try {
      return localStorage.getItem(store.key);
    } catch {
      return null;
    }
  }, [store.key]);
  // The stored text is the snapshot: a string compares equal when nothing
  // changed, where a freshly parsed list never would.
  const raw = React.useSyncExternalStore(subscribe, readRaw, () => null);
  // Unsaved defaults are named in the app's language, so a change of language
  // must read them again.
  const languageMark = t("snoozeTomorrow");
  const options = React.useMemo(
    () => readOptionList(raw, store.defaults),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, languageMark, store]
  );
  return { options, customised: raw != null };
}

/** The snooze list, for the snooze menu's own readers. */
export function useSnoozeSettings(): { settings: TimedOption[]; customised: boolean } {
  const { options, customised } = useTimedOptions(SNOOZE_OPTIONS);
  return { settings: options, customised };
}

/** Monday first, the way the snooze calendar lays out a week. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

function weekdayName(day: number): string {
  // 13 September 2026 was a Sunday, so 13 + day falls on that weekday.
  return new Date(2026, 8, 13 + day).toLocaleDateString(currentMailLocale(), {
    weekday: "short",
  });
}

/** The slot in words, for a refusal: "Sat 10:00", "In 2 days at 08:00". */
function slotText(option: TimedOption, t: MailT): string {
  switch (option.unit) {
    case "hours":
      return option.count === 1
        ? t("snoozeInOneHour")
        : t("snoozeSlotHours", { count: option.count });
    case "today":
      return t("snoozeSlotToday", { time: option.time });
    case "days":
      return option.count === 1
        ? t("snoozeSlotTomorrow", { time: option.time })
        : t("snoozeSlotDays", { count: option.count, time: option.time });
    case "weekday":
      return `${weekdayName(option.weekday)} ${option.time}`;
  }
}

const UNIT_LABEL: Record<TimedUnit, Parameters<MailT>[0]> = {
  hours: "snoozeUnitHours",
  today: "snoozeUnitToday",
  days: "snoozeUnitDays",
  weekday: "snoozeUnitWeekday",
};

const fieldClass =
  "h-8 w-full min-w-0 rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

/**
 * A box whose text can be half typed. It keeps what is typed, saves it once it
 * is a value, and shows the saved value again when it loses focus.
 */
function DraftField({
  value,
  ariaLabel,
  placeholder,
  inputMode,
  className,
  accept,
}: {
  value: string;
  ariaLabel: string;
  placeholder?: string;
  inputMode?: "numeric" | "text";
  className?: string;
  /** Saves the text if it is a value. False when it is not, or is refused. */
  accept: (text: string) => boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      inputMode={inputMode}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        accept(e.target.value);
      }}
      onBlur={() => setDraft(value)}
      className={cn(fieldClass, "tabular-nums", className)}
    />
  );
}

function UnitSelect<T extends string | number>({
  value,
  ariaLabel,
  options,
  onChange,
}: {
  value: T;
  ariaLabel: string;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <span className="relative flex items-center">
      <select
        aria-label={ariaLabel}
        value={String(value)}
        onChange={(e) => {
          const picked = options.find((o) => String(o.value) === e.target.value);
          if (picked) onChange(picked.value);
        }}
        className={cn(fieldClass, "cursor-pointer appearance-none pr-6")}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown
        aria-hidden
        className="pointer-events-none absolute right-1.5 h-3.5 w-3.5 text-stone-400"
      />
    </span>
  );
}

/** One list of times: its rows, a way to add one, and a way back to the defaults. */
function TimedOptionsEditor({
  store,
  emptyText,
}: {
  store: TimedOptionStore;
  /** What the menu shows when the list is empty. */
  emptyText: string;
}) {
  const t = useMailT();
  const { options, customised } = useTimedOptions(store);
  const optionsRef = React.useRef(options);
  optionsRef.current = options;

  /** Why the last change to a row was refused. */
  const [notice, setNotice] = React.useState<{ id: string; text: string } | null>(null);
  const [focusId, setFocusId] = React.useState<string | null>(null);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  const save = (list: TimedOption[]) => saveStoredOptions(store, list);

  const update = (id: string, patch: Partial<TimedOption>): boolean => {
    const list = optionsRef.current;
    const current = list.find((o) => o.id === id);
    if (!current) return false;
    const next = { ...current, ...patch };
    const clash = optionClash(list, next);
    if (clash) {
      const slot = slotText(next, t);
      setNotice({
        id,
        text: clash.label.trim()
          ? t("snoozeClash", { slot, label: clash.label.trim() })
          : t("snoozeClashUnnamed", { slot }),
      });
      return false;
    }
    setNotice((n) => (n?.id === id ? null : n));
    save(list.map((o) => (o.id === id ? next : o)));
    return true;
  };

  const changeUnit = (option: TimedOption, unit: TimedUnit) => {
    const max = unit === "hours" ? MAX_OPTION_HOURS : MAX_OPTION_DAYS;
    update(option.id, { unit, count: Math.min(option.count, max) });
  };

  const add = () => {
    const fresh = newOption(optionsRef.current);
    save([...optionsRef.current, fresh]);
    setFocusId(fresh.id);
  };

  const remove = (id: string) => {
    setNotice((n) => (n?.id === id ? null : n));
    save(optionsRef.current.filter((o) => o.id !== id));
  };

  /** Puts the option at `index` among the others. */
  const moveTo = (id: string, index: number) => {
    const list = [...optionsRef.current];
    const from = list.findIndex((o) => o.id === id);
    if (from < 0) return;
    const [item] = list.splice(from, 1);
    const to = Math.max(0, Math.min(index, list.length));
    if (to === from) return;
    list.splice(to, 0, item);
    save(list);
  };

  const dragOver = (id: string, clientY: number) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-timed-row]") ?? []
    );
    // Where the pointer is among the other rows: how many of their middles
    // are above it.
    const index = rows.filter((row) => {
      if (row.dataset.timedRow === id) return false;
      const rect = row.getBoundingClientRect();
      return rect.top + rect.height / 2 < clientY;
    }).length;
    moveTo(id, index);
  };

  return (
    <div className="overflow-hidden rounded-xl bg-[var(--mail-chrome)]">
      <div ref={listRef} className="divide-y divide-stone-200">
        {options.length === 0 ? (
          <p className="px-4 py-3 text-sm text-stone-500">{emptyText}</p>
        ) : null}
        {options.map((option) => {
          const counted = option.unit === "hours" || option.unit === "days";
          const rowNotice = notice?.id === option.id ? notice.text : null;
          return (
            <div
              key={option.id}
              data-timed-row={option.id}
              className={cn(
                // One line on a wide window, lined up down the list. On a
                // narrower one the name has the first line and the "when"
                // wraps under it, rather than running off the edge. The
                // settings rail takes part of the width, so the one-line
                // layout waits for a large window.
                "grid grid-cols-[1.125rem_minmax(0,1fr)_1.5rem] items-center gap-x-2 gap-y-1.5 px-3 py-2.5 lg:grid-cols-[1.125rem_minmax(6.5rem,1fr)_1.75rem_4.5rem_6rem_1.5rem_5rem_1.5rem]",
                dragId === option.id && "bg-stone-200/60"
              )}
            >
              <button
                type="button"
                data-timed-grip={option.id}
                aria-label={t("snoozeMoveOption")}
                title={t("snoozeMoveOption")}
                className="flex h-8 cursor-grab touch-none items-center justify-center rounded text-stone-400 hover:text-stone-600 active:cursor-grabbing"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragId(option.id);
                }}
                onPointerMove={(e) => {
                  if (dragId === option.id) dragOver(option.id, e.clientY);
                }}
                onPointerUp={() => setDragId(null)}
                onPointerCancel={() => setDragId(null)}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
                  e.preventDefault();
                  e.stopPropagation();
                  const from = optionsRef.current.findIndex((o) => o.id === option.id);
                  moveTo(option.id, from + (e.key === "ArrowUp" ? -1 : 1));
                  // Moving the row can take focus off its handle.
                  requestAnimationFrame(() =>
                    listRef.current
                      ?.querySelector<HTMLElement>(`[data-timed-grip="${option.id}"]`)
                      ?.focus()
                  );
                }}
              >
                <GripVertical className="h-4 w-4" aria-hidden />
              </button>

              <input
                type="text"
                aria-label={t("snoozeOptionNameAria")}
                placeholder={t("snoozeOptionName")}
                value={option.label}
                ref={(el) => {
                  if (el && focusId === option.id) {
                    el.focus();
                    setFocusId(null);
                  }
                }}
                onChange={(e) => update(option.id, { label: e.target.value })}
                className={fieldClass}
              />

              <div className="col-start-2 flex flex-wrap items-center gap-2 lg:contents [&>*]:shrink-0">
                <span
                  className={cn(
                    "text-center text-sm text-stone-400",
                    option.unit === "today" && "hidden lg:block"
                  )}
                >
                  {counted ? t("snoozeWordIn") : option.unit === "weekday" ? t("snoozeWordOn") : ""}
                </span>

                {counted ? (
                  <DraftField
                    ariaLabel={t("snoozeCountAria")}
                    inputMode="numeric"
                    value={String(option.count)}
                    className="w-[4.5rem] text-center lg:w-full"
                    accept={(text) => {
                      const max = option.unit === "hours" ? MAX_OPTION_HOURS : MAX_OPTION_DAYS;
                      if (!/^\d{1,2}$/.test(text.trim())) return false;
                      const count = Number(text);
                      if (count < 1 || count > max) return false;
                      return update(option.id, { count });
                    }}
                  />
                ) : option.unit === "weekday" ? (
                  <UnitSelect
                    ariaLabel={t("snoozeWeekdayAria")}
                    value={option.weekday}
                    options={WEEKDAY_ORDER.map((day) => ({ value: day, label: weekdayName(day) }))}
                    onChange={(weekday) => update(option.id, { weekday })}
                  />
                ) : (
                  <span aria-hidden className="hidden lg:block" />
                )}

                <UnitSelect
                  ariaLabel={t("snoozeUnitAria")}
                  value={option.unit}
                  options={TIMED_UNITS.map((unit) => ({ value: unit, label: t(UNIT_LABEL[unit]) }))}
                  onChange={(unit) => changeUnit(option, unit)}
                />

                {option.unit === "hours" ? (
                  <>
                    <span aria-hidden className="hidden lg:block" />
                    <span aria-hidden className="hidden lg:block" />
                  </>
                ) : (
                  <>
                    <span className="text-center text-sm text-stone-400">{t("snoozeWordAt")}</span>
                    {/* Typed as text: 24:00, the end of a day, is a time a
                        clock picker has no way to show. */}
                    <DraftField
                      ariaLabel={t("snoozeTimeAria")}
                      placeholder="HH:MM"
                      className="w-[5rem] text-center lg:w-full"
                      value={option.time}
                      accept={(text) => {
                        const time = normaliseOptionTime(text);
                        if (!time) return false;
                        return update(option.id, { time });
                      }}
                    />
                  </>
                )}
              </div>

              <button
                type="button"
                aria-label={t("snoozeRemoveOption")}
                title={t("snoozeRemoveOption")}
                className="col-start-3 row-start-1 flex h-7 w-7 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200/70 hover:text-stone-700 lg:col-auto lg:row-auto"
                onClick={() => remove(option.id)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>

              {rowNotice ? (
                <p role="status" className="col-start-2 col-end-3 text-xs text-amber-700 lg:col-end-8">
                  {rowNotice}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-200 px-4 py-2.5">
        <button
          type="button"
          className="flex items-center gap-1 text-sm font-semibold text-teal-700 hover:text-teal-800"
          onClick={add}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {t("snoozeAddOption")}
        </button>
        <span className="text-xs text-stone-500">{t("snoozeLeftOutNote")}</span>
        <button
          type="button"
          className="ml-auto text-xs text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline disabled:pointer-events-none disabled:opacity-40"
          disabled={!customised}
          onClick={() => {
            setNotice(null);
            resetStoredOptions(store);
          }}
        >
          {t("snoozeResetDefaults")}
        </button>
      </div>
    </div>
  );
}

export function SnoozeOptionsPanel({ onDone }: { onDone: () => void }) {
  const t = useMailT();
  return (
    <SettingsPane
      title={t("settingsSnoozeSchedule")}
      description={t("settingsSnoozeScheduleHint")}
      onDone={onDone}
    >
      <SettingsHeading>{t("snoozeOptions")}</SettingsHeading>
      <p className="-mt-0.5 mb-2 text-xs text-stone-500">{t("snoozeSectionHint")}</p>
      <TimedOptionsEditor store={SNOOZE_OPTIONS} emptyText={t("snoozeNoOptions")} />

      <SettingsHeading>{t("pauseSection")}</SettingsHeading>
      <p className="-mt-0.5 mb-2 text-xs text-stone-500">{t("pauseSectionHint")}</p>
      <TimedOptionsEditor store={PAUSE_OPTIONS} emptyText={t("pauseNoOptions")} />
    </SettingsPane>
  );
}
