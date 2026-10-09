/**
 * What the two folder menus offer for a typed name.
 *
 * Both the menu that opens a folder and the menu that files a conversation in
 * one read this, so they cannot disagree about which names are usable.
 */

import assert from "node:assert/strict";

import {
  checkNewFolderName,
  findFolderByName,
  folderPickItems,
  MAX_FOLDER_NAME,
  newFolderNameProblem,
  normalizeFolderName,
} from "@/lib/mail/folder-picker";

const FOLDERS = [
  { name: "Accounting", count: 4 },
  { name: "Blocked", count: 2 },
  { name: "Work/Invoices", count: 9 },
];

/** Nothing typed: every folder, and nothing to make. */
{
  const items = folderPickItems(FOLDERS, "");
  assert.equal(items.length, 3);
  assert.ok(items.every((i) => i.kind === "folder"));
}

/** Part of a name filters, and still offers to make one with what was typed. */
{
  const items = folderPickItems(FOLDERS, "acc");
  assert.deepEqual(
    items.map((i) => (i.kind === "folder" ? i.folder.name : `+${i.name}`)),
    ["Accounting", "+acc"]
  );
}

/** A name a folder already has is not offered again. */
{
  const items = folderPickItems(FOLDERS, "blocked");
  assert.deepEqual(
    items.map((i) => i.kind),
    ["folder"]
  );
}

/** Naming shows only the offer, so no folder can be picked by mistake. */
{
  const items = folderPickItems(FOLDERS, "Bills", { naming: true });
  assert.deepEqual(items, [{ kind: "create", name: "Bills" }]);
}

/** Naming with nothing typed offers nothing. */
{
  assert.deepEqual(folderPickItems(FOLDERS, "   ", { naming: true }), []);
}

/** Naming a folder that exists offers nothing, and says why. */
{
  assert.deepEqual(folderPickItems(FOLDERS, "blocked", { naming: true }), []);
  const check = checkNewFolderName(FOLDERS, "blocked");
  assert.equal(check.state, "taken");
  assert.equal(newFolderNameProblem(check), "Blocked already exists");
}

/** A name too long for the hosts is refused here, before the request. */
{
  const check = checkNewFolderName(FOLDERS, "x".repeat(MAX_FOLDER_NAME + 1));
  assert.equal(check.state, "too-long");
  assert.match(newFolderNameProblem(check), /100 characters/);
  assert.equal(checkNewFolderName(FOLDERS, "x".repeat(MAX_FOLDER_NAME)).state, "ok");
}

/** Still typing is not a problem to report. */
{
  assert.equal(newFolderNameProblem(checkNewFolderName(FOLDERS, "")), null);
  assert.equal(newFolderNameProblem(checkNewFolderName(FOLDERS, "Bills")), null);
}

/** Space around and inside a name is tidied, so two names cannot look alike. */
{
  assert.equal(normalizeFolderName("  Work   Notes "), "Work Notes");
  const check = checkNewFolderName(FOLDERS, "  Work   Notes ");
  assert.equal(check.state, "ok");
  assert.equal(check.name, "Work Notes");
}

/** Case is not what makes a name different. */
{
  assert.equal(findFolderByName(FOLDERS, "ACCOUNTING")?.name, "Accounting");
  assert.equal(findFolderByName(FOLDERS, "nothing"), null);
  assert.equal(findFolderByName(FOLDERS, "  "), null);
}

/** A nested Gmail label is one folder, matched by any part of its path. */
{
  const items = folderPickItems(FOLDERS, "invoices");
  assert.equal(items[0].folder.name, "Work/Invoices");
}

console.log("folder-picker: ok");
