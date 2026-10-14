"use client";

/**
 * The reply card floats over the end of the thread, and the email can be
 * seen behind it. The thread keeps room at its end as tall as the card, so
 * the last lines can still be scrolled clear of it.
 *
 * The card's height goes on the thread pane as `--mail-composer-room`. The
 * thread's scroller pads its end by it, and the go-to-newest arrow stands
 * above it. When the card grows or shrinks while the thread is at its end,
 * the thread stays at its end, in the same frame (WebKit keeps no place at
 * the bottom by itself).
 */

import * as React from "react";

const ROOM = "--mail-composer-room";
/** Closer to the end than this is at the end. */
const AT_END = 24;

export function useComposerRoom(bandRef: React.RefObject<HTMLElement | null>, active: boolean) {
  React.useLayoutEffect(() => {
    const band = bandRef.current;
    if (!active || !band) return;
    const pane = band.closest<HTMLElement>(".mail-thread-surface");
    if (!pane) return;
    const scroller = pane.querySelector<HTMLElement>("[data-thread-scroller]");
    const place = () => {
      const atEnd = scroller
        ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < AT_END
        : false;
      pane.style.setProperty(ROOM, `${Math.ceil(band.getBoundingClientRect().height)}px`);
      if (scroller && atEnd) scroller.scrollTop = scroller.scrollHeight;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(band);
    return () => {
      observer.disconnect();
      pane.style.removeProperty(ROOM);
    };
  }, [bandRef, active]);
}
