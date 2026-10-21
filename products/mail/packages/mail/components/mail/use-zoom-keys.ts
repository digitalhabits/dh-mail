"use client";

/**
 * Cmd/Ctrl+Plus and Cmd/Ctrl+Minus in a window of its own: a popped-out
 * conversation, person or draft. They step the text size the window's +/−
 * controls set, as they do in the main window when a thread is open
 * (use-mail-window-keys.ts).
 *
 * The main window's key handler is not in these windows, so without this
 * the keys did nothing there. A key pressed inside a message arrives here
 * too: the message's frame passes its keys on to the window.
 */

import * as React from "react";

import { nextZoomStop } from "@/components/mail/use-mail-layout";
import { zoomKeyDirection } from "@/lib/mail/zoom-keys";

export function useZoomKeys(zoom: number, adjustZoom: (delta: number) => void): void {
  const zoomRef = React.useRef(zoom);
  React.useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const direction = zoomKeyDirection(e);
      if (direction == null) return;
      // Without this the web view zooms the whole window instead.
      e.preventDefault();
      // To the next round size, not a tenth on from where a pinch stopped.
      adjustZoom(nextZoomStop(zoomRef.current, direction) - zoomRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [adjustZoom]);
}
