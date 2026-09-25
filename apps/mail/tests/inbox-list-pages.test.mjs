/**
 * What the unified list asks Gmail, and what it keeps for the next poll.
 *
 * unified-inbox checks the rows the reader sees. This checks the three
 * things around them that no suite read before: the Gmail query (a search
 * carries the words; Trash asks for itself and for deleted mail), the page
 * kept after a first read (cached for a moment, and saved to the store per
 * Gmail mailbox), and a cold start (a stored page with a history position
 * makes the next poll ask Gmail what changed since then).
 *
 * The mailboxes and threads are the invented ones in fake-mail.mjs.
 */

import { invalidateMailCaches, listUnifiedInbox } from "@/lib/mail/inbox";
import { fakeMailProviders, fakeMailStore, GMAIL, OWNER } from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

const gmailCalls = (requests) =>
  requests.filter((r) => r.url.includes("gmail.googleapis.com/gmail/v1/users/me/"));
const queryOf = (url) => new URL(url).searchParams.get("q") ?? "";

suite(async () => {
  // ---- The query -------------------------------------------------------------
  fakeMailStore();
  let { requests } = fakeMailProviders();
  invalidateMailCaches();
  await listUnifiedInbox({ clerkUserId: OWNER, fresh: true, q: "plums" });
  const searched = gmailCalls(requests).find((r) => queryOf(r.url).includes("plums"));
  check("a search asks Gmail for the words", Boolean(searched),
    gmailCalls(requests).map((r) => queryOf(r.url)).join(" | "));

  ({ requests } = fakeMailProviders());
  invalidateMailCaches();
  await listUnifiedInbox({ clerkUserId: OWNER, fresh: true, folder: "trash" });
  const trash = gmailCalls(requests).find((r) => queryOf(r.url).includes("in:trash"));
  check("Trash asks Gmail for Trash", Boolean(trash),
    gmailCalls(requests).map((r) => queryOf(r.url)).join(" | "));
  check("and for deleted mail with it",
    trash && new URL(trash.url).searchParams.get("includeSpamTrash") === "true",
    trash?.url);

  // ---- The page kept after a first read --------------------------------------
  const { calls } = fakeMailStore();
  ({ requests } = fakeMailProviders());
  invalidateMailCaches();
  await listUnifiedInbox({ clerkUserId: OWNER });
  const saves = calls.filter((c) => c.op === "listSync.save" && c.args.account === GMAIL);
  check("the Gmail mailbox's page is saved for the next poll",
    saves.length === 1 && saves[0].args.entry.rows.length > 0,
    saves.map((s) => s.args.entry.rows.map((r) => r.threadId).join(",")).join(" / ") || "no save");
  const before = requests.length;
  await listUnifiedInbox({ clerkUserId: OWNER });
  check("and the page is cached: a second read at once asks no provider",
    requests.length === before, `${requests.length - before} more requests`);

  // ---- A cold start ------------------------------------------------------------
  fakeMailStore();
  ({ requests } = fakeMailProviders());
  invalidateMailCaches();
  const inner = globalThis.window.__TAURI__.core.invoke;
  globalThis.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === "mail_store_call" && args.op === "listSync.load") {
      return {
        [GMAIL]: {
          rows: [
            {
              threadId: "g1",
              listSnippet: "stored",
              summary: { account: GMAIL, threadId: "g1", subject: "Stored", fromName: "", fromEmail: "", snippet: "stored", lastAt: "2026-08-01T00:00:00.000Z", unread: false, messageCount: 1, tab: "other", externalParticipants: [] },
              latestRfcId: "<g1@example.test>",
            },
          ],
          historyId: "90",
          nextPageToken: null,
        },
      };
    }
    return inner(cmd, args);
  };
  await listUnifiedInbox({ clerkUserId: OWNER, incremental: true });
  const history = gmailCalls(requests).find((r) => r.url.includes("/history"));
  check("a cold poll starts from the stored page: it asks Gmail what changed",
    history && new URL(history.url).searchParams.get("startHistoryId") === "90",
    history?.url ?? gmailCalls(requests).map((r) => r.url.replace(/^.*users\/me\//, "")).join(" "));
});
