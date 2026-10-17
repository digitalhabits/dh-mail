"use client";

/**
 * The reply card can be dragged anywhere over the thread, as the reply tray
 * can (reply-tray-drag).
 *
 * A drag starts on the card's own ground: its edge, the "Replying to" line,
 * the row under the box. Never in the box you type in, on a button, a link
 * or a field, which keep the pointer for themselves. The card moves by a
 * shift from its usual place, and stays inside the thread. A double-click
 * on its edge puts it back.
 *
 * The place is not kept. It lasts while the thread is open, and the next
 * thread opens the card in its usual place. Kept for every thread, a card
 * moved once by a stray drag opened over the middle of every thread after
 * it, and read as a bug (Ulrik, 2026-10-17).
 *
 * The shift is drawn on the band that holds the card, not on the card:
 * the band cuts off what stands outside it, and a card moved up out of it
 * lost its top. The band is zoomed with the pane, so a shift on screen is
 * divided by the zoom before it is drawn.
 *
 * The pointer is captured for the drag, and the press on the card's
 * ground starts no text selection or native drag. Either of those kept the
 * release from arriving, and the card went on following the pointer.
 */

import * as React from "react";

/** Where a place was kept before it was not. Cleared once, so an old one goes. */
const OLD_KEY = "dh-mail-composer-place";
const DRAG_SLOP = 4;
const EDGE = 8;
const NOT_A_HANDLE =
  'input, textarea, select, button, a, label, [contenteditable="true"], [contenteditable=""], .ql-editor, [role="separator"], [role="button"], [role="combobox"], [role="listbox"]';

type Shift = { x: number; y: number };

function forgetOldPlace() {
  try {
    window.localStorage.removeItem(OLD_KEY);
  } catch {
    // No storage here, so nothing was kept.
  }
}

const within = (n: number, lo: number, hi: number) => Math.max(Math.min(lo, hi), Math.min(n, Math.max(lo, hi)));

export function useComposerDrag(
  enabled: boolean,
  zoom: number
): {
  transform: string | undefined;
  handlers: {
    onPointerDown?: (e: React.PointerEvent<HTMLElement>) => void;
    onDoubleClick?: (e: React.MouseEvent<HTMLElement>) => void;
  };
} {
  const [shift, setShift] = React.useState<Shift | null>(null);
  React.useEffect(forgetOldPlace, []);

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest?.(NOT_A_HANDLE)) return;
      const card = e.currentTarget;
      const box = card.closest<HTMLElement>(".mail-composer-region")?.offsetParent as HTMLElement | null;
      if (!box) return;
      e.preventDefault();
      const pointer = e.pointerId;
      try {
        card.setPointerCapture(pointer);
      } catch {
        // The window still hears the release.
      }
      const start = { x: e.clientX, y: e.clientY };
      const from = shift ?? { x: 0, y: 0 };
      const c = card.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      let moved = false;
      let last: Shift = from;
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== pointer) return;
        // No button down any more: the release went somewhere else.
        if (ev.buttons === 0) return up();
        const dx = ev.clientX - start.x;
        const dy = ev.clientY - start.y;
        if (!moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
        moved = true;
        ev.preventDefault();
        last = {
          x: from.x + within(dx, b.left + EDGE - c.left, b.right - EDGE - c.right),
          y: from.y + within(dy, b.top + EDGE - c.top, b.bottom - EDGE - c.bottom),
        };
        setShift(last);
      };
      let done = false;
      function up() {
        if (done) return;
        done = true;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        card.removeEventListener("lostpointercapture", up);
        window.removeEventListener("blur", up);
        try {
          card.releasePointerCapture(pointer);
        } catch {
          // Already released.
        }
      }
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
      card.addEventListener("lostpointercapture", up);
      window.addEventListener("blur", up);
    },
    [shift]
  );

  const onDoubleClick = React.useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    setShift(null);
  }, []);

  if (!enabled) return { transform: undefined, handlers: {} };
  const z = zoom || 1;
  return {
    transform: shift ? `translate(${shift.x / z}px, ${shift.y / z}px)` : undefined,
    handlers: { onPointerDown, onDoubleClick },
  };
}
