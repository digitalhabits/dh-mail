"use client";

/*
 * The mail page's geometry, off the page component: how much room the
 * panes actually have, what the list and the folder rail are shown at
 * once the composer has taken its share, whether the rail still fits,
 * and every number the pane sweeps move by — transforms, clip edges,
 * where the title bar's controls begin. MailPage hands in what the
 * reader chose and receives where everything stands; nothing in here
 * fetches, selects or renders.
 */

import * as React from "react";
import {
  afterMailPaneSlide,
  setMailPaneSliding,
  PANE_SLIDE_MS as LIST_SLIDE_MS,
  PANE_SLIDE_GRACE_MS as RAIL_SLIDE_GRACE_MS,
} from "@/lib/mail/pane-slide";
import { usePaneSweep } from "@/lib/mail/use-pane-sweep";
import {
  MIN_LIST_WIDTH,
  MIN_READER_WIDTH,
  NARROW_LIST_WIDTH,
  SNAP_HIDE_LIST_HEIGHT,
  wideListRowMinPx,
} from "@/components/mail/use-mail-layout";
import { FOLDER_RAIL_MIN_WIDTH } from "@/lib/mail/folder-rail";
import type { MailListPlacement } from "@/lib/mail/layout";

/**
 * How long the folder rail takes to slide. Keep in step with the
 * `duration-200` on the rail's own wrapper.
 */
const RAIL_SLIDE_MS = 200;

/**
 * What gives way as the window narrows, and in what order.
 *
 * Not everything at once. Squeezing all three panes together is what makes
 * a small mail window unpleasant in every client that does it: at the
 * bottom of the range nothing is comfortable and nothing has been chosen.
 * Something goes first, and it should be whatever is least load-bearing.
 *
 * The picture in the empty reading pane goes first — see MailRestPanel. It
 * is there because there was space for it, and shrunk into a narrow pane it
 * is a stamp rather than a rest. The line under it stays: a sentence needs
 * no room to be worth reading, and a pane with nothing in it at all says
 * less than one with a few words.
 *
 * The folder rail goes next, and closes rather than floating over the list.
 * An overlay would cover the very list a conversation is dragged *from*
 * when it is filed into that rail, which is the gesture the rail exists
 * for. Closed, the toggle returns to the tab row and a thread dragged at it
 * opens the rail again — so filing survives at any width.
 *
 * The list's own ladder — full, then narrow, then hidden — stays where it
 * is, as the floor rather than the rule.
 */
const RAIL_GIVES_WAY_BELOW = 760;


/**
 * The gap the rail is resized by, between it and the list. Keep in step with
 * the `w-1` on the separator.
 */
const RAIL_GUTTER = 4;

/**
 * How far the thread list holds its contents in from its own left edge. Keep
 * in step with the `px-5` on the list's controls column.
 */
const LIST_COLUMN_PAD = 20;
/**
 * How far the window's traffic lights reach from its left edge, with a
 * little slack. A window that has none — the standalone app on Windows —
 * says where its title row starts itself.
 */
const TRAFFIC_LIGHTS_RIGHT = 80;

/**
 * The narrowest a message being read or written is allowed to get.
 *
 * The composer is the one that decides this. It has rows with two things on
 * each — a recipient field with Cc and Bcc beside it, a subject with the
 * expand control after it — and under about this width they stop fitting
 * side by side and start sitting on top of one another.
 *
 * It is a floor, not a size: nothing is widened to reach it. It is what the
 * list and the folders give way to when there is not enough room to go
 * round, which is what pressing New email is asking for — room to write in.
 */
const MIN_DETAIL_WIDTH = 460;

