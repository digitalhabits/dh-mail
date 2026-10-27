"use client";

/**
 * Puts snoozed threads back into a paused inbox when their time comes.
 *
 * The rules, and why a snooze is stronger than a pause, are in
 * lib/mail/snooze-wake-paused. This reads the paused mailboxes' snoozes from
 * the local copy, waits for the next one to wake, and adds the woken rows to
 * the list on screen. Nothing new is fetched: the list itself is not read
 * again until the pause ends.
 */

import * as React from "react";

import { patchCachedThreads } from "@/components/mail/mail-list-state";
import { mailApiJson } from "@/lib/mail/api";
import { MAIL_LAST_LIVE_READ_KEY } from "@/lib/mail/storage-keys";
import { mailPauseVerdictForAccount, type MailPauseState } from "@/lib/mail/quiet-hours";
import {
  nextWakeWhilePaused,
  PAUSED_SNOOZE_REREAD_MS,
  wakeLookbackFrom,
  wokenWhilePaused,
  withWokenRows,
} from "@/lib/mail/snooze-wake-paused";
import { threadKey } from "@/lib/mail/thread-copies";
import { readLastLiveReads } from "@/lib/mail/pause-cut-off";
import type { MailThreadSummary } from "@/lib/mail/types";

/** These mailboxes' inboxes were just read from the provider, not paused. */
export function noteLiveRead(emails: readonly string[]): void {
  if (!emails.length) return;
  const reads = readLastLiveReads();
  const now = Date.now();
  for (const email of emails) reads[email.toLowerCase()] = now;
  try {
    window.localStorage.setItem(MAIL_LAST_LIVE_READ_KEY, JSON.stringify(reads));
  } catch {
    /* private mode: only the snoozes that wake while the app is open come back */
  }
}

/** The list is the inbox: not a folder, not a search. */
export function showsInbox(
  search: string,
  activeFolder: { role?: string } | null,
  folder: string
): boolean {
  if (search) return false;
  return activeFolder ? activeFolder.role === "inbox" : folder === "inbox";
}

/** A list read landed: the one mailbox it asked, or all that are live. */
export function noteListRead(read: {
  inbox: boolean;
  snoozedView: boolean;
  account: string | null;
  emails: readonly string[];
}): void {
  if (!read.inbox || read.snoozedView) return;
  noteLiveRead(read.account ? [read.account] : read.emails);
}

/**
 * The earliest last live read of these mailboxes. The list on screen was read
 * then, so a snooze that woke after it is not in it. Null when never noted.
 */
function lastLiveRead(emails: readonly string[]): number | null {
  const reads = readLastLiveReads();
  const times = emails.map((e) => reads[e.toLowerCase()]).filter((t): t is number => typeof t === "number");
  return times.length ? Math.min(...times) : null;
}

export function usePausedSnoozeWakes({
  inboxShown,
  listEmails,
  pauseState,
  setThreads,
  viewerId,
  listCacheKey,
}: {
  /** The inbox is the list on screen: not a folder, not a search. */
  inboxShown: boolean;
  listEmails: string[];
  pauseState: MailPauseState;
  setThreads: React.Dispatch<React.SetStateAction<MailThreadSummary[]>>;
  viewerId: string;
  listCacheKey: string;
}) {
  const emailsKey = listEmails.join("|");
  React.useEffect(() => {
    if (!inboxShown) return;
    const paused = () =>
      listEmails.filter((email) => mailPauseVerdictForAccount(pauseState, email, new Date()).paused);
    if (!paused().length) return;

    let live = true;
    let timer = 0;
    let snoozed: MailThreadSummary[] = [];

    const wake = () => {
      const woken = wokenWhilePaused(snoozed, paused(), Date.now());
      if (!woken.length) return;
      const keys = new Set(woken.map(threadKey));
      snoozed = snoozed.filter((row) => !keys.has(threadKey(row)));
      setThreads((current) => {
        const next = withWokenRows(current, woken);
        if (next !== current) patchCachedThreads(viewerId, listCacheKey, next);
        return next;
      });
    };

    const schedule = () => {
      window.clearTimeout(timer);
      const now = Date.now();
      const next = nextWakeWhilePaused(snoozed, paused(), now);
      const wait = Math.min(PAUSED_SNOOZE_REREAD_MS, next === null ? Infinity : Math.max(0, next - now));
      timer = window.setTimeout(() => void tick(), wait);
    };

    const tick = async () => {
      if (!live) return;
      // A pause that has ended hands the list back to its own reads.
      if (!paused().length) return;
      wake();
      try {
        // Back to the last live read: a snooze that woke since then, while
        // the app was closed, is missing from the list on screen too. Never
        // further: one that woke before it was in that list, and the reader
        // may have archived it since.
        const since = wakeLookbackFrom(lastLiveRead(paused()), Date.now());
        const params = new URLSearchParams();
        params.set("since", new Date(since).toISOString());
        const answer = await mailApiJson<{ threads?: MailThreadSummary[] }>(`/api/mail/snoozed?${params.toString()}`);
        if (!live) return;
        snoozed = Array.isArray(answer?.threads) ? answer.threads : [];
      } catch {
        /* the rows from the last read stand in */
      }
      if (!live) return;
      wake();
      schedule();
    };

    void tick();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
    // listEmails is read through its key: a new array of the same mailboxes
    // is not a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxShown, emailsKey, pauseState, setThreads, viewerId, listCacheKey]);
}
