/**
 * How the mail panes are sized, and the gestures that resize them.
 *
 * Widths, heights, zoom, pull-to-refresh, and pinch. All of it is layout: none
 * of it knows what a message is, and none of it renders anything. It sat in
 * MailPage because that is where it was written, not because it belonged there.
 *
 * Each size is kept in localStorage under its own key, so a pane stays where
 * the user put it. The defaults are fixed values rather than measurements of
 * the window: reading `window.innerWidth` while rendering causes a hydration
 * mismatch on the planner, which renders this on a server first.
 */

import * as React from "react";

import {
  MAIL_PINCH_SCALE_EVENT,
  MAIL_PINCH_WHEEL_EVENT,
  readMailPinch,
} from "@/lib/mail/pinch";
import { startPointerDrag } from "@/lib/pointer-drag";
import {
  getMailListPlacement,
  MAIL_LIST_PLACEMENT_EVENT,
  type MailListPlacement,
} from "@/lib/mail/layout";

const MAIL_LIST_WIDTH_KEY = "redd-plan-mail-list-width";
const MAIL_LIST_HEIGHT_KEY = "redd-plan-mail-list-height";
const MAIL_CONTROLS_WIDTH_KEY = "redd-plan-mail-controls-width";
/** Default thread-list width (left sidebar). */
export const DEFAULT_LIST_WIDTH = 380;
/** Normal list floor — below this, width snaps to the avatar rail. */
export const MIN_LIST_WIDTH = 150;

/**
 * The least the reading pane is left with beside the list.
 *
 * Enforced while the divider is dragged, and again whenever the window
 * changes size: a width that was reasonable on a wide screen is wider than
 * the whole pane once the window is put on half of one, and the list is a
 * fixed size that does not shrink — so it ran off the edge and took the
 * reader with it.
 */
export const MIN_READER_WIDTH = 240;
/**
 * Signal-style avatar rail. Sized for a centered h-9 avatar + a little chrome
 * padding; not meant for free resize between this and MIN_LIST_WIDTH.
 */
export const NARROW_LIST_WIDTH = 56;
/**
 * Least list width at which a thread still reads as one line.
 *
 * Below this the row stacks again. The number is in rem so it grows with
 * the reader's text size. Width chooses the layout. The row is the same.
 */
export const WIDE_LIST_ROW_REMS = 40;

export function wideListRowMinPx(): number {
  if (typeof document === "undefined") return WIDE_LIST_ROW_REMS * 16;
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return WIDE_LIST_ROW_REMS * (Number.isFinite(root) && root > 0 ? root : 16);
}
/** Outward drag (px) from the rail that restores a normal list width. */
const NARROW_ESCAPE_PX = 20;
export const MIN_LIST_HEIGHT = 160;
const DEFAULT_LIST_HEIGHT = 280;
/**
 * aria-valuemax for the list resize handle. Must be a stable SSR/client value —
 * reading window.innerWidth/Height here causes hydration mismatches.
 * Actual drag clamping uses the shell size at pointer-down time.
 */
export const MAX_LIST_ARIA = 2000;
/** Controls column (top/bottom list layout): title, accounts, search. */
export const MIN_CONTROLS_WIDTH = 200;
export const MAX_CONTROLS_WIDTH = 480;
const DEFAULT_CONTROLS_WIDTH = 280;
/**
 * Drag past the avatar rail (while a detail pane is open) to snap the list away.
 * Kept below NARROW_LIST_WIDTH so narrow is a stable stop before hide.
 */
const SNAP_HIDE_LIST_WIDTH = 36;
export const SNAP_HIDE_LIST_HEIGHT = 100;
/** Drag within this many px of the far edge to fill the pane. */
const SNAP_FILL_LIST_PX = 48;
/** Divider thickness reserved so the list can still be dragged back. */
const LIST_DIVIDER_PX = 8;
const MAIL_COMPOSER_WIDTH_KEY = "redd-plan-mail-composer-width-pct";
const MIN_COMPOSER_PCT = 40;
const MAX_COMPOSER_PCT = 100;
const DEFAULT_COMPOSER_PCT = 82;
const MAIL_COMPOSER_HEIGHT_KEY = "redd-plan-mail-composer-height-px";
/** Two lines and the room to see they are two. */
const MIN_COMPOSER_HEIGHT = 80;
const MAX_COMPOSER_HEIGHT = 900;
export const DEFAULT_COMPOSER_HEIGHT = 80;