export function useMailPaneGeometry(input: {
  listPlacement: MailListPlacement;
  listVertical: boolean;
  listExpanded: boolean;
  listCollapsed: boolean;
  detailOpen: boolean;
  listWidth: number;
  listHeight: number;
  controlsWidth: number;
  railOpen: boolean;
  railWidth: number;
  railResizing: boolean;
  /** Set by the expand toggle before its sweep starts — the sweep then
      opens from the reader's edge rather than from a strip nobody saw. */
  expandedFromHidden: React.MutableRefObject<boolean>;
}) {
  const {
    listPlacement,
    listVertical,
    listExpanded,
    listCollapsed,
    detailOpen,
    listWidth,
    listHeight,
    controlsWidth,
    railOpen,
    railWidth,
    railResizing,
    expandedFromHidden,
  } = input;

  const hideList = listCollapsed && detailOpen;

  /*
    The list does not animate its width, because animating a width is
    asking the browser to lay the reader out again at every step on the
    way. Measured, that was the whole of the remaining cost: a
    one-message thread slid without dropping a frame while a twenty-two
    message thread dropped five, and no amount of deferring our own
    JavaScript touched it, because the work was the browser's.

    So for the length of a slide the list and the folder rail step out of
    the flow entirely — absolute over the pane row, at their full size —
    and travel by `transform`, which the compositor moves without laying
    anything out. The reader takes its final width in one layout: at the
    start of a slide out, where the departing columns still cover the
    ground it gains, and at the end of a slide in, where the arrived
    columns cover the ground it gives up. One layout a slide instead of
    twenty, and every frame between is composite-only.

    The movement itself is usePaneSweep's, shared with every sweep in the
    app. What stays here is what the states mean: `listMounted` is
    whether the column is in the document at all, `listOpen` is where it
    is asked to stand, `listSliding` is whether it is out of the flow and
    moving — false at rest, so dragging the divider never animates and
    never pays for a transition it did not ask for.
  */
  const {
    at: listOpen,
    sliding: listSliding,
    mounted: listMounted,
  } = usePaneSweep(!hideList, { flag: true });
  /*
    Expanding the list moves at the same tempo as putting it away — the
    same gesture at two speeds would read as two different gestures. For
    the length of the change the list stands absolute over the whole
    pane, laid out once at its expanded size, and a clip-path edge sweeps
    it open or closed. The reader stays mounted underneath until the list
    has it covered, so what the sweep uncovers or covers is real.
    Clipping is the compositor's work, like the transform: no layout
    happens while the edge moves.

    `listGrown` is where the edge stands — over the whole pane, or over
    the list's resting strip.
  */
  const { at: listGrown, sliding: listExpandSliding } = usePaneSweep(
    listExpanded,
    {
      flag: true,
      // Leaving expanded mode straight into a hidden list — a double-click
      // on a row while expanded — belongs to the hide sweep, not to this
      // one: two edges moving the same box would fight over it.
      snapWhen: (next) => !next && listCollapsed && detailOpen,
    }
  );
  // A restore always closes to the visible strip, wherever the last
  // expansion opened from.
  React.useEffect(() => {
    if (!listExpanded) expandedFromHidden.current = false;
  }, [listExpanded, expandedFromHidden]);
  /*
    Everything that watches its own width stands still until the slide is
    over — see lib/mail/pane-slide for what that was costing.

    The flag goes up inside usePaneSweep, a commit before anything moves;
    it comes down here, after the commit and the paint that put the
    columns back in the flow. Lowered any earlier, the measurements it
    releases would read the frame before the one they were waiting for —
    and it is shared by both sweeps, so it must not come down while
    either is running.
  */
  const paneSliding = listSliding || listExpandSliding;
  React.useEffect(() => {
    if (!paneSliding) setMailPaneSliding(false);
  }, [paneSliding]);
  React.useEffect(() => () => setMailPaneSliding(false), []);

  /**
   * How much room the panes actually have, measured rather than assumed.
   *
   * The window is not the answer: in the planner this page sits inside a
   * larger shell, and the reader's room depends on how wide the reader
   * has dragged the other two.
   */
  const paneRowRef = React.useRef<HTMLDivElement | null>(null);
  const [paneWidth, setPaneWidth] = React.useState(0);
  /**
   * How wide the rows themselves are.
   *
   * Expanding used to report the old sidebar width. The one-line row
   * answers this measurement, so it follows the window and the rail.
   */
  const threadListRef = React.useRef<HTMLDivElement | null>(null);
  const [threadListWidth, setThreadListWidth] = React.useState(0);
  /**
   * And where it begins, in window pixels.
   *
   * Only the traffic lights need this: they are drawn at the window's own
   * corner, so how far they reach into this page depends on what the
   * shell has put to the left of it. Measured in the same pass, because
   * anything that moves this page sideways changes how wide it is as
   * well.
   */
  const [paneLeft, setPaneLeft] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = paneRowRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setPaneWidth(entry.contentRect.width);
      setPaneLeft(entry.target.getBoundingClientRect().left);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * A width of nought means it has not been measured yet, and a first
   * paint that hides what it is about to show is worse than one that
   * shows what it is about to hide.
   */
  const measured = paneWidth > 0;
  /**
   * `railOpen` stays exactly as the reader left it. What narrows is only
   * whether it is shown, so widening the window brings the folders back
   * without anybody having to ask for them twice.
   */
  const railShowing =
    railOpen && (!measured || paneWidth >= RAIL_GIVES_WAY_BELOW);

  /**
   * Closed and finished closing: out of the tab order, rather than a
   * strip of nothing that can still be tabbed into. Only once the
   * closing slide has finished, or it would vanish rather than close.
   */
  const [railHidden, setRailHidden] = React.useState(true);
  React.useEffect(() => {
    if (railShowing) {
      setRailHidden(false);
      return;
    }
    const timer = window.setTimeout(
      () => setRailHidden(true),
      RAIL_SLIDE_MS + RAIL_SLIDE_GRACE_MS
    );
    return () => window.clearTimeout(timer);
  }, [railShowing]);

  /**
   * The list and the folders stand aside for a message being written.
   *
   * Pressing New email asks for room to write in, and on a window where
   * the reader has given most of the width to the list there was none:
   * the composer arrived at whatever was left, which was narrow enough
   * for its own rows to overlap. Rather than refuse the layout, the two
   * columns beside it give up what they can — the list first, because it
   * is the wider of them and the one being written away from, then the
   * folders.
   *
   * Neither is written down. This is what they are shown at while the
   * composer is up; the widths the reader dragged are what they go back
   * to when it closes, without anybody having to drag them again.
   *
   * Only side by side, and only once measured. Stacked (list over
   * reader) the width is shared with nothing, and an unmeasured pane
   * would squeeze against a guess.
   */
  const squeezable =
    measured && !listVertical && !listExpanded && !listCollapsed;
  const railSpace = railShowing ? railWidth + RAIL_GUTTER : 0;
  /**
   * How much is kept for the pane beside the list.
   *
   * Always something: the list is a fixed width that does not shrink, so
   * a width set on a wide screen is wider than the whole pane once the
   * window is put on half of one — and what ran off the edge was the
   * reader, then the right-hand end of the list itself. The divider has
   * always refused to be dragged past this; resizing the window now
   * refuses too.
   *
   * More than that while a message is open, because a message being read
   * or written needs room to be worth opening.
   */
  const reserve = detailOpen ? MIN_DETAIL_WIDTH : MIN_READER_WIDTH;
  const overflowing = squeezable
    ? Math.max(0, listWidth + railSpace + reserve - paneWidth)
    : 0;
  /*
   * Both give, in proportion to what each has to give.
   *
   * Taking it from the list alone would crush the column being written
   * away from while the folders beside it kept every pixel — at a narrow
   * window the list went to its floor and the rail never moved. Sharing
   * it by how much room each has above its own floor takes more from
   * whichever is roomier, and leaves neither one squashed on its own.
   */
  const listSlack = Math.max(0, listWidth - MIN_LIST_WIDTH);
  const railSlack = railShowing
    ? Math.max(0, railWidth - FOLDER_RAIL_MIN_WIDTH)
    : 0;
  const slack = listSlack + railSlack;
  const taken = Math.min(overflowing, slack);
  const listGiveaway = slack > 0 ? (taken * listSlack) / slack : 0;
  const railGiveaway = slack > 0 ? (taken * railSlack) / slack : 0;
  const shownListWidth = Math.round(listWidth - listGiveaway);
  const shownRailWidth = Math.round(railWidth - railGiveaway);

  /**
   * Avatar-rail mode: left/right list dragged below the readable min.
   * Top/bottom keep a normal height strip (no avatar-column analogue).
   */
  const listNarrow =
    !listVertical && !listExpanded && listWidth <= NARROW_LIST_WIDTH;
  const estimatedThreadListWidth =
    listExpanded && !listVertical
      ? Math.max(0, paneWidth - railSpace)
      : listVertical
        ? Math.max(0, paneWidth - controlsWidth)
        : shownListWidth;
  const listRowWide =
    !listNarrow &&
    (threadListWidth || estimatedThreadListWidth) >= wideListRowMinPx();
  React.useLayoutEffect(() => {
    const el = threadListRef.current;
    if (!el) return;
    const measureList = () => {
      const box = threadListRef.current?.getBoundingClientRect();
      if (box) setThreadListWidth(box.width);
    };
    const observer = new ResizeObserver(() => {
      if (afterMailPaneSlide(measureList)) return;
      measureList();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hideList, listNarrow]);
  // Vertical layout still fades while dragging toward hide; horizontal
  // snaps discretely to the rail, so a mid-drag fade isn't useful there.
  const listNearSnap =
    detailOpen && listVertical && listHeight < SNAP_HIDE_LIST_HEIGHT;
  const listFirst =
    listPlacement === "left" || listPlacement === "top";
  /**
   * The folders travel with the list.
   *
   * They are the list's own heading — which mailbox and which folder
   * these threads came from — so with the list moved to the right of the
   * reader, the rail belongs on the far side of it and not stranded
   * across the window from what it names. Above and below, the list runs
   * the width of the window and has no far side, so the rail stays where
   * it was.
   */
  const railOnRight = listPlacement === "right";
  /*
    The slide, in numbers — see the note over the sweep states.

    While `listSliding`, the list and the rail stand absolute over the
    pane row at the size and place they hold at rest, and travel by
    transform. Side by side they leave as one panel, so both go the full
    distance — the rail's width and the list's together — toward the edge
    the list lives against. Stacked, the two part ways: the list goes up
    or down by its own height, and the rail steps sideways off by its own
    width, which is the way each of them came in.

    Expanded is not a slide: the list is the pane, and has nowhere to go.
  */
  const listSlideOverlay = listSliding && !listExpanded && !listExpandSliding;
  /*
    The expand sweep, in numbers. The edge stands over the list's resting
    strip — its width or height, against its own side — or over nothing
    at all when Expand was pressed with the list hidden, and travels to
    the far side of the pane. calc() keeps the far side out of it: the
    pane's own size never has to be read.
  */
  const expandRestSpan = expandedFromHidden.current
    ? 0
    : listVertical
      ? listHeight
      : shownListWidth;
  const expandRestClip = listVertical
    ? listFirst
      ? `inset(0px 0px calc(100% - ${expandRestSpan}px) 0px)`
      : `inset(calc(100% - ${expandRestSpan}px) 0px 0px 0px)`
    : listFirst
      ? `inset(0px calc(100% - ${expandRestSpan}px) 0px 0px)`
      : `inset(0px 0px 0px calc(100% - ${expandRestSpan}px))`;
  const expandClip = listGrown ? "inset(0px)" : expandRestClip;
  const railInset = railShowing ? shownRailWidth : 0;
  const listSlideDistance = listVertical
    ? listHeight
    : shownListWidth + railInset;
  const slideSign = listFirst ? -1 : 1;
  const listSlideTransform = listOpen
    ? "translate(0px, 0px)"
    : listVertical
      ? `translateY(${slideSign * listSlideDistance}px)`
      : `translateX(${slideSign * listSlideDistance}px)`;
  const railSlideTransform = listOpen
    ? "translateX(0px)"
    : `translateX(${listVertical ? -railInset : slideSign * listSlideDistance}px)`;
  /**
   * Where the thread list's own controls begin, in px from the left edge
   * of the window.
   *
   * The list column starts after the rail and the gutter between them,
   * and holds its contents in from there — so New email, the first thing
   * in it, stands here. Published to the shell so a title strip laid out
   * from the left edge of the window can stand its own first control in
   * the same column (the standalone app on Windows does — see
   * `--mail-titlebar-left` in apps/mail/src/standalone.css). Only the
   * column's own inset when there is no rail to the left of the list to
   * clear.
   */
  const listControlsLeft =
    (!hideList && railShowing && !railOnRight
      ? shownRailWidth + RAIL_GUTTER
      : 0) + LIST_COLUMN_PAD;
  /**
   * Where the title bar's row of controls begins: the list column, so
   * that grouping, density and settings stand over New email rather than
   * out in the middle of the strip, and the search runs on from them.
   *
   * The same place whatever the folders are doing. The row used to be
   * laid out from the window's width instead, so that it never moved
   * when the rail did; but that put its first control a long way from
   * the column it belongs to, and a control that stands nowhere in
   * particular is one the reader has to look for every time.
   *
   * Never behind the traffic lights: they are the window's, and how far
   * they reach into this page depends on what the shell has to the left
   * of it — nothing, in the standalone app. The `+ 4` answers the row's
   * own -4px, which lines painted edges up rather than boxes.
   *
   * A shell can still put the row somewhere else through the variable —
   * see `--mail-titlebar-left` in apps/mail/src/standalone.css.
   */
  const lightsFloor = Math.max(0, TRAFFIC_LIGHTS_RIGHT - paneLeft) + 4;
  const titlebarLeft = `var(--mail-titlebar-left, max(${listControlsLeft}px, ${lightsFloor}px))`;
  const listBorderClass =
    listPlacement === "left"
      ? "border-r"
      : listPlacement === "right"
        ? "border-l"
        : listPlacement === "top"
          ? "border-b"
          : "border-t";
  /**
   * How long anything following the list column takes to catch up with
   * it: the length of the pane sweep while the list is moving, the
   * rail's own toggle otherwise, and nothing at all while the rail is
   * being dragged, where a lag would be a control trailing the pointer.
   */
  const railSlideDuration = railResizing
    ? "0ms"
    : `${listSliding ? LIST_SLIDE_MS : RAIL_SLIDE_MS}ms`;

  return {
    paneRowRef,
    threadListRef,
    paneWidth,
    threadListWidth,
    hideList,
    railShowing,
    railHidden,
    railSpace,
    shownListWidth,
    shownRailWidth,
    listOpen,
    listSliding,
    listMounted,
    listExpandSliding,
    listSlideOverlay,
    expandClip,
    railInset,
    listSlideTransform,
    railSlideTransform,
    listNarrow,
    listRowWide,
    listNearSnap,
    listFirst,
    railOnRight,
    listControlsLeft,
    titlebarLeft,
    listBorderClass,
    railSlideDuration,
  };
}
