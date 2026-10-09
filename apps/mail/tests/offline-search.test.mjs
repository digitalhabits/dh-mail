/**
 * Mail with no network: a search finds what the copy on disk holds.
 *
 * Offline, every sync worker pauses its mailbox ("paused", with the
 * network error). The gate that decides whether the copy answers used to
 * take a pause for "no copy", so a search went to Gmail, which could not
 * be reached, and nothing was found. Here the network refuses every
 * request, the mailbox is paused after a finished first read, and the
 * search must come back from the copy without a single request getting
 * through.
 *
 * An Outlook mailbox reads the copy too once its first read is through,
 * so the same holds for it, for a search and for the plain inbox.
 *
 * Every address and sentence here is invented. See AGENTS.md.
 */

import { invalidateMailCaches, listUnifiedInbox } from "@/lib/mail/inbox";
import { forgetSyncStates } from "@/lib/mail/local-store";
import { fakeMailStore, GMAIL, OUTLOOK, OWNER } from "./fake-mail.mjs";
import { check, suite } from "./harness.mjs";

const AT = Date.UTC(2026, 8, 30, 9, 0);

/** One thread in the copy, as `messages.search` hands it over. */
const stored = {
  account: GMAIL,
  threadId: "c1",
  subject: "Rooftop garden plan",
  lastAt: AT,
  messageCount: 1,
  unread: false,
  hasAttachments: false,
  starred: false,
  isDraft: false,
  labels: ["INBOX"],
  latest: {
    messageId: "c1m1",
    fromName: "Alma Aagaard",
    fromEmail: "alma@example.org",
    to: [{ name: "", email: GMAIL }],
    snippet: "The rooftop garden plan is attached.",
    sentAt: AT,
    unread: false,
  },
  participants: [{ name: "Alma Aagaard", email: "alma@example.org" }],
  senders: [{ name: "Alma Aagaard", email: "alma@example.org" }],
};

/** The worker's row for the mailbox after the network went away. */
const pausedOffline = {
  account: GMAIL,
  folder: "",
  phase: "paused",
  fullSyncDone: 4685,
  fullSyncTotal: 4685,
  lastOkAt: AT,
  lastError: "Can't assign requested address (os error 49) — reconnecting",
};

suite(async () => {
  fakeMailStore();
  const inner = globalThis.window.__TAURI__.core.invoke;
  const searches = [];
  globalThis.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === "mail_store_call" && args.op === "sync.list") return [pausedOffline];
    if (cmd === "mail_store_call" && args.op === "messages.search") {
      searches.push(args.args);
      return { threads: [stored], handled: true };
    }
    return inner(cmd, args);
  };
  // No network at all: every request fails the way fetch fails offline.
  const network = [];
  globalThis.fetch = async (url) => {
    network.push(String(url));
    throw new TypeError("fetch failed");
  };
  forgetSyncStates();
  invalidateMailCaches();

  const found = await listUnifiedInbox({ clerkUserId: OWNER, account: GMAIL, q: "rooftop", fresh: true });

  check("the search asks the copy", searches.length === 1 && searches[0].q === "rooftop", JSON.stringify(searches));
  check(
    "and finds the thread on disk",
    found.threads.some((t) => t.subject === "Rooftop garden plan"),
    found.threads.map((t) => t.subject).join(" | ")
  );
  check("with no request to Gmail", !network.some((u) => u.includes("googleapis.com")), network.join(" "));

  // ---- Outlook, read to the end, then offline --------------------------------
  const onOutlook = { ...stored, account: OUTLOOK, threadId: "oc1", subject: "Allotment rota" };
  const outlookPaused = { ...pausedOffline, account: OUTLOOK };
  const lists = [];
  searches.length = 0;
  network.length = 0;
  globalThis.window.__TAURI__.core.invoke = async (cmd, args) => {
    if (cmd === "mail_store_call" && args.op === "sync.list") return [outlookPaused];
    if (cmd === "mail_store_call" && args.op === "messages.search") {
      searches.push(args.args);
      return { threads: [onOutlook], handled: true };
    }
    if (cmd === "mail_store_call" && args.op === "messages.list") {
      lists.push(args.args);
      return { threads: [onOutlook], nextBefore: null };
    }
    return inner(cmd, args);
  };
  forgetSyncStates();
  invalidateMailCaches();

  const outlookFound = await listUnifiedInbox({ clerkUserId: OWNER, account: OUTLOOK, q: "allotment", fresh: true });
  check("an Outlook search asks the copy", searches.length === 1 && searches[0].accounts[0] === OUTLOOK, JSON.stringify(searches));
  check(
    "and finds the thread on disk",
    outlookFound.threads.some((t) => t.subject === "Allotment rota"),
    outlookFound.threads.map((t) => t.subject).join(" | ")
  );

  invalidateMailCaches();
  const inbox = await listUnifiedInbox({ clerkUserId: OWNER, account: OUTLOOK, fresh: true });
  check("the Outlook inbox lists from the copy", lists.length === 1 && lists[0].view === "inbox", JSON.stringify(lists));
  check("with its thread", inbox.threads.some((t) => t.subject === "Allotment rota"), inbox.threads.map((t) => t.subject).join(" | "));
  check("and no request to Microsoft", !network.some((u) => u.includes("graph.microsoft.com") || u.includes("login.microsoftonline.com")), network.join(" "));
});
