/**
 * The rules for a drop on the folder rail (lib/mail/folder-drop.ts).
 *
 * happy-dom has no drag data, so the mounted rail walk cannot drag. What a
 * row does with what is held over it is decided here, as plain rules, and
 * checked here. The folders are invented.
 */

import { folderAcceptsFolder, folderParentPath, folderRowDropState } from "@/lib/mail/folder-drop";

import { check, suite } from "./harness.mjs";

const ULLA = "ulla@aavang.example";
const node = (name, over = {}) => ({
  account: ULLA,
  name,
  label: name.split("/").pop(),
  count: 0,
  implied: false,
  children: [],
  ...over,
});
const drag = (name, account = ULLA) => ({ account, name, label: name.split("/").pop() });
const row = (n, over = {}) =>
  folderRowDropState({ node: n, drop: "live", folderDrag: null, renaming: false, busy: false, ...over });

suite(async () => {
  // ---- A folder moved into another -------------------------------------------------
  check("a folder's parent is the name above it", folderParentPath("Clients/2026") === "Clients" && folderParentPath("Receipts") === "");
  check("a folder goes into another folder of its mailbox", folderAcceptsFolder(drag("Receipts"), node("Clients")));
  check("not into itself", !folderAcceptsFolder(drag("Clients"), node("Clients")));
  check("not into a folder inside it", !folderAcceptsFolder(drag("Clients"), node("Clients/2026")));
  check("not into the parent it already has", !folderAcceptsFolder(drag("Clients/2026"), node("Clients")));
  check("not into another mailbox", !folderAcceptsFolder(drag("Receipts", "tea@aavang.example"), node("Clients")));
  check("not into a search", !folderAcceptsFolder(drag("Receipts"), node("Archived", { virtual: true })));
  check("but into a stand-in parent, as a rename", folderAcceptsFolder(drag("Receipts"), node("Inbox", { implied: true })));

  // ---- A conversation held over a row -----------------------------------------------
  check("a folder takes a conversation over its mailbox", row(node("Clients")).takesDrop);
  check("a row of another mailbox does not", !row(node("Clients"), { drop: "dim" }).takesDrop);
  check("Sent refuses it", row(node("Sent", { role: "sent" })).refuses && !row(node("Sent", { role: "sent" })).takesDrop);
  check("a search refuses it", !row(node("Archived", { virtual: true })).takesDrop);
  check("a stand-in parent does not take it", !row(node("Academia", { implied: true })).takesDrop);

  // ---- A folder held over a row -------------------------------------------------------
  const carried = row(node("Clients"), { folderDrag: drag("Receipts") });
  check("with a folder in the air, a row that takes it is live", carried.carrying && carried.state === "live" && carried.takesDrop, JSON.stringify(carried));
  const own = row(node("Receipts"), { folderDrag: drag("Receipts") });
  check("the folder being carried knows it, and is dim", own.beingCarried && own.state === "dim" && !own.takesDrop, JSON.stringify(own));

  // ---- Who can be picked up -------------------------------------------------------------
  check("a folder can be moved", row(node("Clients")).canMoveThisFolder);
  check("not while it is renamed", !row(node("Clients"), { renaming: true }).canMoveThisFolder);
  check("nor while a change to it is on its way", !row(node("Clients"), { busy: true }).canMoveThisFolder);
  check("nor a stand-in parent, nor a search", !row(node("Academia", { implied: true })).canMoveThisFolder && !row(node("Archived", { virtual: true })).canMoveThisFolder);
});
