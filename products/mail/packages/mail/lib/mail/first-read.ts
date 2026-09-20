/**
 * The first read of a mailbox, as the list says it.
 *
 * The first read of a big mailbox takes hours, across many sittings. The list
 * used to show its bar only for the phase "full". A pause put a notice in the
 * place of the bar, a stop put nothing there, and a narrow list hid all of it.
 * A reader saw the bar go away and took the read for finished, or for broken.
 *
 * The rule now: while the first read is not finished, a line stays up in every
 * state, with the count, and says which state it is. The line goes away only
 * when the read is complete. This module decides that from the sync states
 * alone, so a test can give it the rows the store holds.
 *
 * How "not finished" is known:
 *
 * - The phase is "full": a worker reads now.
 * - The row holds a count, and the count is short of the total. Both workers
 *   keep the count through a pause and a stop, and both end a read with the
 *   count equal to the total.
 * - A folder of the mailbox has the phase "reading": the Outlook worker keeps
 *   its place in a folder under that phase until the folder is finished.
 */

import { syncPauseKind } from "@/lib/mail/sync-pause";
import type { MailSyncState } from "@/lib/mail/store/types";

/**
 * - "reading": a worker reads now.
 * - "waiting": the last try failed, and the worker tries again by itself.
 * - "offline": as "waiting", and the reason is that the server did not answer.
 * - "signIn": the worker cannot continue until the reader signs in again.
 * - "stopped": no worker reads, and none is due to try.
 */
export type FirstReadState = "reading" | "waiting" | "offline" | "signIn" | "stopped";

export type FirstReadLine = {
  account: string;
  folder: string;
  state: FirstReadState;
  done: number;
  /** At least 1, and never less than `done`. */
  total: number;
  /** The worker's own words for a read that is not running, for whoever is asked. */
  reason: string | null;
};

function sameAccount(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function countIsShort(state: MailSyncState): boolean {
  return state.fullSyncTotal != null && (state.fullSyncDone ?? 0) < state.fullSyncTotal;
}

/** Whether this row is a first read that is not complete. */
export function firstReadUnfinished(state: MailSyncState, all: MailSyncState[]): boolean {
  if (state.phase === "live" || state.phase === "reading") return false;
  if (state.phase === "full") return true;
  if (countIsShort(state)) return true;
  // The mailbox's own row answers for its folders.
  if (state.folder !== "") return false;
  return all.some((s) => s.folder !== "" && s.phase === "reading" && sameAccount(s.account, state.account));
}

function stateOf(row: MailSyncState): FirstReadState {
  if (row.phase === "full") return "reading";
  if (row.phase !== "paused") return "stopped";
  const kind = syncPauseKind(row.lastError);
  if (kind === "signIn") return "signIn";
  return kind === "offline" ? "offline" : "waiting";
}

/** One line for each first read that is not complete, in the order given. */
export function firstReadLines(states: MailSyncState[]): FirstReadLine[] {
  return states
    .filter((row) => firstReadUnfinished(row, states))
    .map((row) => {
      const done = Math.max(0, row.fullSyncDone ?? 0);
      const state = stateOf(row);
      return {
        account: row.account,
        folder: row.folder ?? "",
        state,
        done,
        total: Math.max(row.fullSyncTotal ?? 0, done, 1),
        reason: state === "reading" ? null : (row.lastError ?? null) || null,
      };
    });
}

/** A sync that paused on a mailbox whose first read is complete. The old notice is for these. */
export function pausedAfterFirstRead(states: MailSyncState[]): MailSyncState[] {
  return states.filter((row) => row.phase === "paused" && !firstReadUnfinished(row, states));
}
