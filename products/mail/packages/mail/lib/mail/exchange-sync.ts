/**
 * The local copy of an Exchange (EWS) mailbox, kept by EWS sync states.
 *
 * On the plan of `outlook-sync.ts`. One pass reads the folder list
 * (`SyncFolderHierarchy`), then each folder's changes (`SyncFolderItems`),
 * inbox first: the whole folder the first time, the changes since the last
 * sync state after that. The rows go into the same tables the Gmail and
 * Outlook workers fill. The bodies come later, when a thread is opened
 * (`local-thread.ts`). The EWS calls and the XML are in Rust
 * (`mail-native/src/ews_read.rs`); this file decides what to ask and when,
 * and writes the rows.
 *
 * Phase 2 of `docs/mail-exchange-ews.md` reads only. The error rules are
 * section 4.7: a refused password stops the worker at once, because many
 * failed sign-ins can lock the account.
 */

import {
  exchangeErrorCode,
  exchangeFolderCounts,
  newestExchangeItems,
  syncExchangeItems,
  syncExchangeHierarchy,
  type ExchangeItemRow,
} from "@/lib/mail/exchange-native";
import {
  applyHierarchy,
  emptyFolderState,
  exchangeFolderRows,
  exchangeLabelFor,
  notifyExchangeFolders,
  readExchangeFolders,
  withCounts,
  writeExchangeFolders,
  type ExchangeFolderRow,
  type ExchangeFolderState,
} from "@/lib/mail/exchange-folders";
import { fillExchangeBodies } from "@/lib/mail/exchange-bodies";
import { wakeExchangeSnoozes } from "@/lib/mail/exchange-snooze";
import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { notifySyncChanged, notifySyncState } from "@/lib/mail/local-store";
import { mailStore } from "@/lib/mail/store";
import type { MailStoredMessage, MailSyncState } from "@/lib/mail/store/types";

/*
  How often the server is asked. Slower than Outlook: KU's server is not
  Microsoft's cloud, and KU IT must not see load from this app (section 4.2).
  Thunderbird checks every ten minutes by default.
*/
export const INBOX_EVERY_MS = 60_000;
export const ALL_EVERY_MS = 300_000;
/** The Outlook worker's back-off list, for a network error or a busy server. */
export const BACKOFF_MS = [10_000, 30_000, 60_000, 300_000];
/** More pages than this in one folder in one pass means a loop. */
const MAX_PAGES = 5_000;

type Worker = {
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  current: Promise<void> | null;
  stop: boolean;
  failures: number;
  /** When every folder was last walked; 0 asks for all of them next. */
  lastAll: number;
};
const workers = new Map<string, Worker>();

export function startExchangeSync(account: string): boolean {
  const email = account.trim().toLowerCase();
  if (workers.has(email)) return false;
  workers.set(email, { timer: null, running: false, current: null, stop: false, failures: 0, lastAll: 0 });
  runSoon(email, 0);
  return true;
}

/** Stop, and wait for a pass under way to end. */
export async function stopExchangeSync(account: string): Promise<void> {
  const email = account.trim().toLowerCase();
  const worker = workers.get(email);
  if (!worker) return;
  worker.stop = true;
  if (worker.timer != null) clearTimeout(worker.timer);
  workers.delete(email);
  await worker.current?.catch(() => undefined);
}

/** Look at the server now rather than at the next tick. */
export function wakeExchangeSync(account: string, scope: "all" | "inbox" = "all"): void {
  const worker = workers.get(account.trim().toLowerCase());
  if (!worker) return;
  if (scope === "all") worker.lastAll = 0;
  runSoon(account.trim().toLowerCase(), 500);
}

export function exchangeSyncRunning(): string[] {
  return [...workers.keys()].sort();
}

function runSoon(email: string, delay: number): void {
  const worker = workers.get(email);
  if (!worker || worker.stop) return;
  if (worker.timer != null) clearTimeout(worker.timer);
  worker.timer = setTimeout(() => {
    worker.timer = null;
    void pass(email);
  }, delay);
}

