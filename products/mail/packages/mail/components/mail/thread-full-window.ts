"use client";

/**
 * The thread over the whole window: the thread pane itself, with the same
 * bubbles, day headings and reply bar, and a quiet bar on top in place of
 * the toolbar and the subject.
 *
 * It is not a second drawing of the thread (the Reader with every message),
 * because that reads as another app. The Reader is for one long message.
 * This is for the whole thread.
 *
 * The state outlives one thread pane: the pane is mounted again for each
 * thread, and stepping to a person's next thread (the arrows in the person
 * pill) keeps the full window. When no thread pane is left, after a moment
 * to let the next one mount, the window goes back to its usual view.
 */

import * as React from "react";

let on = false;
let panes = 0;
let offTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
  if (on === next) return;
  on = next;
  for (const listener of listeners) listener();
}

export function openThreadFullWindow() {
  set(true);
}

export function closeThreadFullWindow() {
  set(false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => on;

/** True while the thread fills the window. Counts this pane as one shown. */
export function useThreadFullWindow(active: boolean): boolean {
  React.useEffect(() => {
    if (!active) return;
    panes += 1;
    if (offTimer) clearTimeout(offTimer);
    offTimer = null;
    return () => {
      panes -= 1;
      if (panes > 0) return;
      offTimer = setTimeout(() => {
        offTimer = null;
        if (panes === 0) set(false);
      }, 0);
    };
  }, [active]);
  const shown = React.useSyncExternalStore(subscribe, read, () => false);
  return active && shown;
}

/** A dialog, a menu or the Reader over the thread, which has Esc first. */
function somethingOver(): boolean {
  return Boolean(
    document.querySelector(
      '[data-mail-reader], [role="dialog"][data-state="open"], [role="menu"], [role="alertdialog"]'
    )
  );
}

function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

/**
 * Esc leaves the full window. Not while the composer is open, while
 * something is typed in, or while a dialog, a menu or the Reader is over
 * the thread: Esc is theirs first.
 */
export function useThreadFullWindowEsc(shown: boolean, composerOpen: boolean) {
  React.useEffect(() => {
    if (!shown || composerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (typingIn(e.target) || somethingOver()) return;
      e.preventDefault();
      e.stopPropagation();
      closeThreadFullWindow();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [shown, composerOpen]);
}
