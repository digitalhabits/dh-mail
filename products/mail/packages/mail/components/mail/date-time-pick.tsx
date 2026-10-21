"use client";

/**
 * The parts every time picker in Mail is made of, so Send later, Snooze and
 * the hours editors look and work the same:
 *
 * - `MenuHeading`: the small capitals at the top, with a way back when the
 *   card is a second step.
 * - `PresetRow`: an offered time, its name on the left and what it means on
 *   the right ("In 1 hour · 09:06").
 * - `TimeField`: the one time box.
 * - `CalendarTimePicker`: a month, the time under it, and one button that
 *   names the result ("Snooze until Mon 19 Oct, 09:00"), so no separate Set.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { currentMailLocale, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function clockOf(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayStart(d: Date): Date {
  const next = new Date(d);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Monday-start month, six weeks. */
function monthGrid(month: Date): { date: Date; inMonth: boolean }[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return { date, inMonth: date.getMonth() === month.getMonth() };
  });
}

/** A day and "HH:MM" as one time, or null for a time that is not one. */
export function atTime(date: Date, hm: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

/** "today, 09:06", or "Mon 19 Oct, 09:00": what a picker's button says. */
export function pickedLabel(d: Date, today: string): string {
  if (sameDay(d, new Date())) return `${today}, ${clockOf(d)}`;
  const locale = currentMailLocale();
  const weekday = d.toLocaleDateString(locale, { weekday: "short" });
  const date = d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  return `${weekday} ${date}, ${clockOf(d)}`;
}

export function MenuHeading({ children, onBack }: { children: React.ReactNode; onBack?: () => void }) {
  const t = useMailT();
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2.5 pb-1 pt-1.5",
        onBack && "mb-2 border-b border-stone-100 pb-2"
      )}
    >
      {onBack ? (
        <button
          type="button"
          aria-label={t("back")}
          className="-ml-1 rounded p-0.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      ) : null}
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-500">{children}</p>
    </div>
  );
}

/**
 * An offered time. `mail-menu-pick`: the row under the pointer or the arrow
 * keys takes the chosen look, so what is about to happen is plain.
 */
export function PresetRow({
  label,
  detail,
  onClick,
  trailing,
}: {
  label: React.ReactNode;
  detail?: React.ReactNode;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="mail-menu-pick flex w-full items-center justify-between gap-3 rounded-control px-2.5 py-1.5 text-left text-sm"
      onClick={onClick}
    >
      <span className="min-w-0 font-semibold text-stone-800">{label}</span>
      {detail != null ? <span className="shrink-0 text-sm tabular-nums text-stone-400">{detail}</span> : null}
      {trailing}
    </button>
  );
}

/** The one time box: Send later, Snooze and the hours all use it. */
export const TIME_FIELD_CLASS =
  "rounded-control border border-stone-200 bg-white px-2.5 py-1.5 text-sm tabular-nums text-stone-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/20";