/**
 * How tall the reply box is, dragged by its top edge and remembered.
 *
 * The box grew with what was typed and started at two lines, and the only
 * way to more room was the button that takes the whole pane. A long reply
 * wants a bigger box without giving up the conversation above it, so the
 * top edge is a handle, the way the sides already are.
 *
 * Pixels rather than a percentage: this is a number of lines to write in,
 * and lines do not get taller because the window did. The ceiling at the
 * drag is the pane itself, so the box cannot be dragged past the top of
 * what it is being written under.
 */
export function useComposerHeightPx(): {
  height: number;
  /**
   * True once the reader has said what the height is — by dragging now, or
   * by dragging on some earlier day and having it remembered.
   *
   * It decides whether the height is a floor or the height. Untouched, the
   * box is at least this tall and grows with what is written in it, which
   * is what a composer should do before anybody has an opinion. Dragged, it
   * is exactly this tall and the words scroll inside it — which is the only
   * way a box can be made smaller than what it holds.
   */
  set: boolean;
  startResize: (event: React.PointerEvent) => void;
} {
  const [height, setHeight] = React.useState(DEFAULT_COMPOSER_HEIGHT);
  const [set, setSet] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = Number.parseFloat(
        localStorage.getItem(MAIL_COMPOSER_HEIGHT_KEY) ?? ""
      );
      if (
        Number.isFinite(stored) &&
        stored >= MIN_COMPOSER_HEIGHT &&
        stored <= MAX_COMPOSER_HEIGHT
      ) {
        setHeight(stored);
        setSet(true);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const startResize = React.useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget as HTMLElement;
      // The pane the composer sits in, so the box cannot be dragged taller
      // than the thread it is being written under. Two thirds of it: the
      // rest is the conversation, which is the reason not to be in focus
      // mode in the first place.
      const pane = handle.closest(".mail-thread-surface");
      const ceiling = pane
        ? Math.min(MAX_COMPOSER_HEIGHT, Math.round(pane.clientHeight * 0.66))
        : MAX_COMPOSER_HEIGHT;
      const startY = event.clientY;
      const startHeight = height;
      const clamp = (dy: number) =>
        Math.min(
          Math.max(ceiling, MIN_COMPOSER_HEIGHT),
          Math.max(MIN_COMPOSER_HEIGHT, startHeight - dy)
        );

      const onMove = (e: PointerEvent) => {
        setSet(true);
        setHeight(clamp(e.clientY - startY));
      };
      const onUp = (e: PointerEvent) => {
        const final = clamp(e.clientY - startY);
        setSet(true);
        setHeight(final);
        try {
          localStorage.setItem(MAIL_COMPOSER_HEIGHT_KEY, String(final));
        } catch {
          /* private mode */
        }
      };

      startPointerDrag(
        { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
        { cursor: "ns-resize", onMove, onEnd: onUp }
      );
    },
    [height]
  );

  return { height, set, startResize };
}

/**
 * Reply-box width as a % of the reading pane, resizable by dragging its
 * edges; persisted across sessions. Message bubbles keep a fixed max width.
 */
