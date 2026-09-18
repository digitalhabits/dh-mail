/**
 * Outlook folders, in the shape the Mail UI wants.
 *
 * The UI keys a folder by one name and treats `/` as nesting, because that is
 * how Gmail writes a nested label. Outlook has a real tree of folders with
 * ids, so this module flattens that tree to `Parent/Child` paths on the way
 * out and resolves a path back to a folder id on the way in.
 *
 * A folder whose own display name contains `/` makes its path ambiguous. Such
 * a folder still lists; only a later lookup by that path can miss, which reads
 * as "Folder not found" and changes nothing in the mailbox.
 */

import "server-only";

import {
  createOutlookMailFolder,
  deleteOutlookMailFolder,
  getOutlookMailFolder,
  listOutlookMailFolders,
  moveOutlookConversation,
  moveOutlookMailFolder,
  renameOutlookMailFolder,
  type GraphMailFolder,
} from "@/lib/outlook/api";
import { outlookAccessTokenFor } from "@/lib/mail/outlook-token";
import {
  isImapNamespaceFolder,
  type MailFolderRole,
} from "@/lib/mail/folder-types";
import { PlanError } from "@/lib/plan/errors";

export type OutlookFolder = {
  /** Full path from the top of the mailbox, `/`-separated. */
  path: string;
  id: string;
  /**
   * Messages in the folder. Gmail counts threads, so a folder shared by both
   * providers can read a little high. Graph has no conversation count.
   */
  count: number;
  /** Set when Outlook manages this folder — see `SYSTEM_SHOWN`. */
  role?: MailFolderRole;
};

/**
 * Folders Outlook manages that the rail shows anyway, under their mailbox.
 *
 * The four views at the top of the rail are every mailbox at once, which is
 * the right thing to reach for most of the time and the wrong thing when
 * the question is "what is in *this* account's sent". Every other mail
 * client lists these under each account, and leaving them out did not make
 * the rail simpler — it made it look like the account was missing folders
 * that plainly exist.
 *
 * The role travels with the folder because the rail treats them unlike the
 * folders somebody made: they sort to the top of their mailbox, and two of
 * them refuse a drop.
 */
const SYSTEM_SHOWN = new Map<string, MailFolderRole>([
  ["inbox", "inbox"],
  ["archive", "archive"],
  ["drafts", "drafts"],
  ["sentitems", "sent"],
  ["junkemail", "junk"],
  ["deleteditems", "trash"],
]);

/**
 * Managed folders the list leaves out, but which keep their children.
 *
 * The inbox was one of these: the list beside the rail is the inbox, so a
 * row for it read as a second way into what was already on screen — while
 * the folders people file under it still had to be shown. That left a
 * stand-in heading with a name and nothing behind it, which could not be
 * opened, dropped onto, or told apart from a folder that had gone missing.
 * It is a folder on the mailbox, like Archive and Sent, and it is listed
 * as one.
 */
const SYSTEM_KEEP_CHILDREN = new Set(["msgfolderroot"]);

/** Managed folders whose whole subtree is noise. */
const SYSTEM_HIDE_SUBTREE = new Set([
  "clutter",
  "conflicts",
  "conversationhistory",
  "localfailures",
  "outbox",
  "recoverableitemsdeletions",
  "scheduled",
  "searchfolders",
  "serverfailures",
  "syncissues",
]);

/**
 * The three folders Exchange keeps under Sync Issues.
 *
 * Asked for separately, and only when Sync Issues itself is there. A mailbox
 * that has never had Outlook for Windows on it has none of the four, and
 * asking anyway put four red 404s in the console every time the folder tree
 * was rebuilt.
 */
const SYNC_ISSUE_CHILDREN = ["conflicts", "localfailures", "serverfailures"];

/**
 * Well-known names to resolve by id when Graph will not return
 * `wellKnownName`. The aliases are locale-independent; display names are not,
 * so a Danish or German mailbox needs this rather than name matching.
 */