async function pass(email: string): Promise<void> {
  const worker = workers.get(email);
  if (!worker || worker.stop || worker.running) return;
  worker.running = true;
  const all = Date.now() - worker.lastAll >= ALL_EVERY_MS;
  const run = syncMailbox(email, all ? "all" : "inbox", worker);
  worker.current = run;
  try {
    await run;
    if (all) worker.lastAll = Date.now();
    worker.failures = 0;
    runSoon(email, INBOX_EVERY_MS);
    // The bodies of the last year, slowly, beside the passes (section 14.2).
    void fillExchangeBodies(email, () => worker.stop || !workers.has(email));
    // Snoozed threads whose time came go back to the inbox (section 16.3).
    void wakeExchangeSnoozes(email).catch((err: unknown) => console.warn(`[mail] ${email}: snooze wake:`, err));
  } catch (err) {
    await failed(email, worker, err instanceof Error ? err.message : String(err));
  } finally {
    worker.running = false;
    worker.current = null;
  }
}

/** What to do after an error, by section 4.7. Null: stop, no retry. */
export function retryAfter(message: string, failures: number): number | null {
  const code = exchangeErrorCode(message);
  // The password is wrong or gone. A second try with it counts as a second
  // failed sign-in, and enough of those lock the account.
  if (code === "ews:refused" || code === "ews:no-account") return null;
  const backOff = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)];
  if (code === "ews:busy") {
    const said = Number(message.match(/after (\d+) ms/)?.[1] ?? NaN);
    return Number.isFinite(said) && said > 0 ? said : backOff;
  }
  return backOff;
}

async function failed(email: string, worker: Worker, reason: string): Promise<void> {
  console.warn(`[mail-sync] ${email}: ${reason}`);
  const wait = retryAfter(reason, worker.failures);
  const prior = await overallRow(email);
  await publish({
    ...prior,
    account: email,
    folder: "",
    phase: "paused",
    // The list offers Reconnect for "needs reconnect" (sync-pause.ts).
    lastError: wait === null ? `needs reconnect: ${reason}` : reason,
  });
  if (wait === null) {
    // Stopped until a new connect, which starts a new worker.
    workers.delete(email);
    return;
  }
  worker.failures += 1;
  runSoon(email, wait);
}

/** The mailbox's own row, as the store holds it now. */
async function overallRow(email: string): Promise<MailSyncState | undefined> {
  const states = await mailStore().sync.list().catch(() => [] as MailSyncState[]);
  return (Array.isArray(states) ? states : []).find((s) => s.account === email && s.folder === "");
}

/** True for the fault a sync state that the server no longer takes gives. */
export function isBadSyncState(message: string): boolean {
  return message.startsWith("ews:fault: ErrorInvalidSyncStateData");
}

/**
 * The folder tree, brought up to date. A sync state the server no longer
 * takes is dropped, and the whole tree is read again (section 4.7).
 */
async function syncFolderTree(email: string, state: ExchangeFolderState): Promise<ExchangeFolderState> {
  let change;
  let base = state;
  try {
    change = await syncExchangeHierarchy(email, state.syncState);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!state.syncState || !isBadSyncState(message)) throw err;
    console.warn(`[mail-sync] ${email}: the folder sync state is no longer good; reading the folder list again`);
    base = emptyFolderState();
    change = await syncExchangeHierarchy(email, null);
  }
  const next = applyHierarchy(base, change);
  await writeExchangeFolders(email, next);
  return next;
}

