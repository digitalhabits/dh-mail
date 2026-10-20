"use client";

/**
 * The week as a chart that can be dragged: a row a day, midnight to
 * midnight, the hours on as bars (hours-drag.ts has the rules).
 *
 * - Drag a bar's end to move it. The rule moves on all of its days, as when
 *   its time is typed in its card.
 * - Drag the middle of a bar to move the whole rule: sideways in time, and
 *   up or down to other days, snapping to whole days.
 * - Drag on an empty part of a day to add hours for that day.
 *
 * With `shown`, the chart is about new mail: the hours the mailbox is shown
 * are drawn quiet behind, and new mail's hours bright where they fall
 * inside them. Outside them nothing arrives: a bar there is drawn faint, so
 * hours drawn on a hidden day can still be seen and moved.
 *
 * A handle at midnight is not drawn: an all-day bar has no ends to show.
 * It can still be taken there.
 */

import * as React from "react";

import { daySpans } from "@/lib/mail/account-rhythm";
import { SCHEDULE_DAY_LABELS, type MailScheduleDay } from "@/lib/mail/custom-lists";
import {
  addDayRule,
  barAt,
  DAY_MINUTES,
  dragRuleEnd,
  moveRule,
  ruleBars,
  snapMinute,
  type RuleBar,
} from "@/lib/mail/hours-drag";
import type { MailQuietWindow } from "@/lib/mail/quiet-hours";
import { cn } from "@/lib/utils";

/** How near an end a press must be to take it, in pixels. */
const HANDLE_REACH = 8;

type Drag =
  | { kind: "end"; rule: number; end: "start" | "end"; rows: MailQuietWindow[] }
  | { kind: "add"; day: MailScheduleDay; from: number; rows: MailQuietWindow[] }
  | { kind: "move"; rule: number; day: number; from: number; rows: MailQuietWindow[] };

const pct = (minute: number) => `${(minute / DAY_MINUTES) * 100}%`;