export function useComposerWidthPct(): {
  pct: number;
  startResize: (
    edge: "left" | "right"
  ) => (event: React.PointerEvent) => void;
} {
  const [pct, setPct] = React.useState(DEFAULT_COMPOSER_PCT);

  React.useEffect(() => {
    try {
      const stored = Number.parseFloat(
        localStorage.getItem(MAIL_COMPOSER_WIDTH_KEY) ?? ""
      );
      if (
        Number.isFinite(stored) &&
        stored >= MIN_COMPOSER_PCT &&
        stored <= MAX_COMPOSER_PCT
      ) {
        setPct(stored);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const startResize = React.useCallback(
    (edge: "left" | "right") => (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const handle = event.currentTarget as HTMLElement;
      const box = handle.parentElement;
      const available = box?.parentElement?.clientWidth ?? 0;
      if (!available) return;

      const startX = event.clientX;
      const startPct = pct;

      const onMove = (e: PointerEvent) => {
        // Left-aligned box: right-edge drag grows with +dx; left-edge with -dx.
        const dx = e.clientX - startX;
        const deltaPct = ((edge === "right" ? dx : -dx) / available) * 100;
        setPct(
          Math.min(
            MAX_COMPOSER_PCT,
            Math.max(MIN_COMPOSER_PCT, startPct + deltaPct)
          )
        );
      };
      const onUp = (e: PointerEvent) => {
        const dx = e.clientX - startX;
        const deltaPct = ((edge === "right" ? dx : -dx) / available) * 100;
        const finalPct = Math.min(
          MAX_COMPOSER_PCT,
          Math.max(MIN_COMPOSER_PCT, startPct + deltaPct)
        );
        setPct(finalPct);
        try {
          localStorage.setItem(MAIL_COMPOSER_WIDTH_KEY, String(finalPct));
        } catch {
          /* private mode */
        }
      };

      startPointerDrag(
        { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
        { cursor: "col-resize", onMove, onEnd: onUp }
      );
    },
    [pct]
  );

  return { pct, startResize };
}
/** True when a double-click landed on a control (don't also toggle expand). */
export function isInteractiveDoubleClickTarget(
  target: EventTarget | null,
  /**
   * A container that is itself a control, and so does not count as one.
   *
   * A thread row is `role="button"`, so without this the test answers yes
   * about every double click anywhere on a row — the row is the nearest
   * control to everything inside it. What the caller wants to know is
   * whether one of the row's own controls was hit.
   */
  container?: EventTarget | null
): boolean {
  if (!(target instanceof Element)) return false;
  const hit = target.closest(
    "button, a, input, select, textarea, label, [role='button'], [role='menuitem'], [role='option'], [contenteditable='true']"
  );
  return Boolean(hit) && hit !== container;
}
/**
 * Clamp a list size: snap-hide when tiny (if allowed), snap to an avatar rail
 * below the normal min, snap-fill near the far edge, otherwise keep within
 * min…available.
 *
 * Pass `allowNarrow` only when the gesture is still on the rail. Once the
 * user has escaped narrow in the same drag, omit it so the list can't snap
 * back mid-gesture (that felt like "drag twice").
 */
function clampListSize(
  raw: number,
  available: number,
  minSize: number,
  snapHide: number,
  canCollapse: boolean,
  allowNarrow?: number
): { size: number; collapsed: boolean } {
  const maxSize = Math.max(minSize, available - LIST_DIVIDER_PX);
  if (canCollapse && raw < snapHide) {
    return { size: 0, collapsed: true };
  }
  if (raw >= maxSize - SNAP_FILL_LIST_PX) {
    return { size: maxSize, collapsed: false };
  }
  if (allowNarrow != null && raw < minSize) {
    return { size: allowNarrow, collapsed: false };
  }
  return {
    size: Math.min(maxSize, Math.max(minSize, raw)),
    collapsed: false,
  };
}
/**
 * Thread-list width, resizable by dragging the divider; persisted.
 * Can grow to fill the pane (reading pane shrinks away). Dragging below
 * MIN_LIST_WIDTH snaps to the avatar rail; below SNAP_HIDE_LIST_WIDTH (when
 * `canCollapse`) snaps the list away. A short outward drag (or double-click)
 * restores the last normal width from the rail.
 */
export function useMailListWidth(options: {
  canCollapse: boolean;
  onCollapse: () => void;
  /** List on the right: dragging the separator right shrinks the list. */
  invertDrag?: boolean;
}): [
  number,
  (e: React.PointerEvent) => void,
  () => void,
  (e: React.PointerEvent) => void,
] {
  const [width, setWidth] = React.useState(DEFAULT_LIST_WIDTH);
  const lastNormalWidthRef = React.useRef(DEFAULT_LIST_WIDTH);
  const canCollapseRef = React.useRef(options.canCollapse);
  const onCollapseRef = React.useRef(options.onCollapse);
  const invertRef = React.useRef(Boolean(options.invertDrag));
  canCollapseRef.current = options.canCollapse;
  onCollapseRef.current = options.onCollapse;
  invertRef.current = Boolean(options.invertDrag);

  const rememberNormalWidth = React.useCallback((size: number) => {
    if (size >= MIN_LIST_WIDTH) lastNormalWidthRef.current = size;
  }, []);

  React.useEffect(() => {
    try {
      const stored = Number.parseInt(
        localStorage.getItem(MAIL_LIST_WIDTH_KEY) ?? "",
        10
      );
      if (Number.isFinite(stored) && stored >= NARROW_LIST_WIDTH) {
        // Legacy / odd values between rail and min → rail.
        if (stored < MIN_LIST_WIDTH) {
          setWidth(NARROW_LIST_WIDTH);
        } else {
          setWidth(stored);
          lastNormalWidthRef.current = stored;
        }
      }
    } catch {
      /* private mode */
    }
  }, []);

  const persistWidth = React.useCallback((size: number) => {
    rememberNormalWidth(size);
    setWidth(size);
    try {
      localStorage.setItem(MAIL_LIST_WIDTH_KEY, String(size));
    } catch {
      /* private mode */
    }
  }, [rememberNormalWidth]);

  /** Restore the pre-rail width (double-click the resize handle). */
  const expandFromNarrow = React.useCallback(() => {
    if (width > NARROW_LIST_WIDTH) return;
    persistWidth(lastNormalWidthRef.current);
  }, [persistWidth, width]);

  const startResize = React.useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const shell = (event.currentTarget as HTMLElement).parentElement;
      const available = shell?.clientWidth ?? window.innerWidth;
      const dragSign = invertRef.current ? -1 : 1;
      // Rebased while escaping the rail so further movement feels continuous.
      let originX = startX;
      let originWidth = startWidth;
      let escapedNarrow = false;
      const fromNarrow = startWidth <= NARROW_LIST_WIDTH;
      if (!fromNarrow) rememberNormalWidth(startWidth);

      const rawAt = (clientX: number) =>
        originWidth + dragSign * (clientX - originX);

      const onMove = (e: PointerEvent) => {
        if (fromNarrow && !escapedNarrow) {
          const outward = dragSign * (e.clientX - startX);
          if (outward >= NARROW_ESCAPE_PX) {
            // Latch: once out, this gesture can't fall back into the rail.
            escapedNarrow = true;
            originX = e.clientX;
            originWidth = lastNormalWidthRef.current;
            setWidth(originWidth);
            return;
          }
          // Still on the rail (or dragging toward hide).
          const { size } = clampListSize(
            startWidth + dragSign * (e.clientX - startX),
            available,
            MIN_LIST_WIDTH,
            SNAP_HIDE_LIST_WIDTH,
            canCollapseRef.current,
            NARROW_LIST_WIDTH
          );
          if (size > 0) setWidth(size);
          return;
        }

        const { size } = clampListSize(
          rawAt(e.clientX),
          available,
          MIN_LIST_WIDTH,
          SNAP_HIDE_LIST_WIDTH,
          canCollapseRef.current,
          escapedNarrow ? undefined : NARROW_LIST_WIDTH
        );
        if (size > 0) setWidth(size);
      };
      const onUp = (e: PointerEvent) => {

        if (fromNarrow && !escapedNarrow) {
          const outward = dragSign * (e.clientX - startX);
          if (outward >= NARROW_ESCAPE_PX) {
            persistWidth(lastNormalWidthRef.current);
            return;
          }
          const { size, collapsed } = clampListSize(
            startWidth + dragSign * (e.clientX - startX),
            available,
            MIN_LIST_WIDTH,
            SNAP_HIDE_LIST_WIDTH,
            canCollapseRef.current,
            NARROW_LIST_WIDTH
          );
          if (collapsed) {
            setWidth(NARROW_LIST_WIDTH);
            onCollapseRef.current();
            return;
          }
          persistWidth(size);
          return;
        }

        const { size, collapsed } = clampListSize(
          rawAt(e.clientX),
          available,
          MIN_LIST_WIDTH,
          SNAP_HIDE_LIST_WIDTH,
          canCollapseRef.current,
          escapedNarrow ? undefined : NARROW_LIST_WIDTH
        );
        if (collapsed) {
          // Keep the rail width so restoring focus mode shows avatars, not 0.
          setWidth(
            startWidth < MIN_LIST_WIDTH ? NARROW_LIST_WIDTH : startWidth
          );
          onCollapseRef.current();
          return;
        }
        persistWidth(size);
      };

      startPointerDrag(
        { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
        { cursor: "col-resize", onMove, onEnd: onUp }
      );
    },
    [persistWidth, rememberNormalWidth, width]
  );

  /**
   * Resize the chrome column while the list is expanded (controls | threads).
   * Always grows with +dx (column is on the left of the split) and writes the
   * same persisted list width used when the sidebar is collapsed.
   */
  const startColumnResize = React.useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width < MIN_LIST_WIDTH ? lastNormalWidthRef.current : width;
      const shell = (event.currentTarget as HTMLElement).parentElement;
      const available = shell?.clientWidth ?? window.innerWidth;
      const maxWidth = Math.max(MIN_LIST_WIDTH, available - MIN_READER_WIDTH);
      const clamp = (raw: number) =>
        Math.min(maxWidth, Math.max(MIN_LIST_WIDTH, raw));

      const onMove = (e: PointerEvent) => {
        setWidth(clamp(startWidth + (e.clientX - startX)));
      };
      const onUp = (e: PointerEvent) => {
        persistWidth(clamp(startWidth + (e.clientX - startX)));
      };

      startPointerDrag(
        { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
        { cursor: "col-resize", onMove, onEnd: onUp }
      );
    },
    [persistWidth, width]
  );

  return [width, startResize, expandFromNarrow, startColumnResize];
}
export function useMailListHeight(options: {
  canCollapse: boolean;
  onCollapse: () => void;
  /** List on the bottom: dragging the separator down shrinks the list. */
  invertDrag?: boolean;
}): [number, (e: React.PointerEvent) => void] {
  const [height, setHeight] = React.useState(DEFAULT_LIST_HEIGHT);
  const canCollapseRef = React.useRef(options.canCollapse);
  const onCollapseRef = React.useRef(options.onCollapse);
  const invertRef = React.useRef(Boolean(options.invertDrag));
  canCollapseRef.current = options.canCollapse;
  onCollapseRef.current = options.onCollapse;
  invertRef.current = Boolean(options.invertDrag);

  React.useEffect(() => {
    try {
      const stored = Number.parseInt(
        localStorage.getItem(MAIL_LIST_HEIGHT_KEY) ?? "",
        10
      );
      if (Number.isFinite(stored) && stored >= MIN_LIST_HEIGHT) {
        setHeight(stored);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const startResize = React.useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = height;
      const shell = (event.currentTarget as HTMLElement).parentElement;
      const available = shell?.clientHeight ?? window.innerHeight;
      const signed = (y: number) =>
        invertRef.current ? startY - y : y - startY;

      const onMove = (e: PointerEvent) => {
        const raw = startHeight + signed(e.clientY);
        const { size } = clampListSize(
          raw,
          available,
          MIN_LIST_HEIGHT,
          SNAP_HIDE_LIST_HEIGHT,
          canCollapseRef.current
        );
        if (size > 0) setHeight(size);
      };
      const onUp = (e: PointerEvent) => {
        const raw = startHeight + signed(e.clientY);
        const { size, collapsed } = clampListSize(
          raw,
          available,
          MIN_LIST_HEIGHT,
          SNAP_HIDE_LIST_HEIGHT,
          canCollapseRef.current
        );
        if (collapsed) {
          setHeight(startHeight);
          onCollapseRef.current();
          return;
        }
        setHeight(size);
        try {
          localStorage.setItem(MAIL_LIST_HEIGHT_KEY, String(size));
        } catch {
          /* private mode */
        }
      };

      startPointerDrag(
        { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
        { cursor: "row-resize", onMove, onEnd: onUp }
      );
    },
    [height]
  );

  return [height, startResize];
}
/**
 * Width of the controls column when the thread list is top/bottom.
 * Persisted; capped so the message list keeps usable space.
 */
export function useMailControlsWidth(): [number, (e: React.PointerEvent) => void] {
  const [width, setWidth] = React.useState(DEFAULT_CONTROLS_WIDTH);

  React.useEffect(() => {
    try {
      const stored = Number.parseInt(
        localStorage.getItem(MAIL_CONTROLS_WIDTH_KEY) ?? "",
        10
      );
      if (
        Number.isFinite(stored) &&
        stored >= MIN_CONTROLS_WIDTH &&
        stored <= MAX_CONTROLS_WIDTH
      ) {
        setWidth(stored);
      }
    } catch {
      /* private mode */
    }
  }, []);

  const startResize = React.useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;
      const shell = (event.currentTarget as HTMLElement).parentElement;
      const available = shell?.clientWidth ?? window.innerWidth;
      const maxWidth = Math.min(
        MAX_CONTROLS_WIDTH,
        Math.max(MIN_CONTROLS_WIDTH, Math.floor(available * 0.55))
      );

      const clamp = (raw: number) =>
        Math.min(maxWidth, Math.max(MIN_CONTROLS_WIDTH, raw));

      const onMove = (e: PointerEvent) => {
        setWidth(clamp(startWidth + (e.clientX - startX)));
      };
      const onUp = (e: PointerEvent) => {
        const next = clamp(startWidth + (e.clientX - startX));
        setWidth(next);
        try {
          localStorage.setItem(MAIL_CONTROLS_WIDTH_KEY, String(next));
        } catch {
          /* private mode */
        }
      };

      startPointerDrag(
        { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
        { cursor: "col-resize", onMove, onEnd: onUp }
      );
    },
    [width]
  );

  return [width, startResize];
}
export function useMailListPlacement(): MailListPlacement {
  const [placement, setPlacement] = React.useState<MailListPlacement>("left");
  React.useEffect(() => {
    setPlacement(getMailListPlacement());
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<MailListPlacement>).detail;
      setPlacement(detail ?? getMailListPlacement());
    };
    window.addEventListener(MAIL_LIST_PLACEMENT_EVENT, onChange);
    return () => window.removeEventListener(MAIL_LIST_PLACEMENT_EVENT, onChange);
  }, []);
  return placement;
}
const MAIL_ZOOM_KEY = "redd-plan-mail-zoom";
/*
 * How far the reader's text size goes.
 *
 * Half size is smaller than anybody reads at and twice is bigger than
 * anybody reads at; both ends were room the gesture had to travel through.
 * These two are the sizes a reader actually stops at.
 */
export const MIN_ZOOM = 0.7;
export const MAX_ZOOM = 1.8;

/**
 * How much of the range a pinch covers.
 *
 * macOS reports a pinch as a stream of small magnifications, and a
 * comfortable one — fingers together to spread — adds up to about 1.0 to
 * 2.0. Mapped straight through, as this was, that is the whole of a range
 * a single unit wide in one movement: the reader arrives at an end without
 * having aimed for it, and has to creep back.
 *
 * A seventh puts a full pinch at about a sixth of the range: enough that
 * one gesture is worth making, little enough that the reader stops where
 * they aimed. Raise it to make the zoom livelier.
 *
 * NOTE while working on this: the listeners are attached in an effect keyed
 * on the pane, so editing this number does not reach a running window —
 * hot reload re-renders but does not re-attach. Reload the window to feel a
 * change.
 */
const PINCH_DAMPING = 0.15;
/** The round numbers the buttons and the keys move between. */
const ZOOM_STEP = 0.1;

/**
 * The next round size up or down from wherever the zoom has got to.
 *
 * A pinch lands anywhere — 98%, 137% — and adding a tenth to that gives
 * another number nobody asked for. Stepping goes to the next tenth
 * instead, so 98% up is 100% rather than 108%, and there is a way back
 * to a round number without typing one.
 */
export function nextZoomStop(current: number, direction: 1 | -1): number {
  const steps = current / ZOOM_STEP;
  // The nudge keeps a value that is already on a stop from being held
  // there by its own floating-point dust.
  const next =
    direction > 0
      ? Math.floor(steps + 1e-6) + 1
      : Math.ceil(steps - 1e-6) - 1;
  return Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.round(next * ZOOM_STEP * 1000) / 1000)
  );
}
/** Reading/composing text size, persisted across sessions. */
export function useMailZoom(): [number, (delta: number) => void] {
  const [zoom, setZoom] = React.useState(1);

  React.useEffect(() => {
    try {
      const stored = Number.parseFloat(localStorage.getItem(MAIL_ZOOM_KEY) ?? "");
      // Clamped rather than refused: a reader who was at 200% before the
      // range narrowed wants the biggest there now is, not to be put back
      // to 100% for having liked their mail large.
      if (Number.isFinite(stored)) {
        setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stored)));
      }
    } catch {
      /* private mode */
    }
  }, []);

  /*
    Remembered after the gesture, not during it.

    A pinch arrives as tens of events a second and each one wrote the new
    size to disk. Writing is synchronous, so the writes landed between the
    reader's fingers and the screen — the zoom lagged the hand. The last
    size to settle is the one worth keeping, so it is kept a beat later.
  */
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    []
  );

  const adjust = React.useCallback((delta: number) => {
    setZoom((current) => {
      // Fine-grained so pinch gestures feel continuous; buttons pass ±0.1.
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, Math.round((current + delta) * 1000) / 1000)
      );
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try {
          localStorage.setItem(MAIL_ZOOM_KEY, String(next));
        } catch {
          /* private mode */
        }
      }, 250);
      return next;
    });
  }, []);

  return [zoom, adjust];
}
/**
 * Trackpad pinch-to-zoom on the thread/compose pane, driving the same adjust
 * as the +/− controls.
 *
 * - Chromium: ctrl+wheel
 * - Safari / WKWebView: gesturestart/gesturechange (and sometimes ctrl+wheel)
 * - Email iframes: forwarded via MAIL_PINCH_* from EmailHtmlView
 * - Tauri Mac app: native NSEvent magnify also dispatches MAIL_PINCH_SCALE_EVENT
 *
 * Listeners are on window (capture) so they still fire when WebKit targets a
 * nested node; we hit-test against `ref` (iframe elements count as inside).
 */
