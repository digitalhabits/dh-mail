"use client";

/*
 * The thread pane's geometry, off the pane component: the reply band's
 * sweep with its resting height and its scroll, the pinch and the zoom refs,
 * and the pane's measured width with the widths at which the layout changes.
 * Nothing in here fetches, sends or knows what the composer holds.
 *
 * Three hooks and not one, and the reason is the order of effects. The
 * three pieces stood at three places in the pane, with other hooks' effects
 * between them. Each hook here stands where its code stood.
 *
 * Where the composer lives — the pane, the floating card or the pop-out —
 * is not geometry and is not here. New measuring, sweeping or zooming for
 * the thread pane goes in this file, not in ThreadPane.
 */

import * as React from "react";
import { afterMailPaneSlide } from "@/lib/mail/pane-slide";
import { usePaneSweep } from "@/lib/mail/use-pane-sweep";
import { usePinchZoom } from "@/components/mail/use-mail-layout";
import type { ComposerMode } from "@/components/mail/thread-messages";

/**
 * Where the reply actions stop having room for their words.
 *
 * Reply, Reply all and Forward with their icons, the gaps between them and
 * the padding around them come to about this. Below it they wrapped.
 */
const THREAD_ACTIONS_MIN_WIDTH = 480;

const COMPOSER_MIN_WIDTH = 700;

/**
 * Where a composer narrower than the pane stops being worth the gutter.
 *
 * The box matches the width of your own bubbles and sits against the right,
 * which reads well with a thread beside it. On a narrow pane that gutter is
 * a third of the room, and the recipient field left in what remains is too
 * narrow to hold two addresses side by side — thirty of them became thirty
 * lines. Below this the box takes the whole width and the addresses get it.
 */
const COMPOSER_FULL_WIDTH = 900;

/**
 * How much of the reading pane the reply box may take before it scrolls
 * inside itself, as a percentage. The rest is the thread, and the send row.
 */
export const COMPOSER_MAX_SHARE = 45;

