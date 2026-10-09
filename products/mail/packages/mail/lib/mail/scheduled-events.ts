"use client";

/**
 * "Something being held has changed."
 *
 * The thread knows when a scheduled message is cancelled, sent, or taken back
 * into the composer. The group at the top of the list shows the same messages
 * and is nowhere near it, and a slow refresh is not good enough: a row that
 * survives the click that cancelled it says the click did nothing.
 *
 * An event rather than a prop threaded down, because the two are in different
 * parts of the page and neither owns the other.
 */

export const MAIL_SCHEDULED_CHANGED = "redd-plan-mail-scheduled-changed";

export function notifyScheduledChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MAIL_SCHEDULED_CHANGED));
}

export function onScheduledChanged(listener: () => void): () => void {
  window.addEventListener(MAIL_SCHEDULED_CHANGED, listener);
  return () => window.removeEventListener(MAIL_SCHEDULED_CHANGED, listener);
}
