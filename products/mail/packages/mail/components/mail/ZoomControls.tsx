"use client";

import * as React from "react";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";

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

/**
 * The "Aa" among the thread's actions: a circle like theirs, with a drawn
 * large and small A (TextSizeIcon) on the icons' grid and line weight. The
 * thread's strip and the reader's bar both use it.
 */
// A little bigger than the icons beside it (22px to their 19px): its small A
// is small, and at their size the pair read as a smudge.
export const AA_BUTTON_CLASS = cn(
  THREAD_ACTION_CLASS,
  "mail-chrome-strip inline-flex items-center justify-center [&_svg]:size-[22px] group-data-[tight]/toolbar:[&_svg]:size-[19px]"
);

/**
 * A large A and a small A, drawn in strokes on Lucide's 24px grid, so it
 * sits with the toolbar's icons: letters set in a font were heavier and
 * taller than they are.
 */
export function TextSizeIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M2.5 19 8.5 5l6 14" />
      <path d="M4.6 14.2h7.8" />
      <path d="m14.5 19 3.75-8.5L22 19" />
      <path d="M15.9 16h4.7" />
    </svg>
  );
}

/** One A, drawn as the large A of TextSizeIcon: the popover's smaller and bigger. */
function LetterAIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M5 20 12 4l7 16" />
      <path d="M7.6 14.5h8.8" />
    </svg>
  );
}

/**
 * An "Aa" button, and under it a smaller A and a bigger A with the size
 * between them. The zoom of the pane and the reader's text size are both
 * offered this way.
 */
export function TextSizePopover({
  label,
  size,
  canSmaller,
  canBigger,
  onSmaller,
  onBigger,
  className = AA_BUTTON_CLASS,
  letters = false,
}: {
  /** The button's name and tooltip. */
  label: string;
  /** The size now, between the two As: "100%", "16px". */
  size: string;
  canSmaller: boolean;
  canBigger: boolean;
  onSmaller: () => void;
  onBigger: () => void;
  className?: string;
  /** "Aa" in letters, for a place with no icons beside it. */
  letters?: boolean;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  // The As drawn as the button's icon is; close together, so the strip of
  // three is no wider than it needs to be.
  const step =
    "flex h-7 w-7 items-center justify-center rounded-full text-stone-600 hover:bg-stone-200/70 disabled:opacity-40";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} title={label} className={className}>
          {letters ? "Aa" : <TextSizeIcon />}
        </button>
      </PopoverTrigger>
      <MailPopoverContent align="end" className="flex w-auto items-center gap-0.5 rounded-full p-1">
        <button
          type="button"
          aria-label={t("smallerText")}
          title={t("smallerText")}
          disabled={!canSmaller}
          onClick={onSmaller}
          className={step}
        >
          <LetterAIcon className="h-3 w-3" />
        </button>
        <span className="min-w-[2.25rem] text-center text-[11px] tabular-nums text-stone-500">{size}</span>
        <button
          type="button"
          aria-label={t("biggerText")}
          title={t("biggerText")}
          disabled={!canBigger}
          onClick={onBigger}
          className={step}
        >
          <LetterAIcon className="h-[18px] w-[18px]" />
        </button>
      </MailPopoverContent>
    </Popover>
  );
}

/** The pane's zoom, offered as the reader's text size is: "Aa" and its two As. */
export function ZoomTextSize({
  zoom,
  onAdjust,
  className,
}: {
  zoom: number;
  /** As ZoomControls: moves the zoom by an amount. */
  onAdjust: (delta: number) => void;
  /** The button's look; the thread's strip has its own default. */
  className?: string;
}) {
  const t = useMailT();
  return (
    <TextSizePopover
      label={t("textSize")}
      size={`${Math.round(zoom * 100)}%`}
      canSmaller={zoom > MIN_ZOOM}
      canBigger={zoom < MAX_ZOOM}
      onSmaller={() => onAdjust(nextZoomStop(zoom, -1) - zoom)}
      onBigger={() => onAdjust(nextZoomStop(zoom, 1) - zoom)}
      className={className ?? "mail-chrome-strip shrink-0 rounded-md px-2 py-1 text-[15px] text-stone-600 hover:bg-stone-200/70"}
      letters={!className}
    />
  );
}
