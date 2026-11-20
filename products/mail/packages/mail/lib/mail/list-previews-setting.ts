/**
 * Whether the mail list shows a line of each conversation under its subject.
 *
 * Off unless the reader turns it on (Settings > General), as Gmail's list
 * reads: who, what about, when. The opening words of every message are a
 * pull to read them all from the list; the subject is enough to choose.
 * Calendar invites and attachments keep their marks either way.
 *
 * Kept in localStorage like the other settings of the window; a change
 * sends an event, so the list follows at once.
 */

import { LIST_PREVIEWS_KEY as KEY } from "@/lib/mail/storage-keys";
import * as React from "react";

const CHANGED_EVENT = "redd-plan-mail-list-previews-changed";

export function readShowListPreviews(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeShowListPreviews(show: boolean): void {
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

export function useShowListPreviews(): boolean {
  return React.useSyncExternalStore(subscribe, readShowListPreviews, () => false);
}
