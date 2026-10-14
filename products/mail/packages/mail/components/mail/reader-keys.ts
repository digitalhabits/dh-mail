"use client";

/**
 * The keys while the Reader is open, and the composer's place in it. Used
 * by MessageReader. See reader-composer for how the composer gets in.
 */

import * as React from "react";

import type { ReaderComposerSlot } from "@/components/mail/reader-composer";

/** The elements Tab can reach inside `root`, in the order they stand. */
function tabStops(root: HTMLElement): HTMLElement[] {
  const all = root.querySelectorAll<HTMLElement>(
    [
      "button:not([disabled])",
      "a[href]",
      "input:not([disabled]):not([type='hidden']):not([type='file'])",
      "textarea:not([disabled])",
      "[contenteditable='true']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(", ")
  );
  // Not what is out of sight: a composer's hidden preview, a folded row.
  return [...all].filter((el) => !el.closest("[hidden], .hidden"));
}

/** Move the focus one stop on inside the Reader. */
function moveFocus(root: HTMLElement, back: boolean): boolean {
  const stops = tabStops(root);
  if (!stops.length) return false;
  const at = stops.indexOf(document.activeElement as HTMLElement);
  const next = back ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length;
  stops[next].focus();
  return true;
}

/** A menu or a list of suggestions is open: Esc is for it. */
function popupOpen(): boolean {
  return Boolean(
    document.querySelector('[data-radix-popper-content-wrapper], [role="menu"], [role="listbox"]')
  );
}

/** What the keys need to know about the composer in the Reader. */
type ReaderComposerKeys = {
  /** The composer stands in the Reader now. */
  here: boolean;
  host: HTMLElement | null;
  /** Put the composer away. The draft stays. */
  putAway: () => void;
};

/**
 * Esc and Tab from inside the composer, after the composer had its turn.
 *
 * The composer's own parts use these keys first: a list of suggestions
 * closes on Esc, a suggestion is picked with Tab. Only a key that nothing
 * used comes back here. It is read on the way back up, as the last
 * listener on the window.
 */
function afterComposer(event: KeyboardEvent, root: HTMLElement, putAway: () => void) {
  const popup = event.key === "Escape" && popupOpen();
  const after = (later: KeyboardEvent) => {
    window.removeEventListener("keydown", after);
    if (later !== event || later.defaultPrevented) return;
    if (later.key === "Escape") {
      if (popup) return;
      later.preventDefault();
      putAway();
      return;
    }
    if (moveFocus(root, later.shiftKey)) later.preventDefault();
  };
  window.addEventListener("keydown", after);
  // A key stopped on its way does not come back. Do not wait for the next one.
  window.setTimeout(() => window.removeEventListener("keydown", after), 0);
}

/**
 * Keys while the Reader is open: Esc closes it, Tab stays inside it, and no
 * key reaches the app's shortcuts for the thread under it.
 *
 * The composer in the Reader is the exception. Its keys go to it as they
 * do in the thread: Cmd+Enter sends, and the letters go in the box. Esc
 * from the composer puts it away and keeps the draft. A dialog or a menu
 * that the composer opens over the Reader keeps its keys too.
 */
export function useReaderKeys(
  rootRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
  composer: ReaderComposerKeys
) {
  const closeRef = React.useRef(onClose);
  const composerRef = React.useRef(composer);
  React.useLayoutEffect(() => {
    closeRef.current = onClose;
    composerRef.current = composer;
  });
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = rootRef.current;
      const active = document.activeElement;
      const { here, host, putAway } = composerRef.current;
      if (root && here && host?.contains(active)) {
        if (event.key === "Escape" || event.key === "Tab") afterComposer(event, root, putAway);
        return;
      }
      // Over the Reader, not in it: a dialog, a menu, the floating card.
      if (root && active && active !== document.body && !root.contains(active)) return;
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        if (here) putAway();
        else closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      if (moveFocus(root, event.shiftKey)) event.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [rootRef]);
}

/**
 * The composer's place in the Reader, and what Reply and Forward do there.
 *
 * Esc puts the composer away: the band goes back to the thread under the
 * Reader, with the words in it, and the focus goes to Back.
 */
export function useReaderComposerPlace(
  composer: ReaderComposerSlot | null | undefined,
  backRef: React.RefObject<HTMLButtonElement | null>
) {
  const here = Boolean(composer?.shown && composer.open);
  const setShown = composer?.setShown;
  const putAway = React.useCallback(() => {
    setShown?.(false);
    backRef.current?.focus({ preventScroll: true });
  }, [setShown, backRef]);
  // The Reader goes: the composer goes back to the thread with it.
  React.useEffect(() => () => setShown?.(false), [setShown]);
  return { here, putAway, host: composer?.host ?? null };
}
