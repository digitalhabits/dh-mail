/**
 * The walk itself — see mounted-page-controls.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";
import { MAIL_THREAD_DRAG_TYPE } from "@/components/mail/MailFolders";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RUNA = "runa@fjeldhus.example";
const ODD = "odd@fjeldhus.example";
const row = (account, threadId, subject, lastAt) => ({
  account,
  threadId,
  subject,
  fromName: "Ilse Brandvold",
  fromEmail: "ilse@lindehagen.example",
  snippet: subject,
  lastAt,
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Ilse Brandvold", email: "ilse@lindehagen.example" }],
});
const ROWS = {
  [RUNA]: [row(RUNA, "r1", "The ferry times for the spring", "2026-08-20T09:00:00.000Z")],
  [ODD]: [row(ODD, "o1", "Paint for the boat shed", "2026-08-19T09:00:00.000Z")],
};
let reads = 0;
setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (p === "/api/mail/threads") {
    reads += 1;
    const account = url.searchParams.get("account");
    return json({ threads: account ? (ROWS[account] ?? []) : Object.values(ROWS).flat(), nextCursor: null });
  }
  if (p === "/api/gmail/accounts") return json({ accounts: [RUNA, ODD].map((email) => ({ email, inMailTab: true })) });
  if (p === "/api/outlook/accounts") return json({ accounts: [] });
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
const buttons = () => [...document.querySelectorAll("button")];
const byLabel = (label) => buttons().find((b) => b.getAttribute("aria-label") === label);
const byText = (words) => buttons().find((b) => (b.textContent || "").trim() === words);
// The button's words, as the app has them (hideMailList and the others).
const HIDE = "Hide the mail list (bring the pointer to the edge to show it)";
const SHOW = "Show mail list";
const KEEP = "Keep the mail list shown";
const RUNA_ROW = "The ferry times for the spring";
const ODD_ROW = "Paint for the boat shed";
const listed = (subject) =>
  [...document.querySelectorAll("[data-thread-key]")].some((el) => (el.textContent || "").includes(subject));

async function mount() {
  window.localStorage.clear();
  window.localStorage.setItem("redd-plan-mail-view-mode", "threads");
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement(MailPage, { accounts: [RUNA, ODD], viewerId: "viewer-controls", ownAddresses: [RUNA, ODD] }));
  await waitFor(() => listed(RUNA_ROW) && listed(ODD_ROW));
  return root;
}

async function mailboxTabsSelect() {
  const tab = buttons().find((b) => b.hasAttribute("aria-pressed") && (b.textContent || "").includes("runa"));
  assert(tab, "Runa's mailbox has a tab");
  clickEl(tab);
  await waitFor(() => !listed(ODD_ROW));
  assert(listed(RUNA_ROW), "Runa's row stays");
  assert.equal(tab.getAttribute("aria-pressed"), "true");
  const all = buttons().find((b) => b.hasAttribute("aria-pressed") && (b.textContent || "").trim() === "All");
  assert(all, "the row has All");
  clickEl(all);
  await waitFor(() => listed(ODD_ROW));
  assert(listed(RUNA_ROW));
  pass("a mailbox tab narrows the list to that mailbox, and All shows both again");
}

/** The mailbox tabs in the row, left to right: All, then each mailbox. */
const mailboxTabs = () =>
  buttons().filter((b) => b.hasAttribute("aria-pressed") && /^(All|runa|odd)/.test((b.textContent || "").trim()));

async function mailboxTabDrag() {
  const names = () => mailboxTabs().map((b) => (b.textContent || "").trim().split(/[@ ]/)[0]);
  assert.deepEqual(names(), ["All", "runa", "odd"]);
  // happy-dom lays nothing out, so each tab is given its box by hand.
  mailboxTabs().forEach((b, i) => {
    const left = i * 150;
    b.getBoundingClientRect = () => ({ left, right: left + 140, top: 0, bottom: 30, width: 140, height: 30, x: left, y: 0 });
  });
  const odd = mailboxTabs()[2];
  const at = (x) => ({ bubbles: true, cancelable: true, isPrimary: true, button: 0, pointerId: 1, clientX: x, clientY: 15 });
  odd.dispatchEvent(new PointerEvent("pointerdown", at(370)));
  await sleep(20);
  for (const x of [360, 300, 240, 220]) {
    document.dispatchEvent(new PointerEvent("pointermove", at(x)));
    await sleep(20);
  }
  document.dispatchEvent(new PointerEvent("pointerup", at(220)));
  await waitFor(() => names().join(",") === "All,odd,runa");
  // The click that ends a drag does not select the tab.
  assert.equal(odd.getAttribute("aria-pressed"), "false");
  pass("a mailbox tab dragged before another moves there");
}

