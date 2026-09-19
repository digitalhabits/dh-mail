import { applyLocalAction, localStoreServes, queueLocalAction } from "@/lib/mail/local-store";
import { wakeOutlookSync } from "@/lib/mail/outlook-sync";
import { mailStore } from "@/lib/mail/store";
import "server-only";

import {
  createGmailLabel,
  countThreadsForLabel,
  deleteGmailLabel,
  gmailLabelSearchQuery,
  listGmailLabels,
  modifyThreadLabels,
  renameGmailLabel,
  type GmailLabel,
  isGmailRateLimit,
} from "@/lib/gmail/api";
import {
  filterAccountsForScope,
  type MailAccountScope,
} from "@/lib/mail/account-scope";
import {
  isImapNamespaceFolder,
  mergeFoldersByName,
  type MailAccountFolder,
  type MailFolder,
  type MailFolderRole,
} from "@/lib/mail/folder-types";
import {
  invalidateInboxCache,
  registerInboxListCacheClear,
} from "@/lib/mail/inbox-cache";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import {
  deleteOutlookFolder,
  ensureOutlookFolder,
  findOutlookFolder,
  listOutlookFolders,
  moveOutlookThreadToFolder,
  moveOutlookThreadToInbox,
  renameOutlookFolder,
} from "@/lib/mail/outlook-folders";
import {
  listConnectedMailAccounts,
  resolveMailProvider,
  type ConnectedMailAccount,
} from "@/lib/mail/providers";
import { PlanError } from "@/lib/plan/errors";

/**
 * As far as a folder count is counted. Past this the number stops meaning
 * anything a reader can act on, and the list it describes is capped too.
 */
const FOLDER_COUNT_CAP = 500;

/** Process-warm folder list (names + counts). Cleared with inbox list cache. */
const FOLDER_CACHE_TTL_MS = 2 * 60 * 1000;
const LABEL_GET_CONCURRENCY = 4;
type FolderCacheEntry = { value: MailAccountFolder[]; expiresAt: number };
const folderListCache = new Map<string, FolderCacheEntry>();
registerInboxListCacheClear(() => {
  folderListCache.clear();
});

