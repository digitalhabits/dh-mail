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
    asked.push({ folder: url.searchParams.get("folder") ?? "inbox", account: url.searchParams.get("account") });
  }
  return new Response(JSON.stringify({ success: true, threads: [], nextCursor: null }), {
    headers: { "Content-Type": "application/json" },
  });
});

function List({ folder, accounts, pauseState, noneFetching }) {
  useThreadListData({
    viewerId: "viewer",
    pageSnapKey: `snap-${folder}`,
    initialList: null,
    accountCount: accounts.length,
    accountEmails: accounts,
    mailboxScopeEmails: [],
    folder,
    activeFolder: null,
    debouncedSearch: "",
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
}

walk().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
