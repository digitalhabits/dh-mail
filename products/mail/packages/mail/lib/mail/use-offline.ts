"use client";

/**
 * Whether Mail is offline, and how many of the reader's changes wait to be
 * sent, for the one line the list shows then (OfflineLine.tsx).
 *
 * Two signals. The browser's own (`navigator.onLine`, and the window's
 * `online` and `offline` events) is quick, but says "online" on a network
 * that reaches no server. So Mail is also offline when every mailbox's sync
 * has stopped on a network error.
 *
 * The count is the store's action queue (`pending_actions`), across every
 * mailbox: read, archive, trash, a move. Each one is already in the copy,
 * and goes to the server when the server answers (docs/mail-local-store.md,
 * section 7).
 */

import * as React from "react";

import { forgetSyncStates, SYNC_CHANGED_WINDOW_EVENT, SYNC_STATE_WINDOW_EVENT, syncStates } from "@/lib/mail/local-store";
import { mailStore } from "@/lib/mail/store";
import type { MailSyncState } from "@/lib/mail/store/types";
import { syncPauseKind } from "@/lib/mail/sync-pause";

/** "browser": the computer has no network. "servers": no mail server answers. */
export type OfflineKind = "browser" | "servers" | null;

/** True when every mailbox's own row has stopped on a network error. */
export function everyMailboxUnreachable(states: readonly MailSyncState[]): boolean {
  const mailboxes = states.filter((s) => s.folder === "");
  return mailboxes.length > 0 && mailboxes.every((s) => s.phase === "paused" && syncPauseKind(s.lastError) === "offline");
}

/** How many changes wait to be sent, across these mailboxes. */
export async function countWaitingChanges(accounts: readonly string[]): Promise<number> {
  let total = 0;
  for (const account of new Set(accounts.map((a) => a.toLowerCase()))) {
    try {
      total += (await mailStore().actions.pending(account)).length;
    } catch {
      // A host with no queue has nothing waiting.
    }
  }
  return total;
}

/** Read again this often while offline or while changes wait; else less. */
const BUSY_MS = 5_000;
const QUIET_MS = 30_000;

export function useOffline(): { offline: OfflineKind; waiting: number } {
  const [browserOnline, setBrowserOnline] = React.useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [unreachable, setUnreachable] = React.useState(false);
  const [waiting, setWaiting] = React.useState(0);
  const busy = !browserOnline || unreachable || waiting > 0;

  React.useEffect(() => {
    let cancelled = false;
    const read = () => {
      setBrowserOnline(typeof navigator === "undefined" || navigator.onLine !== false);
      void (async () => {
        forgetSyncStates();
        const states = await syncStates();
        const count = await countWaitingChanges(states.map((s) => s.account));
        if (cancelled) return;
        setUnreachable(everyMailboxUnreachable(states));
        setWaiting(count);
      })().catch(() => undefined);
    };
    read();
    // An action queued or sent changes the copy; a worker's state says
    // when a mailbox stops or goes on. The Gmail worker says both from
    // Rust, not on the window, so the timer covers it.
    const events = ["online", "offline", "focus", SYNC_CHANGED_WINDOW_EVENT, SYNC_STATE_WINDOW_EVENT];
    for (const name of events) window.addEventListener(name, read);
    const timer = window.setInterval(read, busy ? BUSY_MS : QUIET_MS);
    return () => {
      cancelled = true;
      for (const name of events) window.removeEventListener(name, read);
      window.clearInterval(timer);
    };
  }, [busy]);

  const offline: OfflineKind = !browserOnline ? "browser" : unreachable ? "servers" : null;
  return { offline, waiting };
}