const WELL_KNOWN_ALIASES = [
  ...SYSTEM_SHOWN.keys(),
  ...SYSTEM_KEEP_CHILDREN,
  ...SYSTEM_HIDE_SUBTREE,
].filter(
  (name) =>
    name !== "msgfolderroot" &&
    // Sync Issues is asked for on its own, as the gate for its three children.
    name !== "syncissues" &&
    !SYNC_ISSUE_CHILDREN.includes(name)
);

function normalizePath(path: string): string {
  return path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function pathKey(path: string): string {
  return normalizePath(path).toLowerCase();
}

/**
 * Which folders are the ones Outlook manages, by id.
 *
 * Held for far longer than the folder tree is. A folder id does not change,
 * and neither does whether it is the Inbox — so asking again every time the
 * tree is rebuilt was pure repetition. Repetition Graph noticed: a rebuild
 * every thirty seconds, fourteen folder GETs at once each time, and 429 Too
 * Many Requests came back for Inbox and Archive among others. Those are
 * caught and ignored like a missing folder is, so the answer was quietly
 * short of the two folders it most needed.
 */
const WELL_KNOWN_TTL_MS = 60 * 60 * 1000;
const wellKnownCache = new Map<
  string,
  { value: Map<string, string>; expiresAt: number }
>();

/** How a single lookup went. Absent is an answer; refused is not. */
type AliasOutcome = "found" | "absent" | "failed";

/** Ask for a few at a time. Fourteen at once is what drew the throttling. */
const ALIAS_CONCURRENCY = 3;

async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** Map every folder id to its well-known name, for the folders that have one. */
async function wellKnownNameById(
  accessToken: string,
  accountKey: string,
  folders: GraphMailFolder[]
): Promise<Map<string, string>> {
  // The $select carried it: system folders hold a name, user folders null.
  // No requests of our own, so nothing to cache and nothing to throttle.
  if (folders.some((f) => f.wellKnownName !== undefined)) {
    const out = new Map<string, string>();
    for (const f of folders) {
      if (f.wellKnownName) out.set(f.id, f.wellKnownName.toLowerCase());
    }
    return out;
  }

  const cached = wellKnownCache.get(accountKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // It did not. Ask for each alias instead — not every mailbox has them all.
  const out = new Map<string, string>();
  const resolve = async (alias: string): Promise<AliasOutcome> => {
    try {
      const folder = await getOutlookMailFolder(accessToken, alias);
      if (!folder?.id) return "absent";
      out.set(folder.id, alias);
      return "found";
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      // 404 is Graph saying this mailbox has no such folder, which is a real
      // answer. Anything else is no answer at all.
      if (status === 404) return "absent";
      console.warn(`[mail] could not resolve the ${alias} folder:`, err);
      return "failed";
    }
  };

  const outcomes = await inBatches(
    ["syncissues", ...WELL_KNOWN_ALIASES],
    ALIAS_CONCURRENCY,
    resolve
  );
  // Their parent is there, so they may be too. No parent, no children.
  if (outcomes[0] === "found") {
    outcomes.push(
      ...(await inBatches(SYNC_ISSUE_CHILDREN, ALIAS_CONCURRENCY, resolve))
    );
  }

  // Only keep an answer that is whole. Half of one would hide the wrong
  // folders for an hour, and the next rebuild is thirty seconds away.
  if (!outcomes.includes("failed")) {
    wellKnownCache.set(accountKey, {
      value: out,
      expiresAt: Date.now() + WELL_KNOWN_TTL_MS,
    });
  }
  return out;
}

/**
 * A folder plus whether the list shows it. Managed folders keep their entry so
 * a path like `Inbox/Family` still resolves to the real Inbox.
 */
type FolderEntry = OutlookFolder & { hidden: boolean };

/** Flatten the tree, marking the folders Outlook manages. */
function toFolderPaths(
  folders: GraphMailFolder[],
  systemNames: Map<string, string>
): FolderEntry[] {
  const byId = new Map(folders.map((f) => [f.id, f]));

  /** Path from the top, including managed ancestors like `Inbox`. */
  const pathOf = (folder: GraphMailFolder): string | null => {
    const parts: string[] = [];
    let current: GraphMailFolder | undefined = folder;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current.id)) return null; // defensive: cyclic parent
      seen.add(current.id);
      const wellKnown = systemNames.get(current.id);
      if (wellKnown === "msgfolderroot") break;
      const name = current.displayName?.trim();
      if (!name) return null;
      parts.unshift(name);
      const parentId: string | undefined = current.parentFolderId;
      current = parentId ? byId.get(parentId) : undefined;
    }
    return parts.join("/") || null;
  };

  const hidden = (folder: GraphMailFolder): boolean => {
    let current: GraphMailFolder | undefined = folder;
    let self = true;
    const seen = new Set<string>();
    while (current) {
      if (seen.has(current.id)) return true;
      seen.add(current.id);
      const wellKnown = systemNames.get(current.id);
      if (wellKnown) {
        if (SYSTEM_HIDE_SUBTREE.has(wellKnown)) return true;
        // Managed, but its children are real folders.
        if (self && SYSTEM_KEEP_CHILDREN.has(wellKnown)) return true;
      }
      self = false;
      const parentId: string | undefined = current.parentFolderId;
      current = parentId ? byId.get(parentId) : undefined;
    }
    return false;
  };

  const out: FolderEntry[] = [];
  for (const folder of folders) {
    const path = pathOf(folder);
    if (!path) continue;
    // The whole subtree goes, the container and everything under it. What
    // is under it is Gmail's bin and drafts wearing IMAP names, and the
    // Mail UI reaches all of those its own way.
    const namespaced = isImapNamespaceFolder(path);
    const wellKnown = systemNames.get(folder.id);
    out.push({
      path,
      id: folder.id,
      count: folder.totalItemCount ?? 0,
      role: wellKnown ? SYSTEM_SHOWN.get(wellKnown) : undefined,
      hidden: namespaced || hidden(folder),
    });
  }
  return out;
}

