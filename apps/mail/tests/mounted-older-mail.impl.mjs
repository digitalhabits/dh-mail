/**
 * The walk itself — see mounted-older-mail.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { toastSink } from "sonner";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ivo@haveby.example";
const row = (threadId, subject, lastAt, snippet) => ({
  account: ACCOUNT,
  threadId,
  subject,
  fromName: "Tove Tang",
  fromEmail: "tove@example.net",
  snippet,
  lastAt,
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Tove Tang", email: "tove@example.net" }],
});
const RECENT = row("recent", "Seed swap at the allotment", "2026-09-30T08:00:00.000Z", "Bring the bean seeds.");
const OLD = row("old", "Notes from the shed", "2025-05-25T08:00:00.000Z", "The list of what grew well.");
const INBOX = row("inbox", "Water rota for October", "2026-10-06T08:00:00.000Z", "Your turn is on Tuesday.");

/** How the older route answers next: rows, a miss, a failure, or a hold. */
let older = { mode: "rows" };
let release = () => {};
const olderAsked = [];

setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (p === "/api/mail/threads/older") {
    olderAsked.push(url.searchParams.get("q"));
    if (older.mode === "fail") return json({ error: "Older mail search failed" }, 500);
    if (older.mode === "offline") return json({ success: true, threads: [], missed: "offline" });
    if (older.mode === "hold") await new Promise((resolve) => (release = resolve));
    // The server finds the recent thread too; the list must not show it twice.
    return json({ success: true, threads: [OLD, RECENT], missed: null });
  }
  if (p === "/api/mail/threads") {
    return json({ threads: url.searchParams.get("q") ? [RECENT] : [INBOX], nextCursor: null });
  }
  if (p === "/api/mail/snoozed") return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
  return json({});
});

const text = () => document.body.textContent || "";
const count = (needle) => text().split(needle).length - 1;
const at = (needle) => text().indexOf(needle);
const search = (value) => {
  const box = document.querySelector('input[type="search"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(box, value);
  box.dispatchEvent(new window.Event("input", { bubbles: true }));
};

async function main() {
  const toasts = [];
  toastSink.push = (t) => toasts.push(t);
  let root;
  try {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(React.createElement(MailPage, { accounts: [ACCOUNT], viewerId: "older-viewer", ownAddresses: [ACCOUNT] }));
    await sleep(700);
    assert(text().includes(INBOX.subject), "the inbox is on screen");
    assert.equal(olderAsked.length, 0, "no older search without a search");
    pass("browsing asks for no older mail");

    older = { mode: "hold" };
    search("seed");
    await sleep(900);
    assert(text().includes(RECENT.subject), "the local result shows while the server searches");
    assert(text().includes("Searching older mail on the server…"), "with one line that says the server searches");
    assert.deepEqual(olderAsked, ["seed"], "asked once, with the words");
    pass("the local results show at once, and the list says the server searches");

    release();
    await sleep(500);
    assert(!text().includes("Searching older mail"), "the line goes when the answer is in");
    assert(at("Older mail") > at(RECENT.subject), "the heading stands below the local result");
    assert(at(OLD.subject) > at("Older mail"), "and the older thread below the heading");
    assert.equal(count(RECENT.subject), 1, "the thread found locally is not shown again");
    pass("the older thread stands under “Older mail”, below the local results, with no thread twice");

    older = { mode: "fail" };
    search("seeds");
    await sleep(1200);
    assert(text().includes(RECENT.subject), "the local result stands");
    assert(!text().includes("Older mail"), "with no older heading");
    assert(text().includes("The server could not search older mail."), "and one quiet line");
    assert.equal(toasts.length, 0, `no toast: ${JSON.stringify(toasts)}`);
    pass("a failed server search leaves the local results, one quiet line, and no toast");

    older = { mode: "offline" };
    search("seed swap");
    await sleep(1200);
    assert(text().includes(RECENT.subject), "offline, the local result stands");
    assert(text().includes("Older mail is not searched while the mailbox is offline."), "with one quiet line");
    assert.equal(toasts.length, 0, "and no toast");
    pass("offline, the local results stand alone, with one quiet line");

    const asked = olderAsked.length;
    search("");
    await sleep(900);
    assert(!text().includes("Older mail"), "no older part with no search");
    assert.equal(olderAsked.length, asked, "and no further request");
    pass("a cleared search drops the older part");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the older-mail walk failed:", err);
    process.exit(1);
  }
}

void main();
