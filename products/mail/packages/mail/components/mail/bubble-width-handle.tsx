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
}: {
  own: boolean;
  zoom?: number;
  /**
   * The message's column, measured at the start of a drag: the width a
   * message may take now. Not the box, which a short message keeps narrow;
   * starting from it, a drag on a short message shrank every message.
   */
  boxRef: React.RefObject<HTMLElement | null>;
}) {
  const t = useMailT();
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = boxRef.current;
    if (!box || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    // In the box's own pixels: the stream is zoomed, the pointer is not.
    const start = box.getBoundingClientRect().width / (zoom || 1);
    let last = start;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / (zoom || 1);
      last = Math.max(MIN_BUBBLE_WIDTH, start + (own ? -dx : dx));
      showBubbleWidth(last);
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      saveBubbleWidth(last);
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
        "group/edge absolute bottom-2 top-2 z-10 flex w-2.5 cursor-col-resize touch-none justify-center",
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
