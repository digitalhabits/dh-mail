/**
 * The folder list of an Exchange (EWS) mailbox, as the worker keeps it.
 *
 * `SyncFolderHierarchy` gives the changes since a sync state, not the whole
 * tree each time. So the tree is kept here, in the store's settings, with
 * the sync state and the ids of the well-known folders. The worker
 * (`exchange-sync.ts`) changes it after each folder sync, and the folder
 * rail (`folders.ts`) reads it.
 *
 * The rest follows the Outlook folders (`outlook-folders.ts`): a folder is
 * named by its path from the top of the mailbox, `/`-separated, and the
 * folders that Exchange manages carry a role.
 */

import { mailStore } from "@/lib/mail/store";
import { copyListTargetForRole, type CopyListTarget, type MailFolderRole } from "@/lib/mail/folder-types";
import type { ExchangeFolder, ExchangeHierarchy } from "@/lib/mail/exchange-native";

/** What is kept for one mailbox. */
export type ExchangeFolderState = {
  syncState: string | null;
  /** Folder id by EWS name: `inbox`, `sentitems`, `msgfolderroot`, ... */
  wellKnown: Record<string, string>;
  folders: Record<string, ExchangeFolder>;
};

/** A folder as the rail and the worker use it. */
export type ExchangeFolderRow = {
  id: string;
  path: string;
  role?: MailFolderRole;
  total: number;
  unread: number;
};

/** The managed folders the rail shows, with their role. */
const ROLES: Record<string, MailFolderRole> = {
  inbox: "inbox",
  archive: "archive",
  drafts: "drafts",
  sentitems: "sent",
  junkemail: "junk",
  deleteditems: "trash",
};

/** Managed folders the rail and the worker leave out, with their subtree. */
const HIDDEN = new Set(["outbox"]);

const KEY_PREFIX = "dh-mail-exchange-folders:";

/**
 * Sent on the window when the kept counts of an Exchange mailbox changed,
 * so the folder rail reads its list again (`useMailFolders`). The rail
 * asks nothing by itself after the first read.
 */
export const EXCHANGE_FOLDERS_CHANGED_EVENT = "dh-mail-exchange-folders-changed";

export function notifyExchangeFolders(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(EXCHANGE_FOLDERS_CHANGED_EVENT));
}

/** The tree with new names and counts for some of its folders. */
export function withCounts(state: ExchangeFolderState, fresh: ExchangeFolder[]): ExchangeFolderState {
  const folders = { ...state.folders };
  for (const folder of fresh) {
    if (folders[folder.id]) folders[folder.id] = { ...folders[folder.id], ...folder };
  }
  return { ...state, folders };
}

export function emptyFolderState(): ExchangeFolderState {
  return { syncState: null, wellKnown: {}, folders: {} };
}

export async function readExchangeFolders(email: string): Promise<ExchangeFolderState> {
  const raw = await mailStore().settings.get(KEY_PREFIX + email.toLowerCase()).catch(() => null);
  if (!raw) return emptyFolderState();
  try {
    const parsed = JSON.parse(raw) as Partial<ExchangeFolderState>;
    return {
      syncState: parsed.syncState ?? null,
      wellKnown: parsed.wellKnown ?? {},
      folders: parsed.folders ?? {},
    };
  } catch {
    return emptyFolderState();
  }
}

export async function writeExchangeFolders(email: string, state: ExchangeFolderState): Promise<void> {
  await mailStore().settings.set(KEY_PREFIX + email.toLowerCase(), JSON.stringify(state));
}

/** Forget the kept tree, when the account is removed. */
export async function forgetExchangeFolders(email: string): Promise<void> {
  await writeExchangeFolders(email, emptyFolderState());
}

/** The kept tree with one `SyncFolderHierarchy` result applied. */
export function applyHierarchy(state: ExchangeFolderState, change: ExchangeHierarchy): ExchangeFolderState {
  const folders = { ...state.folders };
  for (const id of change.deleted) delete folders[id];
  for (const folder of change.folders) folders[folder.id] = folder;
  return {
    syncState: change.syncState,
    wellKnown: change.wellKnown ?? state.wellKnown,
    folders,
  };
}

/** EWS name of a well-known folder by its id. */
function wellKnownNames(state: ExchangeFolderState): Map<string, string> {
  return new Map(Object.entries(state.wellKnown).map(([name, id]) => [id, name]));
}

/**
 * The path of a folder: the names from the top of the mailbox. Null for a
 * folder under a hidden one, or under a parent the tree does not have.
 */
function pathOf(state: ExchangeFolderState, names: Map<string, string>, id: string): string | null {
  const root = state.wellKnown.msgfolderroot;
  const parts: string[] = [];
  let at: string | null | undefined = id;
  for (let depth = 0; at && depth < 32; depth += 1) {
    if (at === root) return parts.reverse().join("/");
    if (HIDDEN.has(names.get(at) ?? "")) return null;
    const folder: ExchangeFolder | undefined = state.folders[at];
    // A parent that is not a mail folder (the tree holds none of those).
    if (!folder) return root ? null : parts.reverse().join("/");
    parts.push(folder.name.trim().replace(/\//g, "-"));
    at = folder.parentId;
  }
  return parts.length ? parts.reverse().join("/") : null;
}

/** Every folder the rail shows and the worker reads, inbox first. */
export function exchangeFolderRows(state: ExchangeFolderState): ExchangeFolderRow[] {
  const names = wellKnownNames(state);
  const rows: ExchangeFolderRow[] = [];
  for (const folder of Object.values(state.folders)) {
    const path = pathOf(state, names, folder.id);
    if (!path) continue;
    const role = ROLES[names.get(folder.id) ?? ""];
    rows.push({ id: folder.id, path, ...(role ? { role } : null), total: folder.total, unread: folder.unread });
  }
  return rows.sort((a, b) => Number(b.role === "inbox") - Number(a.role === "inbox") || a.path.localeCompare(b.path));
}

/**
 * The label a folder gives its rows, as `labelFor` in `outlook-sync.ts`:
 * the managed folders their system label, Archive none, and every other
 * folder its path.
 */
export function exchangeLabelFor(row: Pick<ExchangeFolderRow, "role" | "path">): string | null {
  switch (row.role) {
    case "inbox":
      return "INBOX";
    case "sent":
      return "SENT";
    case "drafts":
      return "DRAFT";
    case "trash":
      return "TRASH";
    case "junk":
      return "SPAM";
    case "archive":
      return null;
    default:
      return row.path;
  }
}

/**
 * What the local copy lists for a folder of the rail, by its path. The
 * managed folders' rows wear a system label (`INBOX`, `SENT`, ...), and
 * Archive's none, so a path such as "Archive" finds nothing as a label.
 * Those map to the copy's views; every other folder is its path as a label.
 */
export async function exchangeListTarget(email: string, path: string): Promise<CopyListTarget> {
  const row = exchangeFolderRows(await readExchangeFolders(email)).find(
    (f) => f.path.toLowerCase() === path.trim().toLowerCase()
  );
  return copyListTargetForRole(row?.role, path);
}

