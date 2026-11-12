/**
 * The walk itself — see mounted-sent-while-paused.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { useThreadListData } from "@/components/mail/use-thread-list-data";
import { setMailApiTransport } from "@/lib/mail/api";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAUSED = "paused@mail.example";
const LIVE = "live@mail.example";
const HIDDEN = "hidden@mail.example";
const LATER = Date.now() + 60 * 60_000;

/** Every list request: the folder and the mailbox it asked. */
let asked = [];
setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost");
  // The hidden mailbox, as the providers list it.
  if (url.pathname === "/api/gmail/accounts") {
    return new Response(JSON.stringify({ accounts: [{ email: HIDDEN, inMailTab: false }, { email: LIVE, inMailTab: true }] }), {
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url.pathname === "/api/mail/threads") {
    asked.push({
      folder: url.searchParams.get("folder") ?? "inbox",
      account: url.searchParams.get("account"),
      q: url.searchParams.get("q"),
      includeHidden: url.searchParams.get("includeHidden") === "1",
    });
  }
  // The folder walk below: each folder answers with one row of its own, Junk slowly.
  let threads = [];
  if (url.pathname === "/api/mail/threads" && rowsByFolder) {
    const folder = url.searchParams.get("folder") ?? "inbox";
    if (folder === "junk") await sleep(250);
    threads = url.searchParams.get("account") === PAUSED ? (rowsByFolder[folder] ?? []) : [];
  }
  return new Response(JSON.stringify({ success: true, threads, nextCursor: null }), {
    headers: { "Content-Type": "application/json" },
  });
});

/** When set, the rows each folder answers with. */
let rowsByFolder = null;
const row = (id) => ({
  account: PAUSED,
  threadId: id,
  subject: id,
  fromName: "Ann",
  fromEmail: "ann@mail.example",
  snippet: "",
  lastAt: "2026-11-01T10:00:00.000Z",
  unread: false,
  messageCount: 1,
  tab: "other",
});

/** The rows on screen, as the hook last gave them. */
let shown = [];
function Walker({ folder, pauseState }) {
  const data = useThreadListData({
    viewerId: "walker",
    pageSnapKey: "snap-walk",
    initialList: null,
    // Two mailboxes: each is asked on its own, and its answer lands on its own.
    accountCount: 2,
    accountEmails: [PAUSED, LIVE],
    mailboxScopeEmails: [],
    folder,
    activeFolder: null,
    debouncedSearch: "",
    searchScopeKey: "",
    pauseState,
    noneFetching: true,
    mailSurfaceRef: { current: null },
    reconcileSelection: () => {},
  });
  shown = data.threads.map((t) => t.threadId);
  return null;
}

function List({ folder, accounts, pauseState, noneFetching, search = "" }) {
  useThreadListData({
    viewerId: "viewer",
    pageSnapKey: `snap-${folder}`,
    initialList: null,
    accountCount: accounts.length,
    accountEmails: accounts,
    mailboxScopeEmails: [],
    folder,
    activeFolder: null,
    debouncedSearch: search,
    searchScopeKey: "",
    pauseState,
    noneFetching,
    mailSurfaceRef: { current: null },
    reconcileSelection: () => {},
  });
  return null;
}

async function mount(props) {
  // The last mount's open does a second, fresh read after its first one:
  // let it land before this mount counts.
  await sleep(200);
  asked = [];
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(React.createElement(List, props));
  await sleep(150);
  root.unmount();
  host.remove();
  return asked;
}

const onePaused = { quietHours: [], accounts: { [PAUSED]: { pausedUntil: LATER } } };
const allPaused = { quietHours: [], pausedUntil: LATER };

