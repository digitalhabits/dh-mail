/**
 * The walk itself — see mounted-page-moves.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "sigrun@bergtun.example";
const row = (threadId, subject, lastAt) => ({
  account: ACCOUNT,
  threadId,
  subject,
  fromName: "Halvard Moe",
  fromEmail: "halvard@lysvik.example",
  snippet: subject,
  lastAt,
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Halvard Moe", email: "halvard@lysvik.example" }],
});
const ROWS = [
  row("apple-1", "Apples for the autumn market", "2026-08-20T09:00:00.000Z"),
  row("fence-1", "The fence by the lower field", "2026-08-19T09:00:00.000Z"),
  row("hay-1", "Hay for the winter", "2026-08-18T09:00:00.000Z"),
];
const moved = new Set();
const posts = [];
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (init?.method === "POST") {
    const body = init.body ? JSON.parse(init.body) : null;
    posts.push({ path: p, body });
    if (p === "/api/mail/folders/move") {
      moved.add(body.threadId);
      return json({ folderName: body.folderName, movedOut: true });
    }
    return json({ ok: true });
  }
  if (p === "/api/mail/threads") return json({ threads: ROWS.filter((t) => !moved.has(t.threadId)), nextCursor: null });
  if (p === "/api/gmail/accounts") return json({ accounts: [{ email: ACCOUNT, inMailTab: true }] });
  if (p === "/api/outlook/accounts") return json({ accounts: [] });
  if (p === "/api/mail/snoozed") return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [{ account: ACCOUNT, name: "Market", count: 0 }] });
  return json({});
});

const clickEl = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
};
const buttons = () => [...document.querySelectorAll("button")];
const byLabel = (label) => buttons().find((b) => b.getAttribute("aria-label") === label);
const rowEl = (subject) =>
  [...document.querySelectorAll("[data-thread-key]")].find((el) => (el.textContent || "").includes(subject));

/** A DataTransfer that keeps what is set on it, as a browser's does. */
function transfer() {
  const data = new Map();
  return {
    data,
    get types() {
      return [...data.keys()];
    },
    setData: (type, value) => data.set(type, value),
    getData: (type) => data.get(type) ?? "",
    setDragImage: () => undefined,
    dropEffect: "none",
    effectAllowed: "all",
  };
}
const dragEvent = (type, dataTransfer) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  return event;
};

async function mount() {
  window.localStorage.clear();
  window.localStorage.setItem("redd-plan-mail-view-mode", "threads");
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement(MailPage, { accounts: [ACCOUNT], viewerId: "viewer-moves", ownAddresses: [ACCOUNT] }));
  await waitFor(() => ROWS.every((t) => rowEl(t.subject)));
  return root;
}

async function dragToFolder() {
  clickEl(byLabel("Folders"));
  const folderRow = () =>
    [...document.querySelectorAll("[role=button]")].find((el) => (el.textContent || "").trim() === "Market");
  await waitFor(() => folderRow());
  const dt = transfer();
  const fence = rowEl("The fence by the lower field");
  fence.dispatchEvent(dragEvent("dragstart", dt));
  assert(dt.types.includes("application/x-redd-mail-thread"), `the row puts itself on the drag: ${dt.types.join(",")}`);
  // The rail draws the folders as places to drop once it hears of the drag.
  await sleep(100);
  for (const type of ["dragenter", "dragover"]) {
    folderRow().dispatchEvent(dragEvent(type, dt));
    await sleep(50);
  }
  folderRow().dispatchEvent(dragEvent("drop", dt));
  fence.dispatchEvent(dragEvent("dragend", dt));
  await waitFor(() => posts.some((x) => x.path === "/api/mail/folders/move"));
  assert(posts.some((x) => x.path === "/api/mail/folders/move"), "the drop asks for the move");
  const sent = posts.find((x) => x.path === "/api/mail/folders/move").body;
  assert.equal(sent.threadId, "fence-1");
  assert.equal(sent.folderName, "Market");
  await waitFor(() => !rowEl("The fence by the lower field"));
  assert(rowEl("Apples for the autumn market") && rowEl("Hay for the winter"), "the other rows stay");
  pass("a row dragged onto a folder in the rail moves there, and leaves the list");
}

async function pinGlide() {
  // happy-dom lays nothing out, so each row's box is its place in the list.
  const proto = window.HTMLElement.prototype;
  const realRect = proto.getBoundingClientRect;
  proto.getBoundingClientRect = function () {
    if (!this.hasAttribute?.("data-thread-key")) return realRect.call(this);
    const all = [...document.querySelectorAll("[data-thread-key]")];
    const top = all.indexOf(this) * 60;
    return { left: 0, right: 300, top, bottom: top + 60, width: 300, height: 60, x: 0, y: top };
  };
  const glides = [];
  const realAnimate = proto.animate;
  proto.animate = function (frames) {
    glides.push({ key: this.dataset?.threadKey, frames, inList: Boolean(this.closest("[data-thread-key]")) });
    return { finished: Promise.resolve(), cancel() {} };
  };
  try {
    const hay = rowEl("Hay for the winter");
    hay.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 30 }));
    await sleep(300);
    const pin = [...document.querySelectorAll("[role=menuitem]")].find((b) => /^Pin\b/.test((b.textContent || "").trim()));
    assert(pin, "the row's menu offers Pin");
    clickEl(pin);
    await waitFor(() => glides.some((g) => g.key === `${ACCOUNT}|hay-1`));
    const glide = glides.find((g) => g.key === `${ACCOUNT}|hay-1`);
    assert(/translate\(0px, 60px\)/.test(glide.frames[0].transform), `it starts where it was: ${glide.frames[0].transform}`);
    pass(`a pinned row glides from its old place to its new one — ${glide.frames[0].transform}`);
  } finally {
    proto.getBoundingClientRect = realRect;
    proto.animate = realAnimate;
  }
}

async function main() {
  try {
    await mount();
    await dragToFolder();
    await pinGlide();
  } catch (err) {
    console.error("the mounted walk failed:", err);
    process.exit(1);
  }
  process.exit(0);
}

void main();
