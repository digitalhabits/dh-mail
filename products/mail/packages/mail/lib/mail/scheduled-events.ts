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

import type { MailScheduledMessage } from "@/lib/mail/types";

export const MAIL_SCHEDULED_CHANGED = "redd-plan-mail-scheduled-changed";

export function notifyScheduledChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MAIL_SCHEDULED_CHANGED));
}

export function onScheduledChanged(listener: () => void): () => void {
  window.addEventListener(MAIL_SCHEDULED_CHANGED, listener);
  return () => window.removeEventListener(MAIL_SCHEDULED_CHANGED, listener);
}

// ---------------------------------------------------------------------------
// A message scheduled a moment ago, during its few seconds of Undo. Nothing
// has been scheduled yet, but the reader has said it, so the row stands at
// the top of the list straight away. It goes on Undo or a failure, and gives
// way to the real row once the schedule is written and the list has read it.
// ---------------------------------------------------------------------------


const PENDING_PREFIX = "pending:";
type Replaced = { account: string; id: string };
const pending = new Map<string, { message: MailScheduledMessage; settled: boolean; replaces?: Replaced }>();
let pendingCount = 0;

export function isPendingScheduledId(id: string): boolean {
  return id.startsWith(PENDING_PREFIX);
}

/**
 * Show the row now. Answers its id, for `settlePendingScheduled` or
 * `dropPendingScheduled`. An edit of a scheduled message names the one it
 * replaces, which is kept out of the list meanwhile: the two side by side
 * read as two messages going (lib/mail/scheduled-replace).
 */
export function showPendingScheduled(message: Omit<MailScheduledMessage, "id">, replaces?: Replaced | null): string {
  pendingCount += 1;
  const id = `${PENDING_PREFIX}${pendingCount}`;
  pending.set(id, { message: { ...message, id }, settled: false, ...(replaces ? { replaces } : null) });
  notifyScheduledChanged();
  return id;
}

/** Undo, or the schedule failed: the row goes now. */
export function dropPendingScheduled(id: string): void {
  if (pending.delete(id)) notifyScheduledChanged();
}

/** Scheduled: the row goes once the list has read the real one. */
export function settlePendingScheduled(id: string): void {
  const entry = pending.get(id);
  if (entry) entry.settled = true;
  notifyScheduledChanged();
}

/** The rows to show; `afterLoad` lets the settled ones go. */
export function pendingScheduled(afterLoad = false): MailScheduledMessage[] {
  if (afterLoad) for (const [id, entry] of pending) if (entry.settled) pending.delete(id);
  return [...pending.values()].map((entry) => entry.message);
}

/** True for a scheduled message that a row still in its Undo seconds replaces. */
export function isBeingReplaced(message: { account: string; id: string }): boolean {
  const account = message.account.trim().toLowerCase();
  for (const entry of pending.values()) {
    if (entry.replaces?.id === message.id && entry.replaces.account.trim().toLowerCase() === account) return true;
  }
  return false;
}
