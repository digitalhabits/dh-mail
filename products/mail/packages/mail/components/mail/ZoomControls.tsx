"use client";

import * as React from "react";
import { useMailT } from "@/lib/mail/i18n";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  nextZoomStop,
} from "@/components/mail/use-mail-layout";

export function ZoomControls({
  zoom,
  onAdjust,
}: {
  zoom: number;
  /**
   * Moves the zoom by an amount. Everything here works out the amount that
   * lands on the size it wants, so nothing new has to be threaded down
   * from the page that owns the number.
   */
  onAdjust: (delta: number) => void;
}) {
  const t = useMailT();
  const percent = Math.round(zoom * 100);
  /** Typing a size in. Null when the label is just a label. */
  const [typed, setTyped] = React.useState<string | null>(null);

  const commit = (text: string) => {
    setTyped(null);
    const wanted = Number.parseInt(text.replace(/[^0-9]/g, ""), 10);
    if (!Number.isFinite(wanted)) return;
    // Clamped here as well as in the hook, so the delta is the one that
    // actually lands: asking for 900% and being given 200% would leave
    // the two disagreeing about where the zoom now is.
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, wanted / 100));
    onAdjust(next - zoom);
  };

  return (
    // Its own border and no fill: on the dark theme `bg-white` becomes a
    // card, and this is a pill on the toolbar rather than a thing on it.
    // `mail-chrome-strip`: the − and + are written as text, so a double
    // click anywhere near the pill used to select one of them. The pill
    // travels — the reader, a draft, the settings panel — and it carries
    // the rule with it. See mail.css.
    <div className="mail-chrome-strip flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--mail-field-border)] px-1.5 py-1">
      <button
        type="button"
        aria-label={t("smallerText")}
        title={t("smallerText")}
        className="rounded-full px-1 text-[15px] leading-none text-[var(--mail-action-2-icon)] hover:bg-[var(--mail-action-2-hover)] hover:text-[var(--mail-action-2-fg)] disabled:opacity-40"
        disabled={zoom <= MIN_ZOOM}
        onClick={() => onAdjust(nextZoomStop(zoom, -1) - zoom)}
      >
        −
      </button>
      {/*
        The label is exactly as wide as the widest thing it can say, and no
        wider. A width guessed in rem is either slack at 100% or a pill that
        resizes at 90%, and it has to be guessed again whenever the font moves.
        So the widest label sizes the box and the real one sits on top of it.
        Zoom runs 50% to 200%, and tabular figures give every 4-character label
        the same width, so "100%" is as wide as the label ever gets.

        The box the size is typed into sits in that same cell, so the row
        does not change width when it opens.
      */}
      <span className="grid text-[11px] tabular-nums text-[var(--mail-action-2-icon)]">
        <span className="invisible col-start-1 row-start-1" aria-hidden>
          100%
        </span>
        {typed === null ? (
          <button
            type="button"
            aria-label={`Text size ${percent}%. Click to type a size.`}
            title={t("typeASize")}
            className="col-start-1 row-start-1 text-center hover:text-[var(--mail-action-2-fg)]"
            onClick={() => setTyped(String(percent))}
          >
            {percent}%
          </button>
        ) : (
          <input
            // Numeric, but a text field: `number` brings its own stepper
            // and its own opinion about what is typed, in a box four
            // characters wide.
            type="text"
            inputMode="numeric"
            aria-label={t("textSizePercent")}
            autoFocus
            /*
              A box asks for room for twenty characters unless it is told
              otherwise, and the column here is as wide as the widest thing
              in it — so the box, not the label, was deciding, and the pill
              doubled in width the moment it opened. Asking for one
              character leaves the invisible label in charge of the width,
              and `w-full` fills whatever that comes to.
            */
            size={1}
            value={typed}
            className="col-start-1 row-start-1 w-full min-w-0 bg-transparent text-center tabular-nums text-[var(--mail-action-2-fg)] outline-none"
            onChange={(e) => setTyped(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            // Leaving the box is as much an answer as pressing Enter.
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(typed);
              } else if (e.key === "Escape") {
                e.preventDefault();
                // Escape leaves the size alone, which is what it means
                // everywhere else in here.
                setTyped(null);
              }
            }}
          />
        )}
      </span>
      <button
        type="button"
        aria-label={t("biggerText")}
        title={t("biggerText")}
        className="rounded-full px-1 text-[15px] leading-none text-[var(--mail-action-2-icon)] hover:bg-[var(--mail-action-2-hover)] hover:text-[var(--mail-action-2-fg)] disabled:opacity-40"
        disabled={zoom >= MAX_ZOOM}
        onClick={() => onAdjust(nextZoomStop(zoom, 1) - zoom)}
      >
        +
      </button>
    </div>
  );
}
