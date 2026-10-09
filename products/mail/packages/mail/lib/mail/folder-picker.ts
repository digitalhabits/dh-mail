/**
 * What the two folder menus offer for a given name.
 *
 * Both the menu that opens a folder and the menu that files a conversation in
 * one let you make a folder, and both must agree about what a usable name is —
 * otherwise one of them offers to make a folder the other would refuse.
 *
 * At Gmail a folder is a label. Nothing in the interface says so, because
 * nothing in the interface needs to: the same name, made from either menu,
 * gives you a label in Gmail and a folder in Outlook, and both show up in the
 * same list here.
 */

import type { MailFolder } from "@/lib/mail/folder-types";

/**
 * As long as a folder name may be. The two routes that make folders have said
 * this since folders were added, so a longer name fails at the host with a
 * message about a schema. Better to say so before the request.
 */
export const MAX_FOLDER_NAME = 100;

export type FolderPickItem =
  | { kind: "folder"; folder: MailFolder }
  | { kind: "create"; name: string };

/** Folder names ignore the case and the extra spaces someone types. */
export function normalizeFolderName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function findFolderByName(
  folders: MailFolder[],
  raw: string
): MailFolder | null {
  const name = normalizeFolderName(raw).toLowerCase();
  if (!name) return null;
  return folders.find((f) => f.name.toLowerCase() === name) ?? null;
}

export type NewFolderNameCheck =
  | { state: "empty" }
  | { state: "taken"; folder: MailFolder }
  | { state: "too-long" }
  | { state: "ok"; name: string };

/** Whether a typed name can be made into a folder, and why not when it cannot. */
export function checkNewFolderName(
  folders: MailFolder[],
  raw: string
): NewFolderNameCheck {
  const name = normalizeFolderName(raw);
  if (!name) return { state: "empty" };
  if (name.length > MAX_FOLDER_NAME) return { state: "too-long" };
  const taken = findFolderByName(folders, name);
  if (taken) return { state: "taken", folder: taken };
  return { state: "ok", name };
}

/** What to tell the reader, or nothing while they are still typing. */
export function newFolderNameProblem(check: NewFolderNameCheck): string | null {
  switch (check.state) {
    case "taken":
      return `${check.folder.name} already exists`;
    case "too-long":
      return `Keep the name to ${MAX_FOLDER_NAME} characters`;
    default:
      return null;
  }
}

/**
 * The rows a folder menu shows.
 *
 * Filtering: every folder whose name contains what was typed, and an offer to
 * make one with that name when no folder has it already.
 *
 * Naming: only the offer, so the list of folders cannot be picked by mistake
 * while the box means something else.
 */
export function folderPickItems(
  folders: MailFolder[],
  query: string,
  options?: { naming?: boolean }
): FolderPickItem[] {
  const check = checkNewFolderName(folders, query);
  const createItem: FolderPickItem[] =
    check.state === "ok" ? [{ kind: "create", name: check.name }] : [];

  if (options?.naming) return createItem;

  const q = normalizeFolderName(query).toLowerCase();
  const matches = q
    ? folders.filter((f) => f.name.toLowerCase().includes(q))
    : folders;
  return [
    ...matches.map((folder) => ({ kind: "folder" as const, folder })),
    ...createItem,
  ];
}