/**
 * Walking the tree costs one Graph request per level, so hold it briefly.
 * Every write here clears the account, and the merged folder list in
 * `@/lib/mail/folders` keeps its own longer cache on top.
 */
const TREE_CACHE_TTL_MS = 30 * 1000;
const treeCache = new Map<
  string,
  { value: FolderEntry[]; expiresAt: number }
>();

function forgetTree(accountEmail: string): void {
  const key = accountEmail.trim().toLowerCase();
  treeCache.delete(key);
  // A folder has been made, renamed or moved, so which ones Outlook manages
  // is worth asking about again.
  wellKnownCache.delete(key);
}

async function loadFolderTree(accountEmail: string): Promise<FolderEntry[]> {
  const key = accountEmail.trim().toLowerCase();
  const cached = treeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const token = await outlookAccessTokenFor(accountEmail);
  const folders = await listOutlookMailFolders(token, key);
  const systemNames = await wellKnownNameById(token, key, folders);
  const value = toFolderPaths(folders, systemNames);
  treeCache.set(key, { value, expiresAt: Date.now() + TREE_CACHE_TTL_MS });
  return value;
}

/** Every user folder on the mailbox, as `Parent/Child` paths. */
export async function listOutlookFolders(
  accountEmail: string
): Promise<OutlookFolder[]> {
  const tree = await loadFolderTree(accountEmail);
  return tree
    .filter((f) => !f.hidden)
    .map(({ path, id, count, role }) => ({ path, id, count, role }));
}

/**
 * Resolve a path to a folder. Managed folders match too, so `Inbox/Family`
 * finds the folder people actually filed under their inbox.
 */
