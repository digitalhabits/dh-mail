/**
 * Archive and Trash on a Gmail mailbox, through the inbox core.
 *
 * Each asks Gmail to do it, and then takes the thread out of the list page
 * stored for the next poll. archive-forgets-stored-row checks that step
 * alone; this checks that the actions take it, which nothing did before the
 * inbox core was split into modules. The full cache clear empties the
 * stored pages too.
 *
 * The mailboxes and threads are the invented ones in fake-mail.mjs.
 */

import { archiveMailThread, invalidateMailCaches, trashMailThread } from "@/lib/mail/inbox";
import { fakeMailProviders, fakeMailStore, GMAIL, OWNER } from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

/** A stored inbox page for the Gmail mailbox, and a record of each save. */
function withStoredPage() {
  const inner = globalThis.window.__TAURI__.core.invoke;
  const saved = [];
  globalThis.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === "mail_store_call" && args.op === "listSync.load") {
      return {
        [GMAIL]: {
          rows: [{ threadId: "g1" }, { threadId: "g2" }],
          historyId: "7",
          nextPageToken: null,
        },
      };
    }
    if (cmd === "mail_store_call" && args.op === "listSync.save") {
      saved.push(args.args);
      return null;
    }
    return inner(cmd, args);
  };
  return saved;
}

suite(async () => {
  fakeMailStore();
  let { requests } = fakeMailProviders();
  let saved = withStoredPage();

  await archiveMailThread(GMAIL, "g1", OWNER);
  const modify = requests.find((r) => r.url.includes("/threads/g1/modify"));
  check(
    "archive asks Gmail to take the thread out of the inbox",
    modify && modify.body?.removeLabelIds?.includes("INBOX"),
    modify ? JSON.stringify(modify.body) : "no request"
  );
  check(
    "and the stored page is saved without it",
    saved.length === 1 &&
      saved[0].entry.rows.map((r) => r.threadId).join(",") === "g2" &&
      saved[0].entry.historyId === "7",
    JSON.stringify(saved.map((s) => s.entry.rows))
  );

  ({ requests } = fakeMailProviders());
  saved = withStoredPage();
  await trashMailThread(GMAIL, "g2", OWNER);
  check(
    "trash asks Gmail to trash the thread",
    requests.some((r) => r.url.includes("/threads/g2/trash")),
    requests.map((r) => r.url.replace(/^.*\/users\/me\//, "")).join(" ")
  );
  check(
    "and the stored page is saved without it",
    saved.length === 1 && saved[0].entry.rows.map((r) => r.threadId).join(",") === "g1",
    JSON.stringify(saved.map((s) => s.entry.rows))
  );

  const { calls } = fakeMailStore();
  invalidateMailCaches();
  await new Promise((r) => setTimeout(r, 0));
  check(
    "the full cache clear empties the stored pages",
    calls.some((c) => c.op === "listSync.clear"),
    calls.map((c) => c.op).join(" ")
  );
});