export function HoursWeekEditor({
  rows,
  onRows,
  shown,
}: {
  rows: MailQuietWindow[];
  onRows: (rows: MailQuietWindow[]) => void;
  /** The hours the mailbox is shown, when the chart is about new mail. */
  shown?: MailQuietWindow[];
}) {
  const bars = React.useMemo(() => ruleBars(rows), [rows]);
  const shownSpans = React.useMemo(() => (shown ? daySpans(shown) : null), [shown]);
  const drag = React.useRef<Drag | null>(null);
  const tracks = React.useRef<(HTMLDivElement | null)[]>([]);

  /** The day whose row is nearest the pointer, for a move up or down. */
  const dayAt = (clientY: number) => {
    let best = 0;
    let distance = Infinity;
    tracks.current.forEach((track, day) => {
      if (!track) return;
      const box = track.getBoundingClientRect();
      const d = Math.abs(box.top + box.height / 2 - clientY);
      if (d < distance) {
        distance = d;
        best = day;
      }
    });
    return best;
  };

  const minuteAt = (track: HTMLElement, clientX: number) => {
    const box = track.getBoundingClientRect();
    return snapMinute((clientX - box.left) / Math.max(1, box.width));
  };

  const onPointerDown = (day: MailScheduleDay) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const track = event.currentTarget;
    const box = track.getBoundingClientRect();
    const x = event.clientX - box.left;
    const px = (minute: number) => (minute / DAY_MINUTES) * box.width;
    // The nearest end within reach, if any.
    let best: { bar: RuleBar; end: "start" | "end"; distance: number } | null = null;
    for (const bar of bars[day]) {
      for (const end of ["start", "end"] as const) {
        if (end === "start" ? !bar.startHandle : !bar.endHandle) continue;
        const distance = Math.abs(px(end === "start" ? bar.from : bar.to) - x);
        if (distance <= HANDLE_REACH && (!best || distance < best.distance)) best = { bar, end, distance };
      }
    }
    const minute = minuteAt(track, event.clientX);
    const under = barAt(bars[day], minute);
    if (best) {
      drag.current = { kind: "end", rule: best.bar.rule, end: best.end, rows };
    } else if (under) {
      drag.current = { kind: "move", rule: under.rule, day, from: minute, rows };
    } else {
      drag.current = { kind: "add", day, from: minute, rows };
    }
    track.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const now = drag.current;
    if (!now) return;
    const minute = minuteAt(event.currentTarget, event.clientX);
    if (now.kind === "end") onRows(dragRuleEnd(now.rows, now.rule, now.end, minute));
    else if (now.kind === "move") onRows(moveRule(now.rows, now.rule, minute - now.from, dayAt(event.clientY) - now.day));
    else onRows(minute === now.from ? now.rows : addDayRule(now.rows, now.day, now.from, minute));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="select-none">
      <div className="grid grid-cols-[1rem_1fr] items-center gap-x-3 gap-y-1.5">
        {bars.map((dayBars, day) => (
          <React.Fragment key={day}>
            <span className="text-[11px] font-semibold text-stone-400" aria-hidden>
              {SCHEDULE_DAY_LABELS[day].label.slice(0, 1)}
            </span>
            <div
              ref={(el) => {
                tracks.current[day] = el;
              }}
              role="presentation"
              className="relative h-4 cursor-crosshair touch-none select-none overflow-hidden rounded-full bg-[var(--mail-hours-track)]"
              onPointerDown={onPointerDown(day as MailScheduleDay)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {shownSpans
                ? shownSpans[day].map(([from, to]) => (
                    <span
                      key={`shown-${from}`}
                      className="absolute inset-y-0 bg-[var(--mail-week-shown)]"
                      style={{ left: pct(from), width: pct(to - from) }}
                    />
                  ))
                : null}
              {dayBars.map((bar) => (
                <Bar key={`${bar.rule}-${bar.from}`} bar={bar} shown={shownSpans?.[day] ?? null} />
              ))}
            </div>
          </React.Fragment>
        ))}
      </div>
      <div className="ml-[1.75rem] mt-1.5 flex justify-between text-[11px] tabular-nums text-stone-400" aria-hidden>
        {["00", "06", "12", "18", "24"].map((hour) => (
          <span key={hour}>{hour}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * One rule's bar on one day, with its ends as handles. About new mail, the
 * part inside the hours shown is bright, and the rest faint.
 */
function Bar({ bar, shown }: { bar: RuleBar; shown: [number, number][] | null }) {
  const fill = shown ? "bg-[var(--mail-week-fetch)]" : "bg-[var(--mail-hours-accent)]";
  const pieces = shown
    ? shown
        .map(([from, to]) => [Math.max(from, bar.from), Math.min(to, bar.to)] as const)
        .filter(([from, to]) => to > from)
    : [[bar.from, bar.to] as const];
  return (
    <>
      {shown ? (
        <span
          className={cn("absolute inset-y-0 cursor-grab opacity-30 active:cursor-grabbing", fill)}
          style={{ left: pct(bar.from), width: pct(bar.to - bar.from) }}
        />
      ) : null}
      {pieces.map(([from, to]) => (
        <span
          key={from}
          className={cn("absolute inset-y-0 cursor-grab active:cursor-grabbing", fill)}
          style={{ left: pct(from), width: pct(to - from) }}
        />
      ))}
      {bar.startHandle && bar.from > 0 ? <Handle at={bar.from} /> : null}
      {bar.endHandle && bar.to < DAY_MINUTES ? <Handle at={bar.to} /> : null}
    </>
  );
}

function Handle({ at }: { at: number }) {
  return (
    <span
      aria-hidden
      className="absolute inset-y-0 w-[3px] cursor-ew-resize bg-white/90"
      style={{ left: `calc(${pct(at)} - 1.5px)` }}
    />
  );
}