async function syncMailbox(email: string, scope: "all" | "inbox", worker: Worker): Promise<void> {
  let tree = await readExchangeFolders(email);
  if (scope === "all" || !Object.keys(tree.folders).length) tree = await syncFolderTree(email, tree);
  const rows = exchangeFolderRows(tree);
  const folders = scope === "inbox" ? rows.filter((f) => f.role === "inbox") : rows;
  const states = await mailStore().sync.list();
  const progress = await startProgress(email, scope, folders, states);
  const changed: string[] = [];
  for (const folder of folders) {
    if (worker.stop) return;
    const state = states.find((s) => s.account === email && s.folder === folder.id);
    if (await syncFolder(email, folder, state?.deltaLink ?? null, worker, progress)) changed.push(folder.id);
  }
  if (worker.stop) return;
  await refreshCounts(email, changed, scope === "all");
  if (scope === "all") {
    const whole = progress ? Math.max(progress.total, progress.done) : undefined;
    await publish({ account: email, folder: "", phase: "live", fullSyncTotal: whole, fullSyncDone: whole, lastOkAt: Date.now() });
  }
  if (changed.length) {
    invalidateInboxCache();
    notifySyncChanged(email);
  }
}

/**
 * New counts for the folders a pass changed (section 12.3). Without this
 * the rail showed the counts of the last 5-minute pass. A failure here is
 * not a failed pass: the counts come again with the next one.
 */
async function refreshCounts(email: string, changed: string[], treeRead: boolean): Promise<void> {
  if (!changed.length && !treeRead) return;
  const fresh = changed.length ? await exchangeFolderCounts(email, changed).catch(() => []) : [];
  if (fresh.length) await writeExchangeFolders(email, withCounts(await readExchangeFolders(email), fresh));
  notifyExchangeFolders();
}

type Progress = { total: number; done: number };

