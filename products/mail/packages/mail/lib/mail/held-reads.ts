/**
 * Threads opened and read here, that the store has not been told of yet.
 *
 * Opening a thread tells the store it is read a few seconds later (see
 * use-row-opening): the thread opens on its first new message, and it can
 * only see which that is while the copy still says unread. In those
 * seconds a list can come back from the store, still saying unread, and
 * put the bold back on the row. The wait then takes that bold for the
 * reader's own "Mark as unread" and does not tell the store at all. The
 * thread then stays unread for good.
 *
 * So the row's key is held here until the store has been told. A list
 * that comes back meanwhile shows the row read (`withHeldReads`), and only
 * the reader's own Mark as unread lets go of it first (`releaseRead`).
 */

import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

const held = new Set<string>();

export function holdRead(keys: string[]): void {
  for (const key of keys) held.add(key);
}

/** Let go: the store has been told, or the reader marked it unread. */
export function releaseRead(keys: string[]): void {
  for (const key of keys) held.delete(key);
}

/** True while every one of these is still held. */
export function stillHeld(keys: string[]): boolean {
  return keys.length > 0 && keys.every((key) => held.has(key));
}

/** The list, with every held row read. The same array when none is. */
export function withHeldReads(rows: MailThreadSummary[]): MailThreadSummary[] {
  if (!held.size) return rows;
  let changed = false;
  const out = rows.map((row) => {
    if (!row.unread || !held.has(threadKey(row))) return row;
    changed = true;
    return { ...row, unread: false };
  });
  return changed ? out : rows;
}
