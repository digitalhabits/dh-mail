/**
 * The walk itself — see mounted-folder-rail.test.mjs. Fixtures invented,
 * as every fixture here must be.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailFolderRail } from "@/components/mail/MailFolderRail";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ULLA = "ulla@aavang.example";
const TEA = "tea@aavang.example";
const FOLDERS = [
  { account: ULLA, name: "Clients", count: 4 },
  { account: ULLA, name: "Clients/2026", count: 2 },
  { account: ULLA, name: "Receipts", count: 7 },
  { account: TEA, name: "Choir", count: 3 },
];

setMailApiTransport(async () => new Response("{}", { status: 200 }));

const calls = [];
// A view is opened by a click handler, so its one argument is the event:
// kept as a word, not the event.
const plain = (args) => args.map((a) => (a && typeof a === "object" ? "(event)" : a));
const note = (name) => (...args) => {
  calls.push([name, ...plain(args)]);
};
const noteAsync = (name) => async (...args) => {
  calls.push([name, ...plain(args)]);
};
const last = (name) => [...calls].reverse().find((c) => c[0] === name);

let root;
function mount(openFolder = null) {
  root.render(
    React.createElement(MailFolderRail, {
      accountFolders: FOLDERS,
      loading: false,
      accounts: [ULLA, TEA],
      openFolder,
      systemView: null,
      draftCount: 2,
      onOpenFolder: note("openFolder"),
      onOpenSent: note("openSent"),
      onOpenDrafts: note("openDrafts"),
      onOpenTrash: note("openTrash"),
      onOpenInbox: note("openInbox"),
      onOpenJunk: note("openJunk"),
      onOpenArchived: note("openArchived"),
      onCreateFolder: noteAsync("createFolder"),
      onRenameFolder: noteAsync("renameFolder"),
      onDeleteFolder: noteAsync("deleteFolder"),
      draggingAccount: null,
      onDropThread: note("dropThread"),
      onDropTrash: note("dropTrash"),
    })
  );
}

const text = () => document.body.textContent || "";
// A row is keyed by its mailbox and its name, lower case, apart by a NUL.
const folderButton = (account, name) => {
  const key = `${account}\u0000${name}`.toLowerCase();
  const row = [...document.querySelectorAll("[data-folder-row]")].find(
    (el) => el.getAttribute("data-folder-row") === key
  );
  return row ? row.querySelector("[role=button]") : null;
};
const buttonByLabel = (label) =>
  [...document.querySelectorAll("button,[role=button]")].find(
    (b) => b.getAttribute("aria-label") === label
  );
const buttonByText = (label) =>
  [...document.querySelectorAll("button,[role=button],[role=menuitem]")].find(
    (b) => (b.textContent || "").trim() === label
  );
const menuItem = (label) =>
  [...document.querySelectorAll("[role=menuitem]")].find(
    (b) => (b.textContent || "").trim() === label
  );
const rightClick = async (el) => {
  el.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
  );
  await sleep(100);
};
const typeInto = (el, value) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const key = (el, k) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

async function viewsAndFolders() {
  for (const view of ["Sent", "Drafts", "Trash"]) assert(buttonByText(view) || text().includes(view), `${view} is at the top`);
  const sent = [...document.querySelectorAll("button,[role=button]")].find((b) => /^Sent/.test((b.textContent || "").trim()));
  sent.click();
  assert(last("openSent"), "Sent opens the sent view");
  pass("the views stand at the top, and Sent opens its view");

  for (const [account, name] of [[ULLA, "Clients"], [ULLA, "Clients/2026"], [ULLA, "Receipts"], [TEA, "Choir"]])
    assert(folderButton(account, name), `${name} has a row on ${account}`);
  assert(buttonByText(ULLA) || document.querySelector(`button[title="${ULLA}"]`), "Ulla's mailbox has a heading");
  pass("each mailbox has its section, with its folders as a tree");

  folderButton(ULLA, "Receipts").click();
  assert.deepEqual(last("openFolder"), ["openFolder", ULLA, "Receipts"]);
  pass("a click on a folder opens it");

  const receiptsRow = folderButton(ULLA, "Receipts").closest("[data-folder-row]");
  assert(/7$/.test((receiptsRow.textContent || "").trim()), `Receipts shows its count: ${receiptsRow.textContent}`);
  pass("a folder shows its count");

  const heart = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Add to favourites: Receipts");
  assert(heart, "Receipts has a heart");
  heart.click();
  await sleep(100);
  assert(/Favourites/i.test(text()), "a Favourites section is there now");
  assert.equal(
    [...document.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") === "Remove from favourites: Receipts").length >= 1,
    true,
    "and Receipts' heart now takes it off"
  );
  [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Remove from favourites: Receipts").click();
  await sleep(100);
  pass("the heart puts a folder in Favourites, and takes it out");

  mount({ account: ULLA, name: "Clients" });
  await sleep(50);
  assert.equal(folderButton(ULLA, "Clients").getAttribute("aria-current"), "true", "the open folder is marked");
  assert.equal(folderButton(ULLA, "Receipts").getAttribute("aria-current"), null, "and no other");
  mount(null);
  await sleep(50);
  pass("the open folder is marked, and only that one");
}

async function foldAndFilter() {
  buttonByLabel("Fold Clients").click();
  await sleep(50);
  assert(!folderButton(ULLA, "Clients/2026"), "2026 is hidden while Clients is folded");
  buttonByLabel("Open Clients").click();
  await sleep(50);
  assert(folderButton(ULLA, "Clients/2026"), "and back when it opens");
  pass("a folder with children folds and opens again");

  const heading = document.querySelector(`button[title="${ULLA}"]`);
  heading.click();
  await sleep(50);
  assert(!folderButton(ULLA, "Receipts"), "Ulla's folders are hidden while her mailbox is folded");
  assert(folderButton(TEA, "Choir"), "Tea's are not");
  heading.click();
  await sleep(50);
  assert(folderButton(ULLA, "Receipts"), "and back when it opens");
  pass("a mailbox heading folds its whole section");

  const filter = document.querySelector('input[aria-label="Filter folders"]');
  typeInto(filter, "rece");
  await sleep(50);
  assert(folderButton(ULLA, "Receipts"), "Receipts is found");
  assert(!folderButton(ULLA, "Clients"), "Clients is not");
  assert(!folderButton(TEA, "Choir"), "nor Choir");
  typeInto(filter, "");
  await sleep(50);
  assert(folderButton(TEA, "Choir"), "an empty filter shows all again");
  pass("the filter keeps only the folders it finds");
}

async function menu() {
  await rightClick(folderButton(ULLA, "Receipts"));
  for (const item of ["Rename folder", "Move folder…", "Delete folder…"]) assert(menuItem(item), `the menu offers ${item}`);
  menuItem("Rename folder").click();
  await sleep(50);
  const input = document.querySelector('input[aria-label="Rename Receipts"]');
  assert(input, "Rename puts a box on the row");
  input.value = "Bills";
  key(input, "Enter");
  await sleep(100);
  assert.deepEqual(last("renameFolder"), ["renameFolder", ULLA, "Receipts", "Bills"]);
  pass("the menu renames a folder");

  calls.length = 0;
  await rightClick(folderButton(ULLA, "Receipts"));
  menuItem("Move folder…").click();
  await sleep(50);
  const picker = document.querySelector('[role=dialog][aria-label="Move Receipts"]');
  assert(picker, "Move opens the picker");
  // Receipts stands at the top already, so Top level is where it is now
  // and Clients is the first row it can go to: the one Enter would take.
  const rows = [...picker.querySelectorAll("button")];
  assert(rows[0].disabled, "Top level cannot be picked: Receipts is there now");
  const clients = rows.find((b) => /^Clients/.test((b.textContent || "").trim()));
  clients.click();
  await sleep(100);
  assert.deepEqual(last("renameFolder"), ["renameFolder", ULLA, "Receipts", "Clients/Receipts"]);
  pass("the menu moves a folder into another, as a rename");

  await rightClick(folderButton(ULLA, "Receipts"));
  menuItem("Delete folder…").click();
  await sleep(50);
  const ask = document.querySelector('[role=dialog][aria-label="Delete Receipts"]');
  assert(ask, "Delete asks first");
  assert(!last("deleteFolder"), "and deletes nothing yet");
  [...ask.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Keep").click();
  await sleep(50);
  assert(!last("deleteFolder"), "Keep deletes nothing");
  await rightClick(folderButton(ULLA, "Receipts"));
  menuItem("Delete folder…").click();
  await sleep(50);
  const again = document.querySelector('[role=dialog][aria-label="Delete Receipts"]');
  [...again.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Delete").click();
  await sleep(100);
  assert.deepEqual(last("deleteFolder"), ["deleteFolder", ULLA, "Receipts"]);
  pass("the menu deletes a folder after it asks, and Keep keeps it");
}

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    root = createRoot(document.getElementById("r"));
    mount();
    await sleep(300);
    await viewsAndFolders();
    await foldAndFilter();
    await menu();
    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the folder rail walk failed:", err);
    console.error("calls so far:", JSON.stringify(calls));
    process.exit(1);
  }
}

void main();
