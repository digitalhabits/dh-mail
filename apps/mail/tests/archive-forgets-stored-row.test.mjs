/**
 * Archiving takes the thread out of the page we stored, not only the caches.
 *
 * The bug this guards against: a thread archived in the app disappeared, was
 * archived in Gmail for real, and came back on the next Sync. Archiving
 * cleared the thirty-second memo and nothing else, so the row survived in
 * `list_sync_state` — and the incremental path has a branch that serves the
 * stored page verbatim when Gmail's history reports nothing changed, without
 * asking Gmail what is in the inbox at all.
 *
 * The store is the seam that can be tested without a network or a provider,
 * so that is what is checked here: after an archive, the mailbox's stored
 * page no longer holds the thread, and still holds the others.
 */

import { forgetThreadInStoredPages } from "@/lib/mail/inbox";
import { mailStore, setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

/**
 * Enough of a store to hold one page. The real one talks to SQLite through
 * the desktop shell, which a test has no way to reach — and the thing worth
 * checking is what the archive asks the store to do, not how it stores it.
 */
function fakeStore() {
  const pages = new Map();
  const key = (owner, folder, account) => `${owner}|${folder}|${account}`;
  const unavailable = (name) => () => {
    throw new Error(`the fake store has no ${name}`);
  };
  return {
    pages,
    listSync: {
      async load(owner, folder, accounts) {
        const out = new Map();
        for (const account of accounts) {
          const entry = pages.get(key(owner, folder, account));
          if (entry) out.set(account, entry);
        }
        return out;
      },
      async save(owner, folder, account, entry) {
        pages.set(key(owner, folder, account), {
          rows: entry.rows,
          historyId: entry.historyId ?? null,
          nextPageToken: entry.nextPageToken ?? null,
        });
      },
      async clear() {
        pages.clear();
      },
    },
    settings: { get: unavailable("settings"), set: unavailable("settings") },
  };
}

const OWNER = "test-owner";
const ACCOUNT = "someone@example.org";

function row(threadId) {
  return {
    threadId,
    listSnippet: `snippet for ${threadId}`,
    latestRfcId: `<${threadId}@example.org>`,
    summary: { account: ACCOUNT, threadId, subject: threadId },
  };
}

suite(async () => {
  const store = fakeStore();
  setMailStore(store);

  await mailStore().listSync.save(OWNER, "inbox", ACCOUNT, {
    rows: [row("keep-me"), row("archive-me"), row("keep-me-too")],
    historyId: "1000",
    nextPageToken: null,
  });

  // The tidy-up itself, which is what archive and trash call once the
  // provider has accepted. Not the whole archive: that needs a Gmail and a
  // token, and it is deliberate that a refused archive leaves the row alone —
  // the thread is still in the inbox, and hiding it would be the worse
  // mistake of the two.
  await forgetThreadInStoredPages(OWNER, ACCOUNT, "archive-me");

  const stored = await mailStore().listSync.load(OWNER, "inbox", [ACCOUNT]);
  const ids = (stored.get(ACCOUNT)?.rows ?? []).map((r) => r.threadId);

  check(
    "the archived thread is gone from the stored page",
    !ids.includes("archive-me"),
    ids.join(",")
  );
  check(
    "the other threads are still there",
    ids.includes("keep-me") && ids.includes("keep-me-too"),
    ids.join(",")
  );
});
