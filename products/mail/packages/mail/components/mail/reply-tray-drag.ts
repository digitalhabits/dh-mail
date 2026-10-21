"use client";

/**
 * The reply tray can be dragged to where the reader wants it.
 *
 * Its place is a distance from the bottom right corner of the thread, so
 * it stays in the same corner when the window changes size. It is not
 * kept: it lasts while the thread is open, and the next thread opens the
 * tray in its usual place. If the place is kept for every thread, a tray
 * moved once stands somewhere odd in every thread after it. A
 * press on a button that moves less than a few pixels is still a press;
 * a drag that starts on a button does not also press it. A double-click on
 * the tray's own edge puts it back in its usual place.
 */

import { OLD_REPLY_TRAY_KEY as OLD_KEY } from "@/lib/mail/storage-keys";
import * as React from "react";

/** OLD_KEY holds a place that an earlier build kept. Cleared once, so an old one goes. */
/** How far the pointer moves before a press becomes a drag. */
const DRAG_SLOP = 4;
/** The space kept between the tray and the thread's edges. */
const EDGE = 8;

type Place = { right: number; bottom: number; width: number; height: number };

function forgetOldPlace() {
  try {
    window.localStorage.removeItem(OLD_KEY);
  } catch {
    // No storage here, so nothing was kept.
  }
}

const clamp = (n: number, max: number) => Math.max(EDGE, Math.min(n, Math.max(EDGE, max)));

/** The tray's style for a place, held inside the thread however it is sized. */
function placeStyle(place: Place | null): React.CSSProperties | undefined {
  if (!place) return undefined;
  return {
    right: `clamp(${EDGE}px, ${place.right}px, calc(100% - ${place.width + EDGE}px))`,
    bottom: `clamp(${EDGE}px, ${place.bottom}px, calc(100% - ${place.height + EDGE}px))`,
  };
}

export function useReplyTrayDrag(): {
  style: React.CSSProperties | undefined;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
  onDoubleClick: (e: React.MouseEvent<HTMLElement>) => void;
} {
  const [place, setPlace] = React.useState<Place | null>(null);
  React.useEffect(forgetOldPlace, []);
  const [dragging, setDragging] = React.useState(false);
  const swallowClick = React.useRef(false);

  const onPointerDown = React.useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const tray = e.currentTarget;
    const box = tray.offsetParent as HTMLElement | null;
    if (!box) return;
    const start = { x: e.clientX, y: e.clientY };
    const t = tray.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const from = { right: b.right - t.right, bottom: b.bottom - t.bottom };
    let moved = false;
    let last: Place | null = null;
    const pointer = e.pointerId;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      // No button down any more: the release went somewhere else.
      if (ev.buttons === 0) return up();
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      if (!moved) {
        moved = true;
        setDragging(true);
        // Only once it is a drag: captured from the press, a click on a
        // button would land on the tray instead.
        try {
          tray.setPointerCapture(pointer);
        } catch {
          // The window still hears the release.
        }
      }
      ev.preventDefault();
      last = {
        right: clamp(from.right - dx, b.width - t.width - EDGE),
        bottom: clamp(from.bottom - dy, b.height - t.height - EDGE),
        width: t.width,
        height: t.height,
      };
      setPlace(last);
    };
    let done = false;
    function up() {
      if (done) return;
      done = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", up);
      if (!moved) return;
      try {
        tray.releasePointerCapture(pointer);
      } catch {
        // Already released.
      }
      swallowClick.current = true;
      setDragging(false);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", up);
  }, []);

  const onClickCapture = React.useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDoubleClick = React.useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    setPlace(null);
  }, []);

  return { style: placeStyle(place), dragging, onPointerDown, onClickCapture, onDoubleClick };
}
