/**
 * Whether a long thread shows its outline rail: one tick a message down the
 * reader's right edge, opening into a list of every message under the
 * pointer (thread-outline.tsx).
 *
 * On unless the reader turns it off with the button in the thread's strip;
 * kept for the person, not for each thread. Like the other settings of the
 * window it lives in localStorage, and a change sends an event, so every
 * reader follows at once.
 */

import { THREAD_OUTLINE_KEY as KEY } from "@/lib/mail/storage-keys";
import * as React from "react";

const CHANGED_EVENT = "redd-plan-mail-thread-outline-changed";

export function readThreadOutline(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeThreadOutline(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, "0");
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

export function useThreadOutline(): boolean {
  return React.useSyncExternalStore(subscribe, readThreadOutline, () => true);
}
