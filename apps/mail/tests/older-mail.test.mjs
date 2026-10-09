/**
 * "Older mail": a search shows what the copy holds at once, and what only
 * the server can find below it, under its own heading.
 *
 * The copy holds the headers of every message but the body only for the
 * last 12 months, so a word deep in an older mail is not in it. After the
 * local search, the list asks Gmail over IMAP (`mail_sync_search_older` in
 * the crate) for matches older than that window. Here the crate is faked
 * at the edge, as the store is, and these are checked:
 *
 * - the local results come first, and the search does not wait for the
 *   server to give them;
 * - the older results go below them, newest first, with no thread twice;
 * - an Outlook mailbox is not asked, since its copy holds every body;
 * - offline, or with a server search that fails, the local results stand
 *   alone, with no toast;
 * - a search the reader left is stopped, and its answer is not used.
 *
 * mounted-older-mail.test.mjs checks the heading on the page.
 *
 * Every address, name and sentence here is invented. See AGENTS.md.
 */

import { invalidateMailCaches, listUnifiedInbox } from "@/lib/mail/inbox";
import { forgetSyncStates } from "@/lib/mail/local-store";
import { olderMailBelow, olderSearchKey } from "@/lib/mail/older-mail-merge";
import { searchOlderMail } from "@/lib/mail/older-search";
import { toastSink } from "sonner";
import { handleStandaloneMailApi } from "../src/standalone-api";
import { fakeMailStore, GMAIL, OUTLOOK, OWNER } from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

const DAY = 24 * 3600 * 1000;
const NOW = Date.UTC(2026, 9, 7, 9, 0);

/** A thread as the copy hands it over, `messages.search` and the crate alike. */
function stored(threadId, subject, lastAt, snippet) {
  const from = { name: "Tove Tang", email: "tove@example.net" };
  return {
    account: GMAIL,
    threadId,
    subject,
    lastAt,
    messageCount: 1,
    unread: false,
    hasAttachments: false,
    starred: false,
    isDraft: false,
    labels: [],
    latest: {
      messageId: `${threadId}m1`,
      fromName: from.name,
      fromEmail: from.email,
      to: [{ name: "", email: GMAIL }],
      snippet,
      sentAt: lastAt,
      unread: false,
    },
    participants: [from],
    senders: [from],
    focusMessageId: `${threadId}m1`,
  };
}

const RECENT = stored("recent", "Seed swap at the allotment", NOW - 7 * DAY, "Bring the bean seeds on Saturday.");
// Found by the server only: the words are deep in the body.
const OLD = stored("old", "Notes from the shed", NOW - 500 * DAY, "The list of what grew well.");
const OLDEST = stored("oldest", "Spring plans", NOW - 1200 * DAY, "Plot nine needs a new fence.");

const live = { account: GMAIL, folder: "", phase: "live", fullSyncDone: 9000, fullSyncTotal: 9000, lastOkAt: NOW };
const paused = { ...live, phase: "paused", lastError: "Network is unreachable (os error 51) — reconnecting" };

/**
 * The crate at the edge: the store and the two commands. `server` says how
 * `mail_sync_search_older` answers: a list, an error, or a promise to hold.
 */
function fakeCrate({ state, server }) {
  fakeMailStore();
  const inner = globalThis.window.__TAURI__.core.invoke;
  const asked = [];
  const cancelled = [];
  globalThis.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === "mail_store_call" && args.op === "sync.list") return [state];
    if (cmd === "mail_store_call" && args.op === "messages.search") return { threads: [RECENT], handled: true };
    if (cmd === "mail_sync_search_older") {
      asked.push(args);
      return server();
    }
    if (cmd === "mail_sync_search_older_cancel") {
      cancelled.push(args.account);
      return null;
    }
    return inner(cmd, args);
  };
  forgetSyncStates();
  invalidateMailCaches();
  return { asked, cancelled };
}

const subjects = (threads) => threads.map((t) => t.subject).join(" | ");

