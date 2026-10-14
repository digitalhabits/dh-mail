"use client";

/**
 * The Reader's edges, dragged to make its column wider or narrower, as a
 * bubble's edges are in the thread (bubble-width-handle).
 *
 * The column stands in the middle, so a drag on either edge moves both:
 * the width changes by twice the drag. It is kept in this browser
 * (lib/mail/reader-settings), so the next message opens as wide. A
 * double-click on an edge puts the usual width back.
 */

import * as React from "react";

import { READER_WIDTH_DEFAULT, READER_WIDTH_MIN } from "@/lib/mail/reader-settings";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/** Room kept between the column and the window's edges, on screen. */
const WINDOW_MARGIN = 48;

export function ReaderWidthHandles({
  width,
  zoom,
  onWidth,
}: {
  width: number;
  zoom: number;
  onWidth: (next: number) => void;
}) {
  const t = useMailT();
  const z = zoom || 1;
  const start = (side: "left" | "right") => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const pointer = e.pointerId;
    try {
      handle.setPointerCapture(pointer);
    } catch {
      // The window still hears the release.
    }
    const x0 = e.clientX;
    const w0 = width;
    const max = Math.max(READER_WIDTH_MIN, (window.innerWidth - WINDOW_MARGIN * 2) / z);
    const move = (ev: PointerEvent) => {
      if (ev.buttons === 0) return end();
      const dx = (ev.clientX - x0) * (side === "right" ? 1 : -1);
      onWidth(Math.min(max, Math.max(READER_WIDTH_MIN, w0 + (2 * dx) / z)));
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      try {
        handle.releasePointerCapture(pointer);
      } catch {
        // Already released.
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  const handle = (side: "left" | "right") => (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("resizeReaderWidth")}
      title={t("resizeReaderWidth")}
      data-reader-width-handle={side}
      onPointerDown={start(side)}
      onDoubleClick={() => onWidth(READER_WIDTH_DEFAULT)}
      className={cn(
        "group absolute inset-y-0 z-10 flex w-4 cursor-col-resize touch-none justify-center",
        // On the bubble's edge: the column's padding is 1.5rem.
        side === "left" ? "left-6 -translate-x-1/2" : "right-6 translate-x-1/2"
      )}
    >
      <span className="h-full w-0.5 rounded-full bg-transparent transition-colors group-hover:bg-[var(--mail-thread-chrome-line)] group-active:bg-teal-600/50" />
    </div>
  );
  return (
    <>
      {handle("left")}
      {handle("right")}
    </>
  );
}
