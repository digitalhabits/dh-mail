"use client";

import * as React from "react";

import { MIN_BUBBLE_WIDTH, saveBubbleWidth, showBubbleWidth } from "@/lib/mail/bubble-width";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/**
 * The outer edge of a message, to drag it wider or narrower.
 *
 * On the side away from the speaker's corner: the right edge of a message
 * from somebody else, the left edge of one's own, which grows to the left.
 * The width is for every message (see lib/mail/bubble-width). A
 * double-click puts the default back.
 */
export function BubbleWidthHandle({
  own,
  zoom = 1,
  boxRef,
  columnRef,
}: {
  own: boolean;
  zoom?: number;
  /** The message's box: the edge the reader sees and drags. */
  boxRef: React.RefObject<HTMLElement | null>;
  /** The message's column: the widest it may be now. */
  columnRef: React.RefObject<HTMLElement | null>;
}) {
  const t = useMailT();
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    const column = columnRef.current;
    if (!box || !column || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    /*
      Two starting points, so the drag answers at once either way. Inward,
      from the edge the reader holds: the message narrows as the pointer
      moves. Outward, from the widest a message may be now: every message
      with room grows at once. Measured from the limit alone, a message
      narrower than its limit did nothing until the pointer had crossed the
      gap between its edge and the limit (Ulrik, 2026-10-11). A message laid
      out at a width of its own does not grow; the others do.
      In the box's own pixels: the stream is zoomed, the pointer is not.
    */
    const fromEdge = box.getBoundingClientRect().width / (zoom || 1);
    /*
      In the Reader a dragged width is the message's own width (mail.css),
      so the drag goes from the edge both ways: from the limit, the
      message jumped out to it at the first move.
    */
    const inReader = Boolean(box.closest("[data-thread-full-window]"));
    const fromLimit = inReader ? fromEdge : column.getBoundingClientRect().width / (zoom || 1);
    let last = fromLimit;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / (zoom || 1);
      const outward = own ? -dx : dx;
      last = Math.max(MIN_BUBBLE_WIDTH, outward >= 0 ? fromLimit + outward : fromEdge + outward);
      showBubbleWidth(last, own ? "left" : "right");
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      saveBubbleWidth(last, own ? "left" : "right");
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("messageWidthHandle")}
      title={t("messageWidthHandle")}
      onPointerDown={onPointerDown}
      onDoubleClick={(e) => {
        e.stopPropagation();
        saveBubbleWidth(null);
      }}
      className={cn(
        // The area to grab is a little wider than the line it shows.
        "group/edge absolute bottom-2 top-2 z-10 flex w-2.5 touch-none justify-center",
        "cursor-col-resize",
        // Across the edge, so the line sits on it, not beside it.
        own ? "-left-1.5" : "-right-1.5"
      )}
    >
      {/* Shown only with the pointer on the edge itself. A band on the
          whole message was in the way of reading it (Ulrik, 2026-10-10). */}
      <span
        aria-hidden
        className="h-full w-[3px] rounded-full bg-stone-400/80 opacity-0 transition-opacity group-hover/edge:opacity-100"
      />
    </div>
  );
}