export function usePinchZoom(
  ref: React.RefObject<HTMLDivElement | null>,
  onAdjust: (delta: number) => void,
  /** The pane renders conditionally; re-attach once it exists. */
  enabled: boolean,
  /**
   * Called with the pointer's y, in window pixels, before every step of a
   * gesture. A pane that holds a place still while it resizes takes its
   * reading here: the place is the one under the fingers, and this is the
   * last moment it can be read at the old size. Null when the gesture says
   * nothing about where it is.
   */
  onZoomStart?: (clientY: number | null) => void
) {
  const onAdjustRef = React.useRef(onAdjust);
  const onZoomStartRef = React.useRef(onZoomStart);
  React.useEffect(() => {
    onAdjustRef.current = onAdjust;
    onZoomStartRef.current = onZoomStart;
  });

  React.useEffect(() => {
    if (!enabled) return;

    // Continuous zoom: pinch movement maps onto the zoom value, no
    // stepping. See PINCH_DAMPING for how far a gesture goes.
    const applyWheel = (deltaY: number, at: number | null) => {
      if (!Number.isFinite(deltaY) || deltaY === 0) return;
      onZoomStartRef.current?.(at);
      onAdjustRef.current(-deltaY * 0.0025 * PINCH_DAMPING);
    };

    const applyScaleRatio = (ratio: number, at: number | null) => {
      if (!Number.isFinite(ratio) || ratio <= 0) return;
      onZoomStartRef.current?.(at);
      onAdjustRef.current((ratio - 1) * PINCH_DAMPING);
    };

    // An attachment preview that zooms itself is up: every pinch is its.
    const previewHasZoom = () =>
      document.querySelector("[data-mail-preview-zoom]") != null;

    const eventOverPane = (e: Event) => {
      const pane = ref.current;
      if (!pane) return false;
      if (previewHasZoom()) return false;
      const any = e as { clientX?: number; clientY?: number; target?: EventTarget | null };
      if (
        typeof any.clientX === "number" &&
        typeof any.clientY === "number" &&
        Number.isFinite(any.clientX) &&
        Number.isFinite(any.clientY)
      ) {
        // Over an iframe, this returns the <iframe> element in the parent DOM.
        const top = document.elementFromPoint(any.clientX, any.clientY);
        if (top && pane.contains(top)) return true;
      }
      const t = any.target;
      return t instanceof Node && pane.contains(t);
    };

    const onWheel = (e: WheelEvent) => {
      /*
        Ctrl only, which is what a trackpad pinch reports.

        Cmd used to zoom as well, and it is one binding too many: a pinch
        does it, and so does Ctrl and the wheel. What Cmd mostly did was
        zoom the reader when somebody meant to scroll with a hand still on
        the key from the shortcut before it.
      */
      if (!e.ctrlKey) return; // plain scrolling
      if (!eventOverPane(e)) return;
      e.preventDefault(); // keep the browser from zooming the whole page
      applyWheel(e.deltaY, e.clientY);
    };

    let gestureScale = 1;
    let gestureActive = false;
    const onGestureStart = (e: Event) => {
      if (!eventOverPane(e)) return;
      e.preventDefault();
      gestureActive = true;
      gestureScale = (e as Event & { scale?: number }).scale ?? 1;
    };
    const onGestureChange = (e: Event) => {
      if (!gestureActive) return;
      e.preventDefault();
      const scale = (e as Event & { scale?: number }).scale ?? 1;
      const at = (e as Event & { clientY?: number }).clientY;
      if (gestureScale > 0) {
        applyScaleRatio(scale / gestureScale, typeof at === "number" ? at : null);
      }
      gestureScale = scale;
    };
    const onGestureEnd = () => {
      gestureActive = false;
    };

    // Iframe forwards + native Tauri magnify bridge — already scoped upstream.
    const onForwardedWheel = (e: Event) => {
      if (previewHasZoom()) return;
      const d = readMailPinch(e);
      applyWheel(d.value, d.y);
    };
    const onForwardedScale = (e: Event) => {
      if (previewHasZoom()) return;
      const d = readMailPinch(e);
      applyScaleRatio(d.value, d.y);
    };

    const gestureOpts: AddEventListenerOptions = {
      capture: true,
      passive: false,
    };
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("gesturestart", onGestureStart, gestureOpts);
    window.addEventListener("gesturechange", onGestureChange, gestureOpts);
    window.addEventListener("gestureend", onGestureEnd, { capture: true });
    window.addEventListener(MAIL_PINCH_WHEEL_EVENT, onForwardedWheel);
    window.addEventListener(MAIL_PINCH_SCALE_EVENT, onForwardedScale);
    return () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("gesturestart", onGestureStart, gestureOpts);
      window.removeEventListener("gesturechange", onGestureChange, gestureOpts);
      window.removeEventListener("gestureend", onGestureEnd, { capture: true });
      window.removeEventListener(MAIL_PINCH_WHEEL_EVENT, onForwardedWheel);
      window.removeEventListener(MAIL_PINCH_SCALE_EVENT, onForwardedScale);
    };
  }, [ref, enabled]);
}
