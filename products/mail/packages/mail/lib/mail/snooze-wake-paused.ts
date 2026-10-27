/**
 * Snoozed mail that wakes while its mailbox is paused.
 *
 * A pause holds back the mail that comes in: the inbox holds what it held
 * (quiet-hours.ts). A snooze is something else: the reader's own appointment
 * with mail they have already seen. Its wake brings nothing new, so it is
 * not what a pause is for, and a reader who snoozed letters until the
 * morning meant to have them in the morning, paused or not (2026-10-23).
 *
 * So while a mailbox is paused, the list is not read again. Only the threads
 * whose snooze has ended are put back into it, from the local copy. The sync
 * worker goes on filling that copy during a pause, so reading the whole list
 * again would let in the new mail the pause holds back.
 *
 * No React here: the rules are the part a suite reads.
 */

import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

/** How often the snoozes are read again while paused: new ones, moved ones. */
export const PAUSED_SNOOZE_REREAD_MS = 5 * 60_000;

/**
 * How far back to look for snoozes that woke while the app was closed.
 *
 * Back to the mailboxes' last live read when it is known: the list on
 * screen was read then. When it is not (the mailbox was paused at every
 * read since this was first noted), a day: a snooze that woke overnight or
 * this morning comes back on time. Asking only for the snoozes still
 * asleep left those out, and they came in only when the pause ended
 * (a tester, 2026-10-26).
 */
export const UNKNOWN_LIVE_READ_LOOKBACK_MS = 24 * 60 * 60_000;

export function wakeLookbackFrom(lastLiveRead: number | null, now: number): number {
  return lastLiveRead ?? now - UNKNOWN_LIVE_READ_LOOKBACK_MS;
}

/** The snoozed rows of these mailboxes whose time has come, as inbox rows. */
export function wokenWhilePaused(
  snoozed: readonly MailThreadSummary[],
  pausedEmails: readonly string[],
  now: number
): MailThreadSummary[] {
  const paused = new Set(pausedEmails.map((e) => e.toLowerCase()));
  return snoozed
    .filter((row) => paused.has(row.account.toLowerCase()))
    .filter((row) => row.snoozedUntil && Date.parse(row.snoozedUntil) <= now)
    .map(({ snoozedUntil, ...row }) => {
      void snoozedUntil;
      return row;
    });
}

/** When the next of these mailboxes' snoozes wakes, or null. */
export function nextWakeWhilePaused(
  snoozed: readonly MailThreadSummary[],
  pausedEmails: readonly string[],
  now: number
): number | null {
  const paused = new Set(pausedEmails.map((e) => e.toLowerCase()));
  let next: number | null = null;
  for (const row of snoozed) {
    if (!paused.has(row.account.toLowerCase()) || !row.snoozedUntil) continue;
    const at = Date.parse(row.snoozedUntil);
    if (Number.isFinite(at) && at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/**
 * The list with the woken rows in it, each where its newest message puts it.
 * A row the list already has is left as it is. The same list when nothing
 * is new, so a caller can tell nothing changed.
 */
export function withWokenRows(
  list: readonly MailThreadSummary[],
  woken: readonly MailThreadSummary[]
): MailThreadSummary[] {
  const have = new Set(list.map(threadKey));
  const add = woken.filter((row) => !have.has(threadKey(row)));
  if (!add.length) return list as MailThreadSummary[];
  const next = [...list];
  for (const row of add) {
    const at = Date.parse(row.lastAt);
    const index = next.findIndex((t) => Date.parse(t.lastAt) < at);
    if (index < 0) next.push(row);
    else next.splice(index, 0, row);
  }
  return next;
}
