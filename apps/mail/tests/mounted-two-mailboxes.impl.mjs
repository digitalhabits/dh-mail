/**
 * The walk itself — see mounted-two-mailboxes.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ULLA = "ulla@aavang.example";
const TEA = "tea@aavang.example";
const row = (account, threadId, subject, lastAt) => ({
  account,
  threadId,
  subject,
  fromName: "Merle Mikkelsen",
  fromEmail: "merle@sangkor.example",
  snippet: subject,
  lastAt,
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Merle Mikkelsen", email: "merle@sangkor.example" }],
});
const ROWS = {
  [ULLA]: [row(ULLA, "u1", "Choir practice moves to Thursday", "2026-08-20T09:00:00.000Z")],
  [TEA]: [row(TEA, "t1", "Cakes for the choir evening", "2026-08-19T09:00:00.000Z")],
};

/** Mailboxes whose list fails, and every list read, by mailbox. */
const failing = new Set();
const reads = [];
/** How long each folder's answer takes, by folder. */
const delayMs = {};
const SENT_ROW = row(ULLA, "s1", "Re: the hall booking", "2026-08-18T09:00:00.000Z");
setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (p === "/api/mail/threads") {
    const account = url.searchParams.get("account") ?? "(all)";
    const folder = url.searchParams.get("folder") ?? "inbox";
    reads.push(account);
    if (delayMs[folder]) await sleep(delayMs[folder]);
    if (failing.has(account)) return json({ error: "The mailbox did not answer" }, 500);
    if (folder === "sent") return json({ threads: [SENT_ROW], nextCursor: null });
    // Asked for no one mailbox, it answers for all; the list keeps the
    // mailboxes it has.
    return json({ threads: account === "(all)" ? Object.values(ROWS).flat() : (ROWS[account] ?? []), nextCursor: null });
  }
  if (p === "/api/mail/snoozed") return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
  return json({});
});

const clickEl = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
};
const text = () => document.body.textContent || "";
// The notice over the list, as the app words it (mailboxUnreadable).
const UNREADABLE = (email) => `${email} could not be read`;
const byLabel = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.getAttribute("aria-label") || ""));

let mounts = 0;
async function mount(accounts) {
  mounts += 1;
  window.localStorage.clear();
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement(MailPage, { accounts, // Each mount its own viewer, so no mount finds another's cached list.
      viewerId: `viewer-${mounts}`, ownAddresses: accounts }));
  await sleep(900);
  return root;
}

async function main() {
  try {
    let root = await mount([ULLA, TEA]);
    assert(reads.includes(ULLA) && reads.includes(TEA), `each mailbox is asked on its own: ${reads.join(", ")}`);
    assert(text().includes("Choir practice moves to Thursday"), "Ulla's row is listed");
    assert(text().includes("Cakes for the choir evening"), "and Tea's");
    pass("with two mailboxes, each is asked on its own, and the rows of both are listed");

    failing.add(TEA);
    clickEl(byLabel(/^Sync/));
    await sleep(900);
    assert(text().includes("Choir practice moves to Thursday"), "Ulla's row stays");
    assert(text().includes(UNREADABLE(TEA)), `the list names the mailbox that failed: ${text().slice(0, 400)}`);
    assert(!text().includes(UNREADABLE(ULLA)), "and only that one");
    pass("when one mailbox fails, the list names it and keeps the other's rows");
    failing.clear();

    // Back to a view read before: its cached rows show at once, while the
    // new answer is still on its way.
    const view = (name) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === name);
    clickEl(view("Sent"));
    await sleep(700);
    assert(text().includes("Re: the hall booking"), "Sent shows its row");
    delayMs.inbox = 600;
    clickEl(view("Inbox"));
    await sleep(150);
    assert(text().includes("Choir practice moves to Thursday"), "back in the inbox, its cached rows show before the answer lands");
    await sleep(800);
    pass("back in a view read before, its cached rows show while it is read again");

    // An answer for a view the reader has left does not land in the one
    // they are in.
    delayMs.inbox = 700;
    clickEl(byLabel(/^Sync/));
    await sleep(100);
    delayMs.inbox = 0;
    clickEl(view("Sent"));
    await sleep(1200);
    assert(text().includes("Re: the hall booking"), "Sent shows its row");
    assert(!text().includes("Choir practice moves to Thursday"), "and the inbox's late answer does not land in it");
    pass("a late answer for a view the reader has left does not land in the one they are in");
    root.unmount();

    // The same with one mailbox, where the list is one read, not one per
    // mailbox.
    delayMs.inbox = 0;
    root = await mount([ULLA]);
    const oneView = (name) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === name);
    assert(text().includes("Choir practice moves to Thursday"), "one mailbox: the inbox row is listed");
    delayMs.inbox = 700;
    clickEl(byLabel(/^Sync/));
    await sleep(100);
    delayMs.inbox = 0;
    clickEl(oneView("Sent"));
    await sleep(1200);
    assert(text().includes("Re: the hall booking"), "one mailbox: Sent shows its row");
    assert(!text().includes("Choir practice moves to Thursday"), "one mailbox: the inbox's late answer does not land in Sent");
    pass("with one mailbox too, a late answer does not land in the view the reader moved to");
    root.unmount();

    failing.clear();
    failing.add(ULLA);
    failing.add("(all)");
    root = await mount([ULLA]);
    assert(/did not answer|Couldn.t load/i.test(text()), `the list says the read failed: ${text().slice(0, 400)}`);
    pass("with one mailbox that fails on the first read, the list says so");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the two mailboxes walk failed:", err);
    process.exit(1);
  }
}

void main();
