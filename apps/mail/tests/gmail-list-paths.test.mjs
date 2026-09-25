/**
 * How a poll of a Gmail mailbox (on the Gmail API path) reads its page.
 *
 * After a first read, the next poll asks Gmail's history what changed
 * since, and takes one of three paths:
 *
 * - nothing changed: the kept page is the answer, and Gmail is asked
 *   nothing more;
 * - some threads changed: the list is read again for its order, but only
 *   the changed threads are fetched;
 * - no history (expired, or an error): the list is read in full, with the
 *   unread ones asked for beside it, since a kept row cannot see a change
 *   of read state.
 *
 * The fake Gmail in fake-mail.mjs has no history; this suite answers it.
 */

import { invalidateMailCaches, listUnifiedInbox } from "@/lib/mail/inbox";
import { fakeMailProviders, fakeMailStore, OWNER } from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

/** What Gmail's history answers next: a body, or a status that is refused. */
let history = null;
let requests = [];
function providers() {
  ({ requests } = fakeMailProviders());
  const inner = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("gmail.googleapis.com/gmail/v1/users/me/history")) {
      requests.push({ url: String(url), method: "GET" });
      if (typeof history === "number") {
        return new Response(JSON.stringify({ error: { code: history } }), { status: history });
      }
      return new Response(JSON.stringify(history), { status: 200, headers: { "content-type": "application/json" } });
    }
    return inner(url, init);
  };
}

const path = (r) => r.url.replace(/^.*gmail\/v1\/users\/me\//, "").split("?")[0];
const gmail = () => requests.filter((r) => r.url.includes("gmail.googleapis.com/gmail/v1/users/me/")).map(path);
const threadFetches = () => gmail().filter((p) => /^threads\/[^/]+$/.test(p)).sort();
const listCalls = () => gmail().filter((p) => p === "threads");
// A conversation is one row, whichever mailbox's copy stands for it: g2
// has a copy in the Outlook mailbox too, and the copies share a time.
const conversations = (list) => list.threads.map((t) => t.tipId).sort();
const poll = () => listUnifiedInbox({ clerkUserId: OWNER, incremental: true, fresh: true });

suite(async () => {
  fakeMailStore();
  providers();
  invalidateMailCaches();
  const first = await poll();
  check("a first read lists the mailbox and fetches every thread", threadFetches().join() === "threads/g1,threads/g2,threads/g3", threadFetches().join());
  const rows = conversations(first);
  check("one row per conversation", new Set(rows).size === rows.length && rows.length === 4, rows.join());

  // ---- Nothing changed ---------------------------------------------------------
  history = { history: [], historyId: "101" };
  providers();
  const same = await poll();
  check("with nothing changed, Gmail is asked what changed", gmail().includes("history"), gmail().join(" "));
  check("and nothing more: no list, no thread", listCalls().length === 0 && threadFetches().length === 0, gmail().join(" "));
  check("and the rows are the kept page's conversations", conversations(same).join() === rows.join(), conversations(same).join());

  // ---- Some threads changed -----------------------------------------------------
  history = { history: [{ messagesAdded: [{ message: { threadId: "g1" } }] }], historyId: "102" };
  providers();
  const some = await poll();
  check("with one thread changed, the list is read again for its order", listCalls().length === 1, gmail().join(" "));
  check("and only that thread is fetched", threadFetches().join() === "threads/g1", threadFetches().join());
  check("and every conversation is still there", conversations(some).join() === rows.join(), conversations(some).join());

  // ---- No history -----------------------------------------------------------------
  history = 404;
  providers();
  const full = await poll();
  const unreadAsked = requests.some((r) => path(r) === "threads" && (new URL(r.url).searchParams.get("q") ?? "").includes("is:unread"));
  check("with no history, the list is read in full", listCalls().length >= 1, gmail().join(" "));
  check("and the unread ones are asked for beside it", unreadAsked, requests.map((r) => r.url.replace(/^.*users\/me\//, "")).join(" "));
  check("and every conversation is there", conversations(full).join() === rows.join(), conversations(full).join());
});