suite(async () => {
  const network = [];
  globalThis.fetch = async (url) => {
    network.push(String(url));
    throw new TypeError("fetch failed");
  };
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);

  // ---- Online: local first, older below ------------------------------------
  let crate = fakeCrate({ state: live, server: () => ({ threads: [OLD, RECENT, OLDEST], handled: true }) });
  const local = await listUnifiedInbox({ clerkUserId: OWNER, account: GMAIL, q: "seed swap", fresh: true });
  check("the local search answers from the copy", subjects(local.threads) === RECENT.subject, subjects(local.threads));
  check("and does not wait for the server to do it", crate.asked.length === 0, JSON.stringify(crate.asked));

  const older = await searchOlderMail({ clerkUserId: OWNER, q: "seed swap" });
  check(
    "the server is asked once, for the Gmail mailbox, with the words as typed",
    crate.asked.length === 1 && crate.asked[0].account === GMAIL && crate.asked[0].query === "seed swap",
    JSON.stringify(crate.asked)
  );
  check("an Outlook mailbox is not asked: its copy holds every body", !crate.asked.some((a) => a.account === OUTLOOK));
  check("no request goes to the Gmail API", !network.some((u) => u.includes("googleapis.com")), network.join(" "));
  check("every mailbox answered", older.missed === null, older.missed);

  const below = olderMailBelow(local.threads, older.threads);
  check("a thread the local search found is not shown again", !below.some((t) => t.threadId === "recent"), subjects(below));
  check("the older threads are newest first", subjects(below) === `${OLD.subject} | ${OLDEST.subject}`, subjects(below));
  const screen = [...local.threads, ...below].map((t) => t.threadId);
  check("on screen: the local results, then the older ones", screen.join(",") === "recent,old,oldest", screen.join(","));
  check(
    "an older row opens on the message that matched",
    below[0].focusMessageId === "oldm1" && below[0].lastAt === new Date(OLD.lastAt).toISOString(),
    JSON.stringify(below[0])
  );
  check("a thread the server names twice shows once", olderMailBelow([], [...older.threads, ...older.threads]).length === 3);

  // ---- The route the list calls --------------------------------------------
  const res = await handleStandaloneMailApi(`/api/mail/threads/older?q=${encodeURIComponent("seed swap")}&account=${GMAIL}`);
  const body = await res.json();
  check(
    "the route answers with the older threads",
    res.status === 200 && body.success && body.threads.length === 3 && body.missed === null,
    `${res.status} ${JSON.stringify(body).slice(0, 160)}`
  );
  const askedBefore = crate.asked.length;
  const outlookOnly = await (await handleStandaloneMailApi(`/api/mail/threads/older?q=seed&account=${OUTLOOK}`)).json();
  check(
    "the route keeps to the mailbox it was given",
    crate.asked.length === askedBefore && outlookOnly.threads.length === 0,
    JSON.stringify(crate.asked.slice(askedBefore))
  );

  // ---- Offline: local only --------------------------------------------------
  crate = fakeCrate({ state: paused, server: () => ({ threads: [OLD], handled: true }) });
  const offlineLocal = await listUnifiedInbox({ clerkUserId: OWNER, account: GMAIL, q: "seed swap", fresh: true });
  const offline = await searchOlderMail({ clerkUserId: OWNER, account: GMAIL, q: "seed swap" });
  check("offline, the local results still come from the copy", subjects(offlineLocal.threads) === RECENT.subject);
  check("offline, the server is not asked", crate.asked.length === 0, JSON.stringify(crate.asked));
  check("and the list is told why there is no older mail", offline.missed === "offline" && offline.threads.length === 0);

  crate = fakeCrate({ state: live, server: () => ({ threads: [OLD], handled: true }) });
  Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
  const noNetwork = await searchOlderMail({ clerkUserId: OWNER, account: GMAIL, q: "seed swap" });
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true });
  check(
    "a machine with no network is offline before the worker notices",
    noNetwork.missed === "offline" && crate.asked.length === 0,
    `${noNetwork.missed} ${crate.asked.length}`
  );

  // ---- A failed server search: local only ----------------------------------
  crate = fakeCrate({
    state: live,
    server: () => {
      throw new Error("Connection reset by peer (os error 54)");
    },
  });
  const failedLocal = await listUnifiedInbox({ clerkUserId: OWNER, account: GMAIL, q: "seed swap", fresh: true });
  const failed = await searchOlderMail({ clerkUserId: OWNER, account: GMAIL, q: "seed swap" });
  check("a failed server search leaves the local results", subjects(failedLocal.threads) === RECENT.subject);
  check("it gives no older threads, and says it failed", failed.missed === "failed" && failed.threads.length === 0);
  const failedRoute = await (await handleStandaloneMailApi(`/api/mail/threads/older?q=seed&account=${GMAIL}`)).json();
  check("the route answers, not throws", failedRoute.success === true && failedRoute.missed === "failed", JSON.stringify(failedRoute));
  check("no toast for any of it", toasts.length === 0, JSON.stringify(toasts));

  // ---- A copy still on its first read --------------------------------------
  crate = fakeCrate({ state: { ...live, phase: "full", fullSyncDone: 400 }, server: () => ({ threads: [OLD] }) });
  const filling = await searchOlderMail({ clerkUserId: OWNER, account: GMAIL, q: "seed" });
  check(
    "a copy still on its first read is not searched past: it holds no older rows yet",
    crate.asked.length === 0 && filling.missed === null && filling.threads.length === 0
  );

  // ---- A search the reader left --------------------------------------------
  let release;
  crate = fakeCrate({ state: live, server: () => new Promise((resolve) => (release = resolve)) });
  const controller = new AbortController();
  const pending = searchOlderMail({ clerkUserId: OWNER, account: GMAIL, q: "seed", signal: controller.signal });
  await new Promise((r) => setTimeout(r, 20));
  controller.abort();
  release({ threads: [OLD], handled: true });
  const left = await pending;
  check("a search the reader left is cancelled in the crate", crate.cancelled.join() === GMAIL, crate.cancelled.join());
  check("and its answer is not used", left.threads.length === 0, subjects(left.threads));

  crate = fakeCrate({ state: live, server: () => ({ threads: [OLD], handled: true, superseded: true }) });
  const superseded = await searchOlderMail({ clerkUserId: OWNER, account: GMAIL, q: "seed" });
  check("an answer for a search a newer one replaced is not used", superseded.threads.length === 0);

  // A mailbox hidden on a schedule and shown again while the words stand:
  // the search must run again, for the mailbox that came back.
  const before = olderSearchKey("seed", undefined, ["ana@kollektiv.example"]);
  const after = olderSearchKey("seed", undefined, ["ana@kollektiv.example", "bo@kollektiv.example"]);
  check("a mailbox shown again during a search asks the server again", before !== after);
  check(
    "the same mailboxes in another order do not",
    olderSearchKey("seed", undefined, ["b@x.example", "a@x.example"]) ===
      olderSearchKey("seed", undefined, ["A@x.example", "b@x.example"])
  );
  check("no words, no search", olderSearchKey("", undefined, ["a@x.example"]) === "");
});
