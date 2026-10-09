"use client";

/**
 * Send, and the links under the box, held at the bottom of the reply band.
 *
 * The band scrolls when the reply is taller than it, and Send used to scroll
 * with it: at the end of a long reply it was below the edge, and the
 * recipient line stayed at the top instead. Now the recipient line scrolls
 * away and the row with Send on it, and the links under the card, stick to
 * the bottom edge (`position: sticky`, in ThreadComposerBand).
 *
 * Two things CSS cannot know are worked out here, on the column that
 * scrolls:
 * - `--composer-foot-h`, the height of the links under the card, which is
 *   where the Send row stops: it stands on top of them.
 * - the scroll padding at the bottom, so the caret, kept in view by the
 *   browser as you type, is not kept under the two of them.
 *
 * It also answers whether there is more of the reply below what is seen,
 * for the soft shadow above Send that says so.
 */

import * as React from "react";

export function useStickyComposerFoot(
  columnRef: React.RefObject<HTMLDivElement | null>,
  footRef: React.RefObject<HTMLDivElement | null>,
  sendBarRef: React.RefObject<HTMLDivElement | null>,
  /** Changes when the column is drawn again: the mode, the preview, focus. */
  key: string
): boolean {
  const [more, setMore] = React.useState(false);
  React.useEffect(() => {
    const column = columnRef.current;
    const foot = footRef.current;
    if (!column || !foot) return;
    const update = () => {
      const footH = foot.offsetHeight;
      const barH = sendBarRef.current?.offsetHeight ?? 0;
      column.style.setProperty("--composer-foot-h", `${footH}px`);
      column.style.scrollPaddingBottom = `${footH + barH}px`;
      setMore(column.scrollHeight - column.scrollTop - column.clientHeight > 1);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(column);
    for (const child of Array.from(column.children)) observer.observe(child);
    column.addEventListener("scroll", update, { passive: true });
    // Typing grows the card before any observer has a frame to say so.
    column.addEventListener("input", update);
    return () => {
      observer.disconnect();
      column.removeEventListener("scroll", update);
      column.removeEventListener("input", update);
    };
  }, [columnRef, footRef, sendBarRef, key]);
  return more;
}