async function walk() {
  // The inbox still skips the paused mailbox: the pause works as before.
  {
    const list = await mount({ folder: "inbox", accounts: [LIVE, PAUSED], pauseState: onePaused, noneFetching: false });
    assert.ok(list.some((r) => r.account === LIVE), "the inbox asks the live mailbox");
    assert.ok(!list.some((r) => r.account === PAUSED), "the inbox does not ask the paused mailbox");
    pass("the inbox skips a paused mailbox");
  }

  // Sent asks the paused mailbox too.
  {
    const list = await mount({ folder: "sent", accounts: [LIVE, PAUSED], pauseState: onePaused, noneFetching: false });
    assert.ok(list.every((r) => r.folder === "sent"), "every request is for Sent");
    assert.ok(list.some((r) => r.account === PAUSED), "Sent asks the paused mailbox");
    assert.ok(list.some((r) => r.account === LIVE), "Sent asks the live mailbox");
    pass("Sent asks a paused mailbox");
  }

  // Everything paused, one mailbox: the inbox asks nothing, Sent still asks.
  {
    const inbox = await mount({ folder: "inbox", accounts: [PAUSED], pauseState: allPaused, noneFetching: true });
    assert.equal(inbox.length, 0, "a fully paused inbox asks nothing");
    const sent = await mount({ folder: "sent", accounts: [PAUSED], pauseState: allPaused, noneFetching: true });
    // One mailbox is asked in one request, with no mailbox named.
    assert.ok(sent.length > 0, "Sent asks while all mail is paused");
    assert.ok(sent.every((r) => r.folder === "sent"), "and asks only for Sent");
    pass("Sent is fetched while all mail is paused");
  }

  // A hidden mailbox: Sent asks it, the inbox does not.
  {
    const inbox = await mount({ folder: "inbox", accounts: [LIVE], pauseState: { quietHours: [] }, noneFetching: false });
    assert.ok(!inbox.some((r) => r.account === HIDDEN), "the inbox does not ask the hidden mailbox");
    const sent = await mount({ folder: "sent", accounts: [LIVE], pauseState: { quietHours: [] }, noneFetching: false });
    assert.ok(sent.some((r) => r.account === HIDDEN), "Sent asks the hidden mailbox");
    assert.ok(sent.some((r) => r.account === LIVE), "and the shown one");
    pass("Sent asks a hidden mailbox, the inbox does not");
  }

  // A search reaches a paused mailbox: the reader is asking for mail they
  // know is there (2026-10-20).
  {
    const list = await mount({ folder: "inbox", accounts: [LIVE, PAUSED], pauseState: onePaused, noneFetching: false, search: "invoice" });
    assert.ok(list.some((r) => r.q === "invoice" && r.account === PAUSED), "a search asks the paused mailbox");
    const all = await mount({ folder: "inbox", accounts: [PAUSED], pauseState: allPaused, noneFetching: true, search: "invoice" });
    assert.ok(all.some((r) => r.q === "invoice"), "a search asks while all mail is paused");
    pass("a search reaches a paused mailbox");
  }

  // A walk through the folders of a paused mailbox. Each list shows its own
  // rows. The paused inbox is not read, and it must not keep the rows of
  // the list before it, nor take the rows of a load that lands late: after
  // Sent, the inbox and every folder showed the Sent rows (2026-11-12).
  {
    await sleep(200);
    rowsByFolder = { sent: [row("sent-1")], junk: [row("junk-1")], archived: [row("archived-1")], inbox: [row("inbox-new")] };
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const show = async (folder, wait) => {
      root.render(React.createElement(Walker, { folder, pauseState: allPaused }));
      await sleep(wait);
    };
    await show("sent", 300);
    assert.deepEqual(shown, ["sent-1"], "Sent shows the Sent rows");
    await show("archived", 300);
    assert.deepEqual(shown, ["archived-1"], "a folder is read in a pause, and shows its own rows");
    await show("inbox", 300);
    assert.deepEqual(shown, [], "the paused inbox is not read, and does not keep the folder's rows");
    // Junk answers slowly: the reader is back in the inbox before it lands.
    await show("junk", 50);
    await show("inbox", 500);
    assert.deepEqual(shown, [], "a folder's answer that lands late does not fill the inbox");
    root.unmount();
    host.remove();
    rowsByFolder = null;
    pass("each list of a paused mailbox shows its own rows");
  }

  // A search reaches a hidden mailbox, unless the reader turned that off.
  {
    localStorage.removeItem("mail-search-hidden-mailboxes");
    const on = await mount({ folder: "inbox", accounts: [LIVE], pauseState: { quietHours: [] }, noneFetching: false, search: "invoice" });
    assert.ok(on.some((r) => r.q === "invoice" && r.account === HIDDEN), "by default a search asks the hidden mailbox");
    localStorage.setItem("mail-search-hidden-mailboxes", "0");
    const off = await mount({ folder: "inbox", accounts: [LIVE], pauseState: { quietHours: [] }, noneFetching: false, search: "invoice" });
    assert.ok(!off.some((r) => r.account === HIDDEN), "turned off, it does not");
    assert.ok(!off.some((r) => r.includeHidden), "and does not ask the server for hidden mailboxes");
    localStorage.removeItem("mail-search-hidden-mailboxes");
    pass("a search reaches a hidden mailbox unless turned off");
  }
}

walk().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
