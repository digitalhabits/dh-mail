/*
 * The Gmail list pages kept between polls, so the next poll can ask
 * Gmail only what changed: the rows of each page, and the history position
 * each was read at. The list writes them; archive and trash take a thread
 * out of them.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */


import "server-only";

import { mailStore } from "@/lib/mail/store";
import type { MailThreadSummary } from "@/lib/mail/types";
import { registerMailFullCacheClear } from "@/lib/mail/inbox-cache";

/** Prior Gmail first-page rows for list-diff polls (survives fresh=1). */
export type GmailPriorRow = {
  /** Decoded snippet from the last threads.list response. */
  listSnippet: string;
  summary: MailThreadSummary;
  latestRfcId: string;
  latestReferences?: string;
};

export type GmailPriorPage = Map<string, Map<string, GmailPriorRow>>; // account → threadId → row
export const gmailPriorPages = new Map<string, GmailPriorPage>();
/**
 * State each prior first page was built at (cacheKey → account): the history
 * position lets the next incremental poll ask Gmail's history API "what
 * changed since?" instead of re-listing and diffing snippets, and the page
 * token re-emits the load-more cursor when the page is served unchanged.
 */
export type GmailPriorPageState = { historyId: string; nextPageToken?: string };
export const gmailPriorHistoryIds = new Map<string, Map<string, GmailPriorPageState>>();
/** Later of two numeric-string Gmail history ids (avoids BigInt). */
export function newerHistoryId(
  a: string | null,
  b: string | null | undefined
): string | null {
  if (!b || !/^\d+$/.test(b)) return a;
  if (!a) return b;
  if (b.length !== a.length) return b.length > a.length ? b : a;
  return b > a ? b : a;
}

/** The stored views a thread leaves when it leaves the inbox. */
const INBOX_LIKE_FOLDERS = ["inbox"] as const;
/**
 * Take a thread out of the page we stored, not only out of the caches.
 *
 * Archiving cleared the thirty-second memo and nothing else, so the row
 * survived in `gmailPriorPages` and in `list_sync_state`. That would be
 * harmless if every list came from a fresh listing, but the incremental path
 * has a branch that serves the stored page verbatim when Gmail's history
 * reports nothing changed — and that branch never asks Gmail what is in the
 * inbox. So an archived thread could come back on the next Sync, from our own
 * copy of a list that was already out of date.
 *
 * The history delta is not something to lean on here either: Gmail keeps
 * about a week of it, answers `incomplete` on a long gap, and 404s on an
 * expired id. Any of those leaves the delta empty while the stale row is
 * still stored.
 *
 * Best effort on purpose. Failing to tidy a cache must never fail the archive
 * that the provider has already accepted — and it is only called once the
 * provider has accepted it. A thread the provider refused to archive is still
 * in the inbox, and taking its row out here would hide a thread that is
 * really there, which is the worse of the two mistakes.
 */
export async function forgetThreadInStoredPages(
  clerkUserId: string,
  account: string,
  threadId: string
): Promise<void> {
  // In memory, from every view. A row taken out of a page it should not have
  // left costs one metadata fetch to put back; a row left in a page it should
  // have left is the bug this exists for.
  for (const byAccount of gmailPriorPages.values()) {
    byAccount.get(account)?.delete(threadId);
  }

  try {
    for (const folder of INBOX_LIKE_FOLDERS) {
      const stored = await mailStore().listSync.load(clerkUserId, folder, [
        account,
      ]);
      const entry = stored.get(account);
      if (!entry) continue;
      const rows = entry.rows.filter((row) => row.threadId !== threadId);
      if (rows.length === entry.rows.length) continue;
      await mailStore().listSync.save(clerkUserId, folder, account, {
        rows,
        historyId: entry.historyId,
        nextPageToken: entry.nextPageToken,
      });
    }
  } catch (err) {
    console.warn("[mail] could not drop the stored list row:", err);
  }
}

registerMailFullCacheClear(() => {
  gmailPriorPages.clear();
  gmailPriorHistoryIds.clear();
  void mailStore().listSync.clear();
});