async function foldersButton() {
  const folders = () => byLabel("Folders");
  assert(folders(), "the Folders button is there");
  assert.equal(folders().getAttribute("aria-expanded"), "false");
  clickEl(folders());
  await waitFor(() => folders().getAttribute("aria-expanded") === "true");
  clickEl(folders());
  await waitFor(() => folders().getAttribute("aria-expanded") === "false");
  pass("Folders opens the rail, and a second press puts it away");

  // A conversation dragged at the button asks for the folders.
  const drag = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(drag, "dataTransfer", {
    value: { types: [MAIL_THREAD_DRAG_TYPE], dropEffect: "none", getData: () => "" },
  });
  folders().dispatchEvent(drag);
  assert(drag.defaultPrevented, "the button takes the drag");
  await waitFor(() => folders().getAttribute("aria-expanded") === "true");
  // Anything else dragged there is not a conversation, and is left alone.
  clickEl(folders());
  await waitFor(() => folders().getAttribute("aria-expanded") === "false");
  const other = new Event("dragenter", { bubbles: true, cancelable: true });
  Object.defineProperty(other, "dataTransfer", { value: { types: ["text/plain"], getData: () => "" } });
  folders().dispatchEvent(other);
  assert(!other.defaultPrevented, "a drag that is not a conversation is not taken");
  await sleep(100);
  assert.equal(folders().getAttribute("aria-expanded"), "false");
  pass("a conversation dragged over Folders opens the rail, and nothing else does");
}

async function listButton() {
  assert(byLabel(HIDE), "the list's button says it hides the list");
  clickEl(byLabel(HIDE));
  await waitFor(() => byLabel(SHOW));
  clickEl(byLabel(SHOW));
  await waitFor(() => byLabel(HIDE));
  pass("the list's button hides the list and shows it again");

  clickEl(byLabel(HIDE));
  await waitFor(() => byLabel(SHOW));
  // The pointer on the button brings the list out over the reader.
  await sleep(600);
  byLabel(SHOW).dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
  byLabel(SHOW).dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  await waitFor(() => byLabel(KEEP));
  clickEl(byLabel(KEEP));
  await waitFor(() => byLabel(HIDE));
  pass("out on the pointer, the list's button pins the list in place");
}

async function resizeHandle() {
  const handle = () =>
    [...document.querySelectorAll("[role=separator]")].find((el) => el.getAttribute("aria-orientation") === "vertical" && el.className.includes("cursor-col-resize") && el.className.includes("w-2"));
  await waitFor(() => handle());
  const before = Number(handle().getAttribute("aria-valuenow"));
  handle().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 600, clientY: 300 }));
  window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 560, clientY: 300 }));
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 560, clientY: 300 }));
  await sleep(100);
  const after = Number(handle()?.getAttribute("aria-valuenow"));
  assert(Number.isFinite(before) && Number.isFinite(after), `${before} → ${after}`);
  assert(after < before, `the list is narrower after the drag: ${before} → ${after}`);
  pass(`the handle between the list and the reader makes the list narrower — ${before} → ${after}`);
}

async function syncButton() {
  const before = reads;
  const sync = byLabel("Sync inbox");
  assert(sync, "the Sync button is there");
  clickEl(sync);
  await waitFor(() => reads > before);
  pass("Sync reads the list again");
}

async function displayMenu() {
  const opener = byLabel("Settings");
  assert(opener, "the Settings menu has a button");
  assert(!text().includes("Theme"), "the menu is shut");
  clickEl(opener);
  await waitFor(() => text().includes("Theme"));
  pass("the Settings menu opens from the title bar");
}

async function main() {
  try {
    await mount();
    await mailboxTabsSelect();
    await mailboxTabDrag();
    await foldersButton();
    await listButton();
    await resizeHandle();
    await syncButton();
    await displayMenu();
  } catch (err) {
    console.error("the mounted walk failed:", err);
    process.exit(1);
  }
  process.exit(0);
}

void main();
