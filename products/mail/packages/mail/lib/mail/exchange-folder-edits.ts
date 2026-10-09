/**
 * Folder edits of an Exchange (EWS) mailbox: create, rename, and delete, on
 * the plan of the Outlook ones (`outlook-folders.ts`). A folder is named by
 * its path, `/`-separated, as the rail shows it.
 *
 * Delete moves the folder, with its mail and its subfolders, to Deleted
 * Items, as Outlook does. It can be undone from there. The app never sends
 * `DeleteFolder` (see `ews_folder_edits.rs`).
 *
 * The kept folder tree (`exchange-folders.ts`) changes at once, so the rail
 * shows the edit before the worker's next pass. A rename or a delete changes
 * the path of the folder and of each folder under it, and the rows of those
 * folders carry their path as a label. So their sync states are dropped, and
 * the worker reads them again from the start, which writes every row with
 * the new path.
 */

import {
  exchangeFolderRows,
  notifyExchangeFolders,
  readExchangeFolders,
  writeExchangeFolders,
  type ExchangeFolderState,
} from "@/lib/mail/exchange-folders";
import { createExchangeFolder, moveExchangeFolder, renameExchangeFolder } from "@/lib/mail/exchange-native";
import { wakeExchangeSync } from "@/lib/mail/exchange-sync";
import { mailStore } from "@/lib/mail/store";
import type { MailSyncState } from "@/lib/mail/store/types";

function key(path: string): string {
  return path.trim().toLowerCase();
}

function parts(path: string): string[] {
  return path
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
}

/** A folder of the tree by its path, with its role, or null. */
function find(tree: ExchangeFolderState, path: string) {
  return exchangeFolderRows(tree).find((row) => key(row.path) === key(path)) ?? null;
}

function rootId(tree: ExchangeFolderState): string {
  const id = tree.wellKnown.msgfolderroot;
  if (!id) throw new Error("ews:invalid: The folder list is not read yet. Try again after the next sync.");
  return id;
}

/** A folder Exchange manages (Inbox, Sent Items, ...) keeps its name and place. */
function refuseManaged(row: { role?: string; path: string }): void {
  if (row.role) throw new Error(`ews:invalid: "${row.path}" is a folder that Exchange manages. It cannot be renamed or deleted.`);
}

/** The folder and every folder under it, by id. */
function subtree(tree: ExchangeFolderState, id: string): string[] {
  const out = [id];
  for (let i = 0; i < out.length; i += 1) {
    for (const folder of Object.values(tree.folders)) if (folder.parentId === out[i]) out.push(folder.id);
  }
  return out;
}

/** Drop the sync states of these folders: the worker reads them again. */
async function readAgain(email: string, ids: string[]): Promise<void> {
  for (const folder of ids) {
    const state = { account: email, folder, phase: "none", deltaLink: null } as unknown as MailSyncState;
    await mailStore().sync.set(state).catch(() => undefined);
  }
}

async function keep(email: string, tree: ExchangeFolderState): Promise<void> {
  await writeExchangeFolders(email, tree);
  notifyExchangeFolders();
  wakeExchangeSync(email, "all");
}

/**
 * Find a folder by path, creating any missing part of it. `Projects/2026`
 * under a mailbox with neither creates both. Answers the folder's id.
 */
export async function ensureExchangeFolder(email: string, path: string): Promise<string> {
  let tree = await readExchangeFolders(email);
  let parentId = rootId(tree);
  let walked = "";
  let created = false;
  for (const segment of parts(path)) {
    walked = walked ? `${walked}/${segment}` : segment;
    const hit = find(tree, walked);
    if (hit) {
      parentId = hit.id;
      continue;
    }
    const made = await createExchangeFolder(email, parentId, segment);
    tree = { ...tree, folders: { ...tree.folders, [made.id]: made } };
    parentId = made.id;
    created = true;
  }
  if (!walked) throw new Error("ews:invalid: The folder needs a name.");
  if (created) await keep(email, tree);
  return parentId;
}

/**
 * Rename a folder, or move it under another folder when the path above its
 * name changes. False when the mailbox has no such folder.
 */
export async function renameExchangeFolderPath(email: string, from: string, to: string): Promise<boolean> {
  const tree = await readExchangeFolders(email);
  const source = find(tree, from);
  if (!source) return false;
  refuseManaged(source);
  const target = parts(to);
  const leaf = target.pop() ?? "";
  if (!leaf) throw new Error("ews:invalid: The folder needs a name.");
  const parentPath = target.join("/");
  let folder = tree.folders[source.id];
  if (key(parentPath) !== key(parts(from).slice(0, -1).join("/"))) {
    const parentId = parentPath ? await ensureExchangeFolder(email, parentPath) : rootId(tree);
    await moveExchangeFolder(email, source.id, parentId);
    folder = { ...folder, parentId };
  }
  if (leaf !== folder.name) {
    await renameExchangeFolder(email, source.id, leaf);
    folder = { ...folder, name: leaf };
  }
  const fresh = await readExchangeFolders(email);
  const next = { ...fresh, folders: { ...fresh.folders, [source.id]: folder } };
  await readAgain(email, subtree(next, source.id));
  await keep(email, next);
  return true;
}

/**
 * "Delete" a folder: move it, with its mail, to Deleted Items. False when
 * the mailbox has no such folder.
 */
export async function deleteExchangeFolder(email: string, path: string): Promise<boolean> {
  const tree = await readExchangeFolders(email);
  const found = find(tree, path);
  if (!found) return false;
  refuseManaged(found);
  const trash = tree.wellKnown.deleteditems;
  if (!trash) throw new Error("ews:invalid: This mailbox has no Deleted Items folder.");
  await moveExchangeFolder(email, found.id, null);
  const next = { ...tree, folders: { ...tree.folders, [found.id]: { ...tree.folders[found.id], parentId: trash } } };
  await readAgain(email, subtree(next, found.id));
  await keep(email, next);
  return true;
}

/** True when the mailbox has a folder at this path. */
export async function hasExchangeFolder(email: string, path: string): Promise<boolean> {
  return find(await readExchangeFolders(email), path) != null;
}
