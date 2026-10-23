"use client";

/**
 * Whether more of the reply is below what the box shows.
 *
 * The reply card is a fixed frame: its border never scrolls, and Send is the
 * row at its foot. Only the letter inside it scrolls (`.mail-composer-scroll`).
 * When the letter runs on below the frame, a soft shadow above Send says so.
 *
 * Until 2026-10-23 the card scrolled inside the band, and Send was a sticky
 * row that drew the card's foot over the letter. At a fractional zoom WebKit
 * drew those borders on half pixels, pale or not at all, as soon as the row
 * began to stick. A border that does not move cannot land on a half pixel.
 *
 * The answer changes no state while a key press is being handled. A
 * listener for `input` here runs before React reads the same event, and a
 * state change at that moment draws the composer again first: a controlled
 * box (To, Cc, the subject) then gets its old text back, and React sees no
 * change, so the letter is lost. So typing is answered a frame later.
 */

import * as React from "react";

export function useComposerMoreBelow(
  scrollerRef: React.RefObject<HTMLElement | null>,
  /** Changes when the box is drawn again: the mode, the preview, focus. */
  key: string
): boolean {
  const [more, setMore] = React.useState(false);
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const report = () =>
      setMore(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(scroller);
    for (const child of Array.from(scroller.children)) observer.observe(child);
    scroller.addEventListener("scroll", report, { passive: true });
    let frame = 0;
    const onInput = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          report();
        });
      }
    };
    scroller.addEventListener("input", onInput);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", report);
      scroller.removeEventListener("input", onInput);
    };
  }, [scrollerRef, key]);
  return more;
}