/*
  The newest mail of an inbox, before the read of the whole of it.

  SyncFolderItems goes through a folder in the server's own order, and EWS
  does not say which; on some servers it is oldest first, and an inbox of
  fifty thousand would show its newest mail last. So a first read of the
  inbox starts with the newest HEAD_START, newest first (FindItem), which
  the list shows at once. No work is done twice: the full read is told
  each of these rows' change keys, and a row whose key has not changed is
  not read again. A head start that fails is only a slower start.
*/
const HEAD_START = 200;
async function headStart(
  email: string,
  folder: ExchangeFolderRow,
  label: string | null
): Promise<Record<string, string> | undefined> {
  try {
    const newest = await newestExchangeItems(email, folder.id, HEAD_START);
    if (!newest.items.length) return undefined;
    await storePage(email, newest.items, [], label);
    lastShown.delete(email);
    showFirstReadRows(email);
    return newest.keys;
  } catch (err) {
    console.warn(`[mail-sync] ${email}: the newest mail could not be read first: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

/*
  The list, told as the first read brings mail in.

  An Exchange mailbox lists from the copy alone, and the list was told to
  read it again only at the end of a pass. On a first read that is the end
  of every folder: a mailbox of fifty thousand showed nothing for as long
  as the whole read took. Now the list reads again as pages land, at most
  every few seconds.
*/
const SHOW_EVERY_MS = 3_000;
const lastShown = new Map<string, number>();
function showFirstReadRows(email: string): void {
  const now = Date.now();
  if (now - (lastShown.get(email) ?? 0) < SHOW_EVERY_MS) return;
  lastShown.set(email, now);
  invalidateInboxCache();
  notifySyncChanged(email);
}

/**
 * The first read of a mailbox says how far it has come, as the Outlook
 * worker's does. Null when every folder has been read to its end before.
 */
async function startProgress(
  email: string,
  scope: "all" | "inbox",
  folders: ExchangeFolderRow[],
  states: MailSyncState[]
): Promise<Progress | null> {
  const live = (id: string) => states.find((s) => s.account === email && s.folder === id)?.phase === "live";
  if (scope !== "all" || !folders.length || folders.every((f) => live(f.id))) return null;
  const total = folders.reduce((n, f) => n + f.total, 0);
  const done = folders.reduce((n, f) => n + (live(f.id) ? f.total : 0), 0);
  await publish({ account: email, folder: "", phase: "full", fullSyncTotal: Math.max(total, done), fullSyncDone: done });
  return { total, done };
}

/**
 * Every page of one folder's changes. The sync state is kept after each
 * page, under the phase `reading`, and `live` at the end of the folder. So a
 * read that is cut short goes on from the last page. True when rows changed.
 */
async function syncFolder(
  email: string,
  folder: ExchangeFolderRow,
  kept: string | null,
  worker: Worker,
  progress: Progress | null
): Promise<boolean> {
  const label = exchangeLabelFor(folder);
  let syncState = kept;
  let reset = false;
  let changed = false;
  // An inbox read from nothing: its newest mail first (see headStart).
  const known = !kept && folder.role === "inbox" ? await headStart(email, folder, label) : undefined;
  if (known) changed = true;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    if (worker.stop) return changed;
    let result;
    try {
      result = await syncExchangeItems(email, folder.id, syncState, known);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Once: a sync state the server no longer takes. Read the folder again.
      if (!syncState || reset || !isBadSyncState(message)) throw err;
      console.warn(`[mail-sync] ${email}: the sync state of ${folder.path} is no longer good; reading it again`);
      syncState = null;
      reset = true;
      continue;
    }
    if (await storePage(email, result.items, result.deleted, label)) changed = true;
    // The rows the head start brought count when the read reaches them.
    const read = result.items.length + (result.kept?.length ?? 0);
    if (progress && read) {
      await addProgress(email, progress, read);
      showFirstReadRows(email);
    }
    syncState = result.syncState;
    const phase = result.lastPage ? "live" : "reading";
    await publish({ account: email, folder: folder.id, phase, deltaLink: syncState, lastOkAt: Date.now() });
    if (result.lastPage) return changed;
  }
  throw new Error(`ews:parse: ${folder.path} did not end after ${MAX_PAGES} pages.`);
}

async function addProgress(email: string, progress: Progress, rows: number): Promise<void> {
  progress.done += rows;
  await publish({
    account: email,
    folder: "",
    phase: "full",
    fullSyncTotal: Math.max(progress.total, progress.done),
    fullSyncDone: progress.done,
  });
}

/**
 * One page into the copy. A delete takes the row out of this folder only
 * (`leftFolder`): the item can already stand in the folder it moved to.
 */
async function storePage(email: string, items: ExchangeItemRow[], deleted: string[], label: string | null): Promise<boolean> {
  const store = mailStore();
  if (items.length) await store.messages.upsertMany(email, items.map((item) => rowFromItem(item, label)));
  if (deleted.length) await store.messages.removeMessages(email, deleted, { leftFolder: label ?? "" });
  return items.length > 0 || deleted.length > 0;
}

/** An EWS item as a store row, with the labels its folder and flags give. */
export function rowFromItem(item: ExchangeItemRow, label: string | null): MailStoredMessage {
  const from = item.from ?? item.sender;
  const flagged = item.flagStatus === "Flagged";
  const labels: string[] = [];
  if (label) labels.push(label);
  if (item.isDraft && !labels.includes("DRAFT")) labels.push("DRAFT");
  if (flagged) labels.push("STARRED");
  return {
    messageId: item.id,
    threadId: item.conversationId || item.id,
    folder: "",
    uid: null,
    rfcMessageId: item.internetMessageId ?? null,
    fromName: from?.name ?? "",
    fromEmail: from?.email ?? "",
    to: item.to.map((a) => ({ name: a.name, email: a.email })),
    cc: item.cc.map((a) => ({ name: a.name, email: a.email })),
    bcc: [],
    subject: item.subject.trim(),
    snippet: item.preview.trim().slice(0, 200),
    sentAt: item.receivedAt ?? item.sentAt ?? Date.now(),
    sizeEstimate: item.size,
    hasAttachments: item.hasAttachments,
    unread: !item.isRead,
    starred: flagged,
    isDraft: item.isDraft,
    labels,
  };
}

async function publish(state: Partial<MailSyncState> & { account: string; folder: string; phase: string }): Promise<void> {
  const full: MailSyncState = { ...state } as MailSyncState;
  await mailStore().sync.set(full).catch(() => undefined);
  notifySyncState(full);
}