/** The reply band: its sweep, its height at rest, and its scroll. */
export function useReplyBand(input: {
  /** Hide the thread and grow the reply/forward composer to fill the pane. */
  replyFocus: boolean;
  mode: ComposerMode | null;
}) {
  const { replyFocus, mode } = input;
  /*
    The growth moves at the pane slide's tempo — the same gesture as the
    list leaving the reader, so the same speed and the same mechanics.
    For the length of the change the composer band stands absolute over
    the pane below the toolbar, laid out once where it is going, and a
    clip-path edge sweeps between the band's resting strip and the whole
    of the pane. The thread stays mounted beneath until it is covered, so
    the edge covers and uncovers something real, and nothing is laid out
    while it moves.

    `replyGrown` is where the edge stands. `replyFocusSliding` is whether
    the sweep's frame exists at all — false at rest, where the band is an
    ordinary flex child and nothing about it changes. The movement itself
    is usePaneSweep's, the same machine every pane sweep runs on.
  */
  const { at: replyGrown, sliding: replyFocusSliding } =
    usePaneSweep(replyFocus);
  /** The band's height at rest — where the sweep starts and ends. */
  const replyBandRestRef = React.useRef(0);
  const replyBandRef = React.useRef<HTMLDivElement | null>(null);
  /** The part of the reply band that scrolls: the box, not the band. */
  const composerColumnRef = React.useRef<HTMLDivElement | null>(null);
  /*
    A scroll over the band beside the box scrolls the box.

    The box is right-aligned and as narrow as its dragged width, and only
    the box scrolls. A reply taller than the band showed its top, and a
    scroll over the empty band to its left did nothing at all, so the rest
    was reachable only with the pointer over the box.

    Two things scroll in there: the column, which holds the recipients and
    the box, and inside the box the letter itself. A scroll over the letter
    moves the letter first and the column after it. From beside the box the
    two are read as one page, top to bottom: down takes the column to its
    end and then the letter; up takes the letter back to its top and then
    the column. Moving the column alone left the end of a long letter out
    of reach, and its top too once the letter had been scrolled.
  */
  const scrollComposerFromBand = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const column = composerColumnRef.current;
      if (!column || !(event.target instanceof Node)) return;
      if (column.contains(event.target)) return;
      const letter = column.querySelector<HTMLElement>(".mail-composer-scroll");
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? column.clientHeight : 1;
      let delta = event.deltaY * unit;
      const room = (el: HTMLElement) =>
        delta > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
      const order = delta > 0 ? [column, letter] : [letter, column];
      for (const el of order) {
        if (!el || !delta) continue;
        const step = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, room(el)));
        if (!step) continue;
        el.scrollTop += step;
        delta -= step;
      }
    },
    []
  );
  const replyBandAtRestRef = React.useRef(true);
  replyBandAtRestRef.current = !replyFocus && !replyFocusSliding;
  /*
    The resting height, kept while the band is at rest. Read in the
    observer, where layout is already settled, so keeping it forces no
    layout of its own.
  */
  React.useEffect(() => {
    const el = replyBandRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (replyBandAtRestRef.current) {
        replyBandRestRef.current = el.offsetHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  return {
    replyGrown,
    replyFocusSliding,
    replyBandRestRef,
    replyBandRef,
    composerColumnRef,
    scrollComposerFromBand,
  };
}

/** Pinch and zoom for the reading column. */
export function useThreadZoom(input: {
  zoom: number;
  onZoomAdjust: (delta: number) => void;
  /** False while there is no thread, or while the reply fills the pane. */
  enabled: boolean;
}) {
  const { zoom, onZoomAdjust, enabled } = input;
  /** Whole reading column — pinch hits header, gaps, and iframe chrome. */
  const pinchRef = React.useRef<HTMLDivElement | null>(null);
  /**
   * The reading that zoom puts back, taken at the moment the gesture
   * arrives.
   *
   * It used to be taken when the reader last scrolled, and a reader who
   * opens a thread and zooms without scrolling first has not scrolled:
   * the only reading was the one from before the thread was pinned to its
   * newest message, so zooming threw them to the top of it. Reading it
   * here means there is always one, and always from where they are now.
   *
   * A ref because the reading is defined further down, with the rest of
   * the zoom anchoring, and the gesture is attached up here.
   */
  const takeZoomAnchorRef = React.useRef<
    ((atY: number | null) => void) | null
  >(null);
  /** The size the reader is at now, for effects that closed over an old one. */
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  usePinchZoom(
    pinchRef,
    onZoomAdjust,
    enabled,
    (atY) => takeZoomAnchorRef.current?.(atY)
  );
  /** The buttons and the keys say nothing about where the pointer is. */
  const adjustZoomFromControls = React.useCallback(
    (delta: number) => {
      takeZoomAnchorRef.current?.(null);
      onZoomAdjust(delta);
    },
    [onZoomAdjust]
  );

  return { pinchRef, takeZoomAnchorRef, zoomRef, adjustZoomFromControls };
}

/** The pane's width, and the layout decisions that depend on it. */
export function useThreadPaneWidth(input: {
  pinchRef: React.RefObject<HTMLDivElement | null>;
  /** What the carry moves, when this pane is the floating card. */
  cardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { pinchRef, cardRef } = input;
  /**
   * How much room the reply actions have, measured rather than guessed.
   *
   * The pane is resizable and sits beside two other resizable things, so
   * nothing about the window says how wide this row is.
   */
  const [paneWidth, setPaneWidth] = React.useState(0);
  /**
   * Measured through the ref itself, not from an effect.
   *
   * This pane returns early while a thread is loading, so on the render an
   * effect would have run against there was no element to observe — and an
   * effect that runs once, finds nothing and never looks again leaves the
   * width at nought for the life of the pane. Everything that asks how wide
   * it is then gets the same answer: wide enough. Which is why none of this
   * appeared to work at any size.
   *
   * A callback ref is told each time the node arrives or goes, which is
   * exactly when there is something to measure or stop measuring.
   */
  const paneObserverRef = React.useRef<ResizeObserver | null>(null);
  const setPaneNode = React.useCallback((node: HTMLDivElement | null) => {
    pinchRef.current = node;
    // What the carry moves, when this pane is the floating card. Harmless
    // when it is not: the carry is switched off, and nothing reads this.
    cardRef.current = node;
    paneObserverRef.current?.disconnect();
    paneObserverRef.current = null;
    if (!node) return;
    const measurePane = () => {
      const box = cardRef.current?.getBoundingClientRect();
      if (box) setPaneWidth(box.width);
    };
    // A width on its way somewhere is not worth a render — see pane-slide.
    const observer = new ResizeObserver(() => {
      if (afterMailPaneSlide(measurePane)) return;
      measurePane();
    });
    observer.observe(node);
    paneObserverRef.current = observer;
    // The first answer now, rather than a frame later.
    setPaneWidth(node.getBoundingClientRect().width);
  }, [cardRef, pinchRef]);
  const compactThreadActions =
    paneWidth > 0 && paneWidth < THREAD_ACTIONS_MIN_WIDTH;
  /**
   * The reply box takes the whole pane, edge to edge.
   *
   * At its ordinary width the composer is a card: inset from the pane and
   * narrower than it, so a reply looks like the message it will become.
   * Below this width there is no room to be a card in — the inset and the
   * percentage together were leaving a box a few words wide, with its
   * toolbar wrapped into four rows underneath.
   */
  const compactComposer = paneWidth > 0 && paneWidth < COMPOSER_MIN_WIDTH;
  /** Narrow enough that the composer should take the pane, gutter and all. */
  const fullWidthComposer =
    paneWidth > 0 && paneWidth < COMPOSER_FULL_WIDTH;

  return {
    paneWidth,
    setPaneNode,
    compactThreadActions,
    compactComposer,
    fullWidthComposer,
  };
}