function folderCacheKey(options: {
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
}): string {
  return [
    options.clerkUserId,
    options.scope ?? "all",
    options.account ?? "all",
  ].join("\0");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function translateGmailError(err: unknown, accountEmail: string): never {
  const status = (err as Error & { status?: number }).status;
  if (status === 403 && isGmailRateLimit(err)) {
    throw new PlanError(
      `Gmail is over its request limit for ${accountEmail}. Try again in a minute.`,
      429
    );
  }
  if (status === 403) {
    throw new PlanError(
      `The Gmail connection for ${accountEmail} is read-only — reconnect the account to enable folders.`,
      403
    );
  }
  throw err;
}

function translateOutlookError(err: unknown, accountEmail: string): never {
  const status = (err as Error & { status?: number }).status;
  if (status === 403) {
    throw new PlanError(
      `The Outlook connection for ${accountEmail} is read-only — reconnect the account to enable folders.`,
      403
    );
  }
  throw err;
}

function normalizeFolderName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Hide Gmail system / category labels from the folder UI. */
function isUserFolderLabel(label: GmailLabel): boolean {
  // A label somebody's IMAP client or mail import left behind. Gmail hands
  // these over as ordinary user labels, and its own sidebar does not show
  // them. See `isImapNamespaceFolder`.
  if (isImapNamespaceFolder(label.name ?? "")) return false;
  if (label.type === "system") return false;
  if (label.type === "user") return true;
  // Defensive: some responses omit type; drop known system ids.
  const id = label.id.toUpperCase();
  return !(
    id === "INBOX" ||
    id === "SENT" ||
    id === "DRAFT" ||
    id === "TRASH" ||
    id === "SPAM" ||
    id === "STARRED" ||
    id === "IMPORTANT" ||
    id === "UNREAD" ||
    id === "CHAT" ||
    id.startsWith("CATEGORY_")
  );
}

async function accountsInScope(options: {
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
}): Promise<ConnectedMailAccount[]> {
  const scope = options.scope ?? "all";
  const all = filterAccountsForScope(
    await listConnectedMailAccounts(options.clerkUserId),
    scope
  );
  return all.filter((a) => !options.account || a.email === options.account);
}

async function userLabelsForAccount(
  accountEmail: string,
  includeCounts: boolean
): Promise<GmailLabel[]> {
  const token = await accessTokenFor(accountEmail);
  const listed = await listGmailLabels(token);
  const userLabels = listed.filter(isUserFolderLabel);
  if (!includeCounts) return userLabels;
  // The copy counts its own labels in one query, where the API needed a
  // search per label.
  if (await localStoreServes(accountEmail)) {
    const counts = new Map(
      (await mailStore().messages.labelCounts(accountEmail)).map((c) => [c.label, c.threads])
    );
    return userLabels.map((label) => ({ ...label, threadsTotal: counts.get(label.name) ?? 0 }));
  }
  // Counted by searching the label, not by reading `threadsTotal` off it.
  // The label's own total counts threads in Spam and Trash, which no list
  // here shows — so a folder said 225 and opened on 1.
  return mapWithConcurrency(
    userLabels,
    LABEL_GET_CONCURRENCY,
    async (label) => {
      try {
        const { count, atCap } = await countThreadsForLabel(
          token,
          label.name,
          FOLDER_COUNT_CAP
        );
        return { ...label, threadsTotal: count, countAtCap: atCap };
      } catch {
        return label;
      }
    }
  );
}

/** Folder names on one account, whichever provider it is. */
async function foldersForAccount(
  account: ConnectedMailAccount,
  includeCounts: boolean
): Promise<
  {
    name: string;
    count: number;
    role?: MailFolderRole;
    virtual?: boolean;
  }[]
> {
  if (account.provider === "outlook") {
    // Graph returns the count with the folder, so `includeCounts` saves
    // nothing here — unlike Gmail, which needs a get per label.
    const folders = await listOutlookFolders(account.email);
    return folders.map((f) => ({
      name: f.path,
      count: includeCounts ? f.count : 0,
      role: f.role,
    }));
  }
  const labels = await userLabelsForAccount(account.email, includeCounts);
  return [
    // Gmail has no folder for any of these, so they are rows standing for a
    // search rather than labels — see `virtual` on MailAccountFolder.
    //
    // "Archived" and not "All Mail". All Mail is everything Gmail holds,
    // the inbox included, so a row under that name would list the inbox
    // back at the reader. Archived is what has actually been archived,
    // which is the same thing the Archive folder means on an Outlook
    // account — one word meaning one thing on every mailbox in the rail.
    //
    // No Drafts. A draft is opened to be written, not read, and the app has
    // a Drafts view that does that; a folder listing them read-only would
    // be a second way in that does less than the first.
    ...GMAIL_VIEW_ROWS,
    ...labels.map((label) => ({
      name: label.name.trim(),
      count: includeCounts ? (label.threadsTotal ?? 0) : 0,
    })),
  ];
}

/**
 * The rows a Gmail account shows above its own labels.
 *
 * Counted as nothing on purpose: a badge here would cost a search of the
 * whole mailbox per account per refresh, and none of the three is a number
 * anybody acts on the way they act on "Blocked: 41".
 */
const GMAIL_VIEW_ROWS: {
  name: string;
  count: number;
  role: MailFolderRole;
  virtual: true;
}[] = [
  { name: "Inbox", count: 0, role: "inbox", virtual: true },
  { name: "Sent", count: 0, role: "sent", virtual: true },
  { name: "Archived", count: 0, role: "archive", virtual: true },
  // Gmail keeps drafts as a label nobody can list by name, so this row is
  // the drafts view narrowed to this account — the same rows the Drafts
  // view at the head of the rail shows, from one mailbox. Outlook has a
  // real Drafts folder and has always shown one; this is the other half of
  // being able to say "the same six under every account".
  { name: "Drafts", count: 0, role: "drafts", virtual: true },
  { name: "Junk", count: 0, role: "junk", virtual: true },
  // "Trash", not Gmail's own word for it. The rail says Trash at its head
  // and the move menu says Trash, and one list calling it a bin was the
  // app saying two things about one place.
  { name: "Trash", count: 0, role: "trash", virtual: true },
];

async function listMailFoldersUncached(options: {
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
  includeCounts: boolean;
}): Promise<MailAccountFolder[]> {
  const accounts = await accountsInScope(options);
  const rows: MailAccountFolder[] = [];

  await Promise.all(
    accounts.map(async (account) => {
      try {
        const folders = await foldersForAccount(
          account,
          options.includeCounts
        );
        for (const { name, count, role, virtual } of folders) {
          if (!name) continue;
          rows.push({ account: account.email, name, count, role, virtual });
        }
      } catch (err) {
        console.warn(
          `[mail] folder list failed for ${account.email}:`,
          err
        );
      }
    })
  );

  // By account first, then by name. The rail draws one headed section per
  // account, so the order it needs is the order it is given — and the menu
  // that still wants one merged list folds these together itself.
  return rows.sort(
    (a, b) =>
      a.account.localeCompare(b.account, undefined, { sensitivity: "base" }) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/**
 * Every folder, on every account in scope, one row each.
 *
 * Not merged by name. Two accounts with an Archive have two Archives, and a
 * conversation files into the one on its own account — so the rail shows
 * them apart, and anything that wants the old single list folds them
 * together with `mergeFoldersByName`.
 *
 * Warm process cache holds the counted list for a few minutes.
 * `includeCounts: false` skips per-label Gmail gets (names only).
 */
export async function listMailFolders(options: {
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
  includeCounts?: boolean;
}): Promise<MailAccountFolder[]> {
  const includeCounts = options.includeCounts !== false;
  const key = folderCacheKey(options);
  const cached = folderListCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // Names-only callers still benefit from a warm counted cache.
    return cached.value;
  }

  const folders = await listMailFoldersUncached({
    ...options,
    includeCounts,
  });

  if (includeCounts) {
    folderListCache.set(key, {
      value: folders,
      expiresAt: Date.now() + FOLDER_CACHE_TTL_MS,
    });
  }
  return folders;
}

async function findLabelByName(
  accountEmail: string,
  name: string
): Promise<GmailLabel | null> {
  const token = await accessTokenFor(accountEmail);
  const listed = await listGmailLabels(token);
  const needle = name.toLowerCase();
  return (
    listed.find(
      (l) => isUserFolderLabel(l) && l.name.trim().toLowerCase() === needle
    ) ?? null
  );
}

async function ensureLabelOnAccount(
  accountEmail: string,
  name: string
): Promise<GmailLabel> {
  const existing = await findLabelByName(accountEmail, name);
  if (existing) return existing;
  const token = await accessTokenFor(accountEmail);
  try {
    return await createGmailLabel(token, name);
  } catch (err) {
    translateGmailError(err, accountEmail);
  }
}

/** Create a folder (user label) on every in-scope account. */
export async function createMailFolder(input: {
  name: string;
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
}): Promise<MailFolder> {
  const name = normalizeFolderName(input.name);
  if (!name) throw new PlanError("Folder name is required", 400);
  if (name.length > 100) throw new PlanError("Folder name is too long", 400);

  const accounts = await accountsInScope(input);
  if (!accounts.length) throw new PlanError("No mail accounts connected", 400);

  for (const account of accounts) {
    if (account.provider === "outlook") {
      try {
        // Creates each missing part of a nested path.
        await ensureOutlookFolder(account.email, name);
      } catch (err) {
        translateOutlookError(err, account.email);
      }
      continue;
    }
    const existing = await findLabelByName(account.email, name);
    if (existing) continue;
    await ensureLabelOnAccount(account.email, name);
  }
  // A folder that already existed everywhere still succeeds, so the UI can
  // open it.
  invalidateInboxCache();
  // Merged: the caller is given the folder as a view, and a view of it is
  // everything in it on every account.
  const folders = mergeFoldersByName(await listMailFolders(input));
  const hit = folders.find((f) => f.name.toLowerCase() === name.toLowerCase());
  return hit ?? { name, count: 0 };
}

/**
 * Delete a folder.
 *
 * What that costs differs by provider, and the UI says so before asking.
 * A Gmail label is a name on conversations: taking it off leaves every one
 * of them where it was, in All Mail. An Outlook folder is a place, so Graph
 * puts the folder in Deleted Items with its mail and its child folders
 * inside it — recoverable from there, but gone from where it was.
 *
 * On the named account only. Without one this would delete the folder on
 * every mailbox that happens to share its name.
 */
export async function deleteMailFolder(input: {
  name: string;
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
}): Promise<{ name: string }> {
  const name = normalizeFolderName(input.name);
  if (!name) throw new PlanError("Folder name is required", 400);

  const accounts = await accountsInScope(input);
  if (!accounts.length) throw new PlanError("No mail accounts connected", 400);

  let deleted = false;
  for (const account of accounts) {
    if (account.provider === "outlook") {
      try {
        if (await deleteOutlookFolder(account.email, name)) deleted = true;
      } catch (err) {
        translateOutlookError(err, account.email);
      }
      continue;
    }
    const existing = await findLabelByName(account.email, name);
    if (!existing) continue;
    try {
      await deleteGmailLabel(await accessTokenFor(account.email), existing.id);
      deleted = true;
    } catch (err) {
      translateGmailError(err, account.email);
    }
  }

  if (!deleted) throw new PlanError("Folder not found", 404);
  invalidateInboxCache();
  return { name };
}

/** Rename a folder across accounts that share the name. */
export async function renameMailFolder(input: {
  name: string;
  newName: string;
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
}): Promise<MailFolder> {
  const from = normalizeFolderName(input.name);
  const to = normalizeFolderName(input.newName);
  if (!from || !to) throw new PlanError("Folder name is required", 400);
  if (from.toLowerCase() === to.toLowerCase()) {
    return { name: to, count: 0 };
  }

  const accounts = await accountsInScope(input);
  let renamed = 0;
  for (const account of accounts) {
    const email = account.email;
    if (account.provider === "outlook") {
      if (!(await findOutlookFolder(email, from))) continue;
      if (await findOutlookFolder(email, to)) {
        throw new PlanError(
          `A folder named “${to}” already exists on ${email}`,
          400
        );
      }
      try {
        // A new path above the leaf re-parents the folder, as it would on
        // Gmail, where the path is the label name.
        if (await renameOutlookFolder(email, from, to)) renamed += 1;
      } catch (err) {
        translateOutlookError(err, email);
      }
      continue;
    }
    const label = await findLabelByName(email, from);
    if (!label) continue;
    const conflict = await findLabelByName(email, to);
    if (conflict) {
      throw new PlanError(
        `A folder named “${to}” already exists on ${email}`,
        400
      );
    }
    const token = await accessTokenFor(email);
    try {
      await renameGmailLabel(token, label.id, to);
      renamed += 1;
    } catch (err) {
      translateGmailError(err, email);
    }
  }
  if (!renamed) throw new PlanError("Folder not found", 404);
  invalidateInboxCache();
  const folders = mergeFoldersByName(
    await listMailFolders({
      account: input.account,
      scope: input.scope,
      clerkUserId: input.clerkUserId,
    })
  );
  const hit = folders.find((f) => f.name.toLowerCase() === to.toLowerCase());
  return hit ?? { name: to, count: 0 };
}

/**
 * File a thread into a folder. On Gmail this applies the label and removes
 * INBOX (same end state as “label + archive”). On Outlook it moves every
 * message of the conversation into the folder — UI stays identical either way.
 */
/**
 * File a conversation in a folder.
 *
 * `movedOut` says whether it left where it was. Outlook keeps a message in one
 * folder, so a move is a move. Gmail adds a label and takes away Inbox, and
 * every other label the thread had stays on it — so a thread moved out of one
 * folder into another is still in the first one, and the first one's number
 * must not go down.
 */
export async function moveMailThreadToFolder(input: {
  account: string;
  threadId: string;
  folderName: string;
  /** Create the folder on this account if missing. */
  create?: boolean;
}): Promise<{ folderName: string; movedOut: boolean }> {
  const name = normalizeFolderName(input.folderName);
  if (!name) throw new PlanError("Folder name is required", 400);

  if (
    await queueLocalAction(input.account, input.threadId, "move", {
      label: name,
      create: Boolean(input.create),
    })
  ) {
    invalidateInboxCache();
    return { folderName: name, movedOut: false };
  }

  if ((await resolveMailProvider(input.account)) === "outlook") {
    let folder = await findOutlookFolder(input.account, name);
    if (!folder) {
      if (!input.create) throw new PlanError("Folder not found", 404);
      folder = await ensureOutlookFolder(input.account, name);
    }
    try {
      await moveOutlookThreadToFolder(input.account, input.threadId, folder.id);
    } catch (err) {
      translateOutlookError(err, input.account);
    }
    /*
      The copy is told now, as it is for archive, junk and trash. The folder's
      own view reads the copy, and without this the mail was in that view only
      after the next walk of every folder, up to a minute later. The label of
      an Outlook folder in the copy is its path.
    */
    await applyLocalAction(input.account, input.threadId, "move", { label: folder.path });
    wakeOutlookSync(input.account);
    invalidateInboxCache();
    return { folderName: folder.path, movedOut: true };
  }

  let label = await findLabelByName(input.account, name);
  if (!label) {
    if (!input.create) throw new PlanError("Folder not found", 404);
    label = await ensureLabelOnAccount(input.account, name);
  }

  const token = await accessTokenFor(input.account);
  try {
    await modifyThreadLabels(token, input.threadId, {
      addLabelIds: [label.id],
      removeLabelIds: ["INBOX"],
    });
  } catch (err) {
    translateGmailError(err, input.account);
  }
  invalidateInboxCache();
  return { folderName: label.name, movedOut: false };
}

/** Undo of move: strip the folder label and put the thread back in the inbox. */
export async function unmoveMailThreadFromFolder(input: {
  account: string;
  threadId: string;
  folderName: string;
}): Promise<void> {
  const name = normalizeFolderName(input.folderName);

  if (await queueLocalAction(input.account, input.threadId, "unmove", { label: name })) {
    invalidateInboxCache();
    return;
  }

  if ((await resolveMailProvider(input.account)) === "outlook") {
    try {
      await moveOutlookThreadToInbox(input.account, input.threadId);
    } catch (err) {
      translateOutlookError(err, input.account);
    }
    // Back in the inbox of the copy at once, for the same reason as above.
    const folder = name ? await findOutlookFolder(input.account, name).catch(() => null) : null;
    await applyLocalAction(input.account, input.threadId, "unmove", { label: folder?.path ?? name });
    wakeOutlookSync(input.account);
    invalidateInboxCache();
    return;
  }

  const label = name ? await findLabelByName(input.account, name) : null;
  const token = await accessTokenFor(input.account);
  try {
    await modifyThreadLabels(token, input.threadId, {
      addLabelIds: ["INBOX"],
      removeLabelIds: label ? [label.id] : [],
    });
  } catch (err) {
    translateGmailError(err, input.account);
  }
  invalidateInboxCache();
}

export { gmailLabelSearchQuery };