export async function findOutlookFolder(
  accountEmail: string,
  path: string
): Promise<OutlookFolder | null> {
  const key = pathKey(path);
  if (!key) return null;
  const tree = await loadFolderTree(accountEmail);
  const hit = tree.find((f) => pathKey(f.path) === key);
  return hit ? { path: hit.path, id: hit.id, count: hit.count } : null;
}

/**
 * Find a folder by path, creating any missing part of it.
 * `Clients/2026` under a mailbox with neither creates both.
 */
export async function ensureOutlookFolder(
  accountEmail: string,
  path: string
): Promise<OutlookFolder> {
  const wanted = normalizePath(path);
  if (!wanted) throw new PlanError("Folder name is required", 400);

  const token = await outlookAccessTokenFor(accountEmail);
  let known = await loadFolderTree(accountEmail);
  const segments = wanted.split("/");

  let parentId: string | undefined;
  let walked = "";
  let current: OutlookFolder | null = null;
  let created = false;

  for (const segment of segments) {
    walked = walked ? `${walked}/${segment}` : segment;
    const key = pathKey(walked);
    const hit = known.find((f) => pathKey(f.path) === key);
    if (hit) {
      parentId = hit.id;
      current = { path: hit.path, id: hit.id, count: hit.count };
      continue;
    }
    const made = await createOutlookMailFolder(token, segment, parentId);
    current = { path: walked, id: made.id, count: 0 };
    known = [...known, { ...current, hidden: false }];
    parentId = made.id;
    created = true;
  }

  if (created) forgetTree(accountEmail);
  if (!current) throw new PlanError("Folder name is required", 400);
  return current;
}

/**
 * Rename a folder, or re-parent it when the path above the leaf changes.
 * Returns false when the mailbox has no such folder.
 */
export async function renameOutlookFolder(
  accountEmail: string,
  from: string,
  to: string
): Promise<boolean> {
  const source = await findOutlookFolder(accountEmail, from);
  if (!source) return false;

  const target = normalizePath(to);
  const segments = target.split("/");
  const leaf = segments[segments.length - 1];
  const parentPath = segments.slice(0, -1).join("/");
  const sourceParent = normalizePath(from).split("/").slice(0, -1).join("/");

  const token = await outlookAccessTokenFor(accountEmail);
  if (pathKey(parentPath) !== pathKey(sourceParent)) {
    const parent = parentPath
      ? await ensureOutlookFolder(accountEmail, parentPath)
      : null;
    // Graph has no "move to the top" id, so re-parenting to the root needs
    // the mailbox root itself.
    const destination = parent
      ? parent.id
      : (await getOutlookMailFolder(token, "msgfolderroot")).id;
    await moveOutlookMailFolder(token, source.id, destination);
  }
  const sourceLeaf = normalizePath(from).split("/").pop() ?? "";
  if (sourceLeaf.toLowerCase() !== leaf.toLowerCase()) {
    await renameOutlookMailFolder(token, source.id, leaf);
  }
  forgetTree(accountEmail);
  return true;
}

/** Delete a folder, or report that this mailbox has no such folder. */
export async function deleteOutlookFolder(
  accountEmail: string,
  path: string
): Promise<boolean> {
  const found = await findOutlookFolder(accountEmail, path);
  if (!found) return false;
  const token = await outlookAccessTokenFor(accountEmail);
  await deleteOutlookMailFolder(token, found.id);
  forgetTree(accountEmail);
  return true;
}

/** File a whole conversation into a folder. */
export async function moveOutlookThreadToFolder(
  accountEmail: string,
  threadId: string,
  folderId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(accountEmail);
  await moveOutlookConversation(token, threadId, folderId);
  forgetTree(accountEmail); // counts moved
}

/** Undo of the move: back to the inbox. */
export async function moveOutlookThreadToInbox(
  accountEmail: string,
  threadId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(accountEmail);
  await moveOutlookConversation(token, threadId, "inbox");
  forgetTree(accountEmail);
}
