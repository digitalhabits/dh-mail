/**
 * The walk itself — see mounted-list-states.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const DRAFT = {
  id: "gd-1",
  origin: "gmail",
  account: ACCOUNT,
  threadId: null,
  subject: "Programme for the spring concert",
  snippet: "First half: the Brahms",
  to: ["merle@sangkor.example"],
  updatedAt: "2026-08-20T10:00:00.000Z",
};

setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (p === "/api/mail/threads") return json({ threads: [], nextCursor: null });
  if (p === "/api/mail/drafts") return json({ drafts: [DRAFT] });
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

async function mount(accounts) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement(MailPage, { accounts, viewerId: "states-viewer", ownAddresses: accounts }));
  await sleep(700);
  return root;
}

async function main() {
  try {
    let root = await mount([]);
    assert(text().includes("Connect an account to get started"), "no mailbox: how to connect one");
    pass("with no mailbox connected, the list says how to connect one");
    root.unmount();

    root = await mount([ACCOUNT]);
    assert(/enjoy the quiet/.test(text()), `a mailbox with no mail says so: ${text().slice(0, 300)}`);
    pass("with a mailbox and no mail, the list says so");

    const drafts = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Drafts");
    assert(drafts, "the Drafts view is offered");
    clickEl(drafts);
    await sleep(700);
    assert(text().includes("Programme for the spring concert"), "the provider's draft is listed");
    pass("in Drafts, the list shows the drafts the provider holds");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the list states walk failed:", err);
    process.exit(1);
  }
}

void main();
