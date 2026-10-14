/**
 * Whether the folder rail shows a count beside each folder.
 *
 * Off unless the reader turns it on (Settings > General). A number beside
 * every folder is one more thing waiting to be brought to zero, which is
 * the pressure this app is meant to take away (Ulrik, 2026-10-14). The
 * Outbox keeps its count either way: mail that has not gone out yet is
 * something to know, not a score.
 *
 * Kept in localStorage like the other settings of the window; a change
 * sends an event, so the rail follows at once.
 */

import * as React from "react";

const KEY = "redd-plan-mail-folder-counts";
const CHANGED_EVENT = "redd-plan-mail-folder-counts-changed";

export function readShowFolderCounts(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowFolderCounts(show: boolean): void {
  try {
    if (show) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* private mode: the change is not kept */
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useShowFolderCounts(): boolean {
  return React.useSyncExternalStore(subscribe, readShowFolderCounts, () => false);
}