/** "9:5", "0930", "9.30" → "09:30"; null for what is not a time. */
export function readClock(text: string): string | null {
  const match = /^(\d{1,2})[:.]?(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${pad2(hours)}:${pad2(minutes)}`;
}

const QUARTERS = [0, 15, 30, 45];

/**
 * The one time box. It takes typing ("0930" is 09:30), and a click opens
 * the time as two columns, hours and minutes in quarters, the chosen ones
 * teal.
 *
 * The columns are drawn inside the menu that holds the box, not in a portal
 * on the page: the mailbox menu closes on any press outside itself. They
 * are placed with `position: fixed`, so the menu's scrolling does not clip
 * them.
 */
export function TimeField({
  value,
  onChange,
  onEnter,
  label,
  className,
}: {
  value: string;
  onChange: (hm: string) => void;
  onEnter?: () => void;
  label: string;
  className?: string;
}) {
  const [text, setText] = React.useState(value);
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLInputElement | null>(null);
  const listId = React.useId();
  // A new value from outside replaces what is in the box.
  const [shown, setShown] = React.useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  // The time in the box, which an hour picked in the columns changes before
  // the minute is: one change for both, not two.
  const [hh, mm] = (readClock(text) ?? value).split(":").map(Number);
  const take = (hm: string) => {
    setText(hm);
    if (hm !== value) onChange(hm);
  };
  const close = () => {
    setOpen(false);
    const hm = readClock(text);
    if (hm) take(hm);
    else setText(value);
  };
  const minutes = QUARTERS.includes(mm) || Number.isNaN(mm) ? QUARTERS : [...QUARTERS, mm].sort((x, y) => x - y);

  return (
    <>
      <input
        ref={boxRef}
        type="text"
        role="combobox"
        inputMode="numeric"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const hm = readClock(e.target.value);
          if (hm && hm !== value) {
            /*
              Marked as seen, so it does not come back as a value from
              outside. Taking the 9 out of "09:00" leaves "0:00", which
              is a time; it went up, came back as "00:00", replaced the
              words being typed and put the caret at the end.
            */
            setShown(hm);
            onChange(hm);
          }
        }}
        onClick={() => setOpen(true)}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            close();
            return;
          }
          if (e.key === "ArrowDown") setOpen(true);
          if (e.key !== "Enter") return;
          e.preventDefault();
          close();
          onEnter?.();
        }}
        className={cn(TIME_FIELD_CLASS, "w-28 cursor-pointer", className)}
      />
      {open ? (
        <TimeColumns
          id={listId}
          anchor={boxRef}
          hour={Number.isNaN(hh) ? null : hh}
          minute={Number.isNaN(mm) ? null : mm}
          minutes={minutes}
          onHour={(h) => setText(`${pad2(h)}:${pad2(Number.isNaN(mm) ? 0 : mm)}`)}
          onMinute={(m) => {
            take(`${pad2(Number.isNaN(hh) ? 0 : hh)}:${pad2(m)}`);
            setOpen(false);
          }}
          onClose={close}
        />
      ) : null}
    </>
  );
}

function TimeColumns({
  id,
  anchor,
  hour,
  minute,
  minutes,
  onHour,
  onMinute,
  onClose,
}: {
  id: string;
  anchor: React.RefObject<HTMLInputElement | null>;
  hour: number | null;
  minute: number | null;
  minutes: number[];
  onHour: (h: number) => void;
  onMinute: (m: number) => void;
  onClose: () => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const hoursRef = React.useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = React.useState<{ left: number; top: number } | null>(null);

  // Fixed is from the page, or from a moved ancestor (a popover is moved
  // into place): measure where 0,0 lands, and place the columns under the
  // box — or over it, when the window ends first.
  React.useLayoutEffect(() => {
    const box = anchor.current?.getBoundingClientRect();
    const self = ref.current;
    if (!box || !self) return;
    const origin = self.getBoundingClientRect();
    const height = self.offsetHeight;
    const below = box.bottom + 4 + height <= window.innerHeight;
    setPlace({
      left: box.left - origin.left + (place?.left ?? 0),
      top: (below ? box.bottom + 4 : box.top - 4 - height) - origin.top + (place?.top ?? 0),
    });
    // Measured once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeRef = React.useRef(onClose);
  React.useEffect(() => {
    closeRef.current = onClose;
  });
  React.useEffect(() => {
    const chosen = hoursRef.current?.querySelector<HTMLElement>("[aria-selected='true']");
    if (chosen && hoursRef.current) hoursRef.current.scrollTop = chosen.offsetTop - 4;
    // The menu scrolled under the columns: they would float off the box.
    const onScroll = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return;
      closeRef.current();
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

  const cell = (on: boolean) =>
    cn(
      "block w-full rounded-inner px-2 py-1 text-center text-sm tabular-nums",
      on ? "bg-teal-700 font-semibold text-white" : "text-stone-700 hover:bg-stone-100"
    );
  return (
    <div
      ref={ref}
      id={id}
      role="listbox"
      // Pressing a time keeps the focus in the box, so typing still works.
      onMouseDown={(e) => e.preventDefault()}
      className="z-50 flex gap-1 rounded-surface border border-stone-200 bg-white p-1 shadow-lg"
      style={{
        position: "fixed",
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        visibility: place ? "visible" : "hidden",
      }}
    >
      <div ref={hoursRef} className="max-h-44 w-12 overflow-y-auto">
        {Array.from({ length: 24 }, (_, h) => (
          <button key={h} type="button" role="option" aria-selected={h === hour} className={cell(h === hour)} onClick={() => onHour(h)}>
            {pad2(h)}
          </button>
        ))}
      </div>
      <div className="w-12 border-l border-stone-100 pl-1">
        {minutes.map((m) => (
          <button key={m} type="button" role="option" aria-selected={m === minute} className={cell(m === minute)} onClick={() => onMinute(m)}>
            {pad2(m)}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A month, the time under it, and one button that says what it will do.
 *
 * `initial` sets the day and time it opens on; with `pickDay` false it opens
 * with that day chosen, else the reader picks one first and the button says
 * "Pick a date" until they do. A time that has passed is not taken.
 */
export function CalendarTimePicker({
  initial,
  pickDay = false,
  action,
  onPick,
  wide = false,
}: {
  initial: Date;
  pickDay?: boolean;
  /**
   * The button's words for a time: "Snooze until {when}". Wide, the time
   * stands beside the button, and these are the button's own words.
   */
  action: (at: Date) => string;
  onPick: (at: Date) => void;
  /**
   * The month beside an hour column and a minute column, and the chosen
   * time beside the button (Send later). If they are under each other, the
   * button runs past the bottom of the menu and is not seen.
   */
  wide?: boolean;
}) {
  const t = useMailT();
  const today = dayStart(new Date());
  const [month, setMonth] = React.useState(() => dayStart(initial));
  const [day, setDay] = React.useState<Date | null>(() => (pickDay ? null : dayStart(initial)));
  const [hm, setHm] = React.useState(() => clockOf(initial));
  const cells = React.useMemo(() => monthGrid(month), [month]);
  const at = day ? atTime(day, hm) : null;
  const valid = at != null && at.getTime() > Date.now();
  const go = () => {
    if (valid && at) onPick(at);
  };
  const step = (by: number) =>
    setMonth((m) => {
      const next = new Date(m.getFullYear(), m.getMonth() + by, 1);
      return dayStart(next);
    });

  const monthView = (
    <>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label={t("previousMonth")}
          className="rounded-inner p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          onClick={() => step(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="font-serif text-[15px] font-bold text-stone-900">
          {month.toLocaleDateString(currentMailLocale(), { month: "long", year: "numeric" })}
        </p>
        <button
          type="button"
          aria-label={t("nextMonth")}
          className="rounded-inner p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
          onClick={() => step(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center">
        {["M", "T", "W", "T", "F", "S", "S"].map((label, i) => (
          <span key={`${label}-${i}`} className="py-1 text-[11px] font-medium text-stone-400">
            {label}
          </span>
        ))}
        {cells.map(({ date, inMonth }) => {
          const past = dayStart(date).getTime() < today.getTime();
          const chosen = day != null && sameDay(date, day);
          const isToday = sameDay(date, today);
          // Only this month's days: the weeks around it are blank, as in
          // the design, so a month reads as a month.
          if (!inMonth) return <span key={date.toISOString()} aria-hidden />;
          return (
            <button
              key={date.toISOString()}
              type="button"
              disabled={past}
              onClick={() => setDay(dayStart(date))}
              className={cn(
                "mx-auto flex h-8 w-8 items-center justify-center rounded-control text-sm tabular-nums transition-colors",
                past ? "cursor-not-allowed text-stone-300" : "text-stone-800 hover:bg-stone-100",
                isToday && !chosen && "ring-1 ring-stone-300",
                chosen && "bg-teal-700 font-semibold text-white hover:bg-teal-700"
              )}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </>
  );

  if (wide) {
    const [hh, mm] = hm.split(":").map(Number);
    return (
      <div className="px-1 pb-1">
        <div className="flex gap-5">
          <div className="min-w-0 flex-1 space-y-3">{monthView}</div>
          <ClockColumns
            hour={hh}
            minute={mm}
            onHour={(h) => setHm(`${pad2(h)}:${pad2(mm)}`)}
            onMinute={(m) => setHm(`${pad2(hh)}:${pad2(m)}`)}
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-stone-100 pt-3">
          <span className="min-w-0 truncate text-sm text-stone-600">
            {at ? whenLong(at) : t("pickADate")}
            {at && !valid ? ` · ${t("pickFutureTime")}` : ""}
          </span>
          <button
            type="button"
            disabled={!valid}
            onClick={go}
            className={cn(
              "shrink-0 rounded-control px-4 py-2 text-sm font-semibold transition-colors",
              valid ? "bg-teal-700 text-white hover:bg-teal-800" : "cursor-not-allowed bg-stone-100 text-stone-400"
            )}
          >
            {at ? action(at) : t("pickADate")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 px-1 pb-1">
      {monthView}

      <div className="flex items-center gap-2 border-t border-stone-100 pt-3">
        <span className="text-sm text-stone-400">{t("atTime")}</span>
        <TimeField value={hm} onChange={setHm} onEnter={go} label={t("customTime")} />
      </div>

      <button
        type="button"
        disabled={!valid}
        onClick={go}
        className={cn(
          "w-full rounded-control px-3 py-2.5 text-sm font-semibold transition-colors",
          valid ? "bg-teal-700 text-white hover:bg-teal-800" : "cursor-not-allowed bg-stone-100 text-stone-400"
        )}
      >
        {valid && at ? action(at) : day ? t("pickFutureTime") : t("pickADate")}
      </button>
    </div>
  );
}

/** "Wed 21 Oct, 15:00". */
function whenLong(at: Date): string {
  const locale = currentMailLocale();
  const day = at.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${clockOf(at)}`;
}

/**
 * An hour column and a minute column, side by side in the picker. The
 * chosen ones are scrolled into view as they open.
 */
function ClockColumns({
  hour,
  minute,
  onHour,
  onMinute,
}: {
  hour: number;
  minute: number;
  onHour: (h: number) => void;
  onMinute: (m: number) => void;
}) {
  const t = useMailT();
  const hoursRef = React.useRef<HTMLDivElement | null>(null);
  const minutesRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    for (const list of [hoursRef.current, minutesRef.current]) {
      const chosen = list?.querySelector<HTMLElement>("[aria-selected='true']");
      if (list && chosen) list.scrollTop = chosen.offsetTop - list.clientHeight / 2 + chosen.offsetHeight / 2;
    }
  }, []);
  // Every five minutes, and the minute it has if that is between them.
  const fives = Array.from({ length: 12 }, (_, i) => i * 5);
  const minutes = fives.includes(minute) ? fives : [...fives, minute].sort((a, b) => a - b);
  const cell = (on: boolean) =>
    cn(
      "block w-full rounded-control py-1.5 text-center text-sm tabular-nums",
      on ? "bg-teal-700 font-semibold text-white" : "text-stone-800 hover:bg-stone-200/60"
    );
  const column = (
    ref: React.RefObject<HTMLDivElement | null>,
    values: number[],
    chosen: number,
    pick: (v: number) => void
  ) => (
    <div ref={ref} role="listbox" className="h-[15rem] w-14 overflow-y-auto">
      {values.map((v) => (
        <button key={v} type="button" role="option" aria-selected={v === chosen} className={cell(v === chosen)} onClick={() => pick(v)}>
          {pad2(v)}
        </button>
      ))}
    </div>
  );
  return (
    <div className="shrink-0">
      <div className="mb-1.5 flex gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-stone-400">
        <span className="w-14">{t("hourColumn")}</span>
        <span className="w-14">{t("minuteColumn")}</span>
      </div>
      {/* The theme's card colour: stone-100/70 has no dark rewrite, and in
          the dark the columns are a light grey slab. */}
      <div className="flex gap-1 rounded-surface bg-[var(--mail-hours-card)] p-1">
        {column(hoursRef, Array.from({ length: 24 }, (_, h) => h), hour, onHour)}
        {column(minutesRef, minutes, minute, onMinute)}
      </div>
    </div>
  );
}
