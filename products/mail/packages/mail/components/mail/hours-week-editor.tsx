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
 * With `shown`, the chart is about new mail. It has three states, and a key
 * under it names the ones in sight:
 * - a bar: new mail comes in, and the mailbox is shown.
 * - the light band: the mailbox is shown, and no new mail comes in.
 * - the bare track: the mailbox is hidden. A rule that runs into those hours
 *   is not drawn there. A note under the key says that the hours shown
 *   hide the mailbox then, and names the hours mail is still fetched in the
 *   background, to be seen when the mailbox is shown again. (A hidden mailbox still gets its mail; Ulrik,
 *   2026-11-15: the chart does not say so, the grey is enough. A hollow bar
 *   with "Comes in while hidden, waits for you" was tried and was hated.)
 *   Such a rule can still be taken and dragged where it is.
 *
 * The bars are the green of the "shown" chart, so the two charts read the
 * same way: a bar is the answer to the question on its page. (Until
 * 2026-11-15 the bars here were a second, brighter green, faint outside the
 * hours shown, and the hint named the wrong colour in the light theme.)
 *
 * A handle at midnight is not drawn: an all-day bar has no ends to show.
 * It can still be taken there.
 */

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { useOnHoursWords } from "@/components/mail/pause-panels";
import { daySpans, fetchWhileHidden, onRulePhrase } from "@/lib/mail/account-rhythm";
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
import { useMailT } from "@/lib/mail/i18n";

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
  onChangeShown,
}: {
  rows: MailQuietWindow[];
  onRows: (rows: MailQuietWindow[]) => void;
  /** Go to the hours shown: the link in the note about hidden hours. */
  onChangeShown?: () => void;
  /** The hours the mailbox is shown, when the chart is about new mail. */
  shown?: MailQuietWindow[];
}) {
  const bars = React.useMemo(() => ruleBars(rows), [rows]);
  const shownSpans = React.useMemo(() => (shown ? daySpans(shown) : null), [shown]);
  /** Some hour the mailbox is shown has no bar over it: the key names the light band. */
  const shownBare = React.useMemo(
    () =>
      Boolean(shownSpans) &&
      shownSpans!.some((spans, day) =>
        spans.some(([from, to]) => {
          // Walk the bars left to right; a gap before `to` is a bare stretch.
          let at = from;
          for (const bar of [...bars[day]].sort((a, b) => a.from - b.from)) {
            if (bar.from > at) break;
            at = Math.max(at, bar.to);
          }
          return at < to;
        })
      ),
    [bars, shownSpans]
  );
  /** Some bar shows: the key names it. */
  const anyBar = React.useMemo(
    () => bars.some((dayBars, day) => dayBars.some((bar) => barPieces(bar, shownSpans?.[day] ?? null).length > 0)),
    [bars, shownSpans]
  );
  /** Some hour of the week the mailbox is hidden: the note says what the grey is. */
  const anyHidden = React.useMemo(
    () =>
      Boolean(shownSpans) &&
      shownSpans!.some((spans) => spans.reduce((sum, [from, to]) => sum + (to - from), 0) < DAY_MINUTES),
    [shownSpans]
  );
  const t = useMailT();
  const words = useOnHoursWords();
  /** The hours of the rules that fall where the mailbox is hidden, in words. */
  const hiddenFetch = React.useMemo(
    () =>
      shown
        ? fetchWhileHidden(rows, shown)
            .map((window) => onRulePhrase(window, words, SCHEDULE_DAY_LABELS))
            .join(", ")
        : "",
    [rows, shown, words]
  );
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
      {shownSpans ? (
        <div className="ml-[1.75rem] mt-3 flex flex-col gap-1 text-xs text-stone-600">
          {anyBar ? <KeyLine fill="bg-[var(--mail-hours-accent)]" words={t("rhythmKeyFetch")} /> : null}
          {shownBare ? <KeyLine fill="bg-[var(--mail-week-shown)]" words={t("rhythmKeyShownOnly")} /> : null}
          {anyHidden ? (
            <p className="mt-1.5 flex items-start gap-2 leading-relaxed text-stone-600">
              <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <span>
                {hiddenFetch ? t("rhythmHiddenFetchNote", { times: hiddenFetch }) : t("rhythmHiddenNote")}
                {onChangeShown ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="font-semibold text-[var(--mail-hours-accent)] underline-offset-2 hover:underline"
                      onClick={onChangeShown}
                    >
                      {t("rhythmChangeShown")}
                    </button>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One line of the key under the chart: a piece of bar and what it means. */
function KeyLine({ fill, words }: { fill: string; words: string }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`h-2.5 w-6 shrink-0 rounded-full ${fill}`} />
      {words}
    </span>
  );
}

/**
 * The parts of a bar that are drawn: those inside the hours shown. With no
 * hours shown given (the "shown" chart itself), the whole bar.
 */
export function barPieces(bar: { from: number; to: number }, shown: [number, number][] | null): [number, number][] {
  if (!shown) return [[bar.from, bar.to]];
  return shown
    .map(([from, to]) => [Math.max(from, bar.from), Math.min(to, bar.to)] as [number, number])
    .filter(([from, to]) => to > from);
}

/** One rule's bar on one day, with its ends as handles where they are in sight. */
function Bar({ bar, shown }: { bar: RuleBar; shown: [number, number][] | null }) {
  const inSight = (minute: number) => !shown || shown.some(([from, to]) => minute >= from && minute <= to);
  return (
    <>
      {barPieces(bar, shown).map(([from, to]) => (
        <span
          key={from}
          className="absolute inset-y-0 cursor-grab bg-[var(--mail-hours-accent)] active:cursor-grabbing"
          style={{ left: pct(from), width: pct(to - from) }}
        />
      ))}
      {bar.startHandle && bar.from > 0 && inSight(bar.from) ? <Handle at={bar.from} /> : null}
      {bar.endHandle && bar.to < DAY_MINUTES && inSight(bar.to) ? <Handle at={bar.to} /> : null}
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
