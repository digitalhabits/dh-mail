"use client";

/**
 * The window's own colour follows the page.
 *
 * A desktop window has a colour under its web views. It shows before the
 * first paint at launch, and for a few frames each time the window grows.
 * The shell cannot know what theme the page is in — the pick lives in
 * localStorage, and each tab has a theme of its own — so the page reads the
 * colour it paints at its edge and tells the shell. The shell keeps it for
 * the next launch. See `backdrop.rs` in mail-native.
 *
 * In a browser there is no shell, and this does nothing.
 */

import * as React from "react";

import { solidHex } from "@/lib/mail/solid-hex";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): Invoke | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } };
  return w.__TAURI__?.core?.invoke ?? null;
}

/** The first solid background at a point, from the top element down to `<html>`. */
function paintedColorAt(x: number, y: number): string | null {
  let el: Element | null = document.elementFromPoint(x, y);
  while (el) {
    const hex = solidHex(getComputedStyle(el).backgroundColor);
    if (hex) return hex;
    el = el.parentElement;
  }
  return null;
}

/**
 * Keep the window's colour the same as the page's edge.
 *
 * `key` is anything that changes when the page can look different: the
 * path in the planner, the colour mode in the mail app.
 */
export function useWindowBackdrop(key: unknown): void {
  const sent = React.useRef<string | null>(null);
  React.useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    const timers: number[] = [];
    const read = () => {
      // The bottom right corner: the part of the window that a grow
      // uncovers, and clear of the navigation rail and the title strip.
      const color = paintedColorAt(window.innerWidth - 2, window.innerHeight - 2);
      if (!color || color === sent.current) return;
      sent.current = color;
      void invoke("set_window_backdrop", { color }).catch(() => {
        // An older shell has no such command. Ask again next time.
        sent.current = null;
      });
    };
    // Now, and again once the change is on screen: a theme event comes
    // before React paints what it changed.
    const readSoon = () => {
      read();
      timers.push(window.setTimeout(read, 150), window.setTimeout(read, 1200));
    };
    readSoon();
    // A theme is an attribute: `data-plan-theme` on <html>, `data-theme` on
    // the mail and To-Do shells.
    const observer = new MutationObserver(readSoon);
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ["data-theme", "data-plan-theme"],
    });
    return () => {
      observer.disconnect();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [key]);
}
