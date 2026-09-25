/**
 * The local copy of an Outlook mailbox, kept by Graph delta queries.
 *
 * Graph has no request budget, so this worker is here for the same reason
 * Apple Mail keeps a copy: the list, search, and opening a message read
 * disk, and work offline. One pass reads every folder's delta — the whole
 * folder the first time, the changes since the last link after that — and
 * writes rows, labels, and bodies into the same tables the Gmail worker
 * fills. It runs in the interface's process on a timer, and is woken after
 * anything the reader did. See docs/mail-local-store.md, sections 5.5 and
 * 6.
 */

import { removalsToApplyNow, settledOutlookMoves } from "@/lib/mail/outlook-moves";
import "server-only";

import {
  graphAddress,
  graphAddresses,
  listOutlookFolderDelta,
  type GraphMessage,
} from "@/lib/outlook/api";
import {
  listOutlookAttachmentMeta,
  resolveOutlookInlineImages,
  bodyHasInlineImage,
} from "@/lib/outlook/attachments";
import { outlookAccessTokenFor } from "@/lib/mail/outlook-token";
import { listOutlookFolders, type OutlookFolder } from "@/lib/mail/outlook-folders";
import { mailStore } from "@/lib/mail/store";
import type { MailStoredMessage, MailSyncState } from "@/lib/mail/store/types";
import { notifySyncChanged, notifySyncState } from "@/lib/mail/local-store";
import { invalidateInboxCache } from "@/lib/mail/inbox-cache";

/*
  How often the server is asked.

  Graph has no way to tell a desktop app that mail arrived: its change
  notifications go to a public web address, which a laptop does not have.
  So the worker asks — the inbox every few seconds, since that is where
  new mail lands and where a minute's lag is felt, and every folder once
  a minute for what was moved, filed, or sent. A delta call on a folder
  with nothing new is one small request, well inside what Graph allows.
*/
const INBOX_EVERY_MS = 10_000;
const ALL_EVERY_MS = 60_000;
const BACKOFF_MS = [10_000, 30_000, 60_000, 300_000];

type Worker = {
  timer: number | null;
  running: boolean;
  /** The pass under way, for a stop to wait on. */
  current: Promise<void> | null;
  stop: boolean;
  failures: number;
  /** When every folder was last walked; 0 asks for all of them next. */
  lastAll: number;
  /** The folder list from the last full walk, for the inbox-only passes. */
  folders: OutlookFolder[] | null;
  /**
   * The first walk of every folder has been completed since this worker
   * started. Until then a full pass is the first read, and says so with a
   * count — however many times an error or a stop cut the one before short.
   */
  firstReadDone: boolean;
};
const workers = new Map<string, Worker>();

export function startOutlookSync(account: string): boolean {
  const email = account.trim().toLowerCase();
  if (workers.has(email)) return false;
  const worker: Worker = {
    timer: null,
    running: false,
    current: null,
    stop: false,
    failures: 0,
    lastAll: 0,
    folders: null,
    firstReadDone: false,
  };
  workers.set(email, worker);
  void runSoon(email, 0);
  return true;
}

/**
 * Stop, and wait for a pass under way to end. The caller is about to
 * drop the mailbox's rows; a pass still running would write them back,
 * with a delta link that makes the next connect think it had synced.
 */
export async function stopOutlookSync(account: string): Promise<void> {
  const email = account.trim().toLowerCase();
  const worker = workers.get(email);
  if (!worker) return;
  worker.stop = true;
  if (worker.timer != null) window.clearTimeout(worker.timer);
  workers.delete(email);
  await worker.current?.catch(() => undefined);
  // The row as it stands, with the phase changed: a state that named only the
  // phase wiped the count of a first read, and the list took the read for done.
  await publish({ ...(await overallRow(email)), account: email, folder: "", phase: "none" });
}

/** The mailbox's own row, as the store holds it now. */
async function overallRow(email: string): Promise<MailSyncState | undefined> {
  const states = await mailStore().sync.list().catch(() => [] as MailSyncState[]);
  return (Array.isArray(states) ? states : []).find((s) => s.account === email && s.folder === "");
}

/** Look at the server now rather than at the next tick. */
export function wakeOutlookSync(account: string, scope: "all" | "inbox" = "all"): void {
  const email = account.trim().toLowerCase();
  const worker = workers.get(email);
  if (!worker) return;
  // Mail that moved went to a folder that is not the inbox, so the next
  // pass walks them all. Read or unread moved nothing: the inbox is enough.
  if (scope === "all") worker.lastAll = 0;
  void runSoon(email, 500);
}

export function outlookSyncRunning(): string[] {
  return [...workers.keys()].sort();
}

async function runSoon(email: string, delay: number): Promise<void> {
  const worker = workers.get(email);
  if (!worker || worker.stop) return;
  if (worker.timer != null) window.clearTimeout(worker.timer);
  worker.timer = window.setTimeout(() => {
    worker.timer = null;
    void pass(email);
  }, delay);
}

async function pass(email: string): Promise<void> {
  const worker = workers.get(email);
  if (!worker || worker.stop || worker.running) return;
  worker.running = true;
  const all = Date.now() - worker.lastAll >= ALL_EVERY_MS || !worker.folders;
  const run = syncFolders(email, all ? "all" : "inbox", worker);
  worker.current = run;
  try {
    await run;
    if (all) worker.lastAll = Date.now();
    worker.failures = 0;
    if (worker.stop) return;
    void runSoon(email, INBOX_EVERY_MS);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[mail-sync] ${email}: ${reason}`);
    /*
      The row as it stands, with the phase and the reason changed. The store
      writes every column of a state it is given, so a state that named only
      the phase wiped the count of the first read: the read that resumed
      started its bar again from nought, over mail it already had.
    */
    const prior = await overallRow(email);
    await publish({
      ...prior,
      account: email,
      folder: "",
      phase: "paused",
      lastError: /invalid_grant|reconnect|401/i.test(reason) ? `needs reconnect: ${reason}` : reason,
    });
    const wait = BACKOFF_MS[Math.min(worker.failures, BACKOFF_MS.length - 1)];
    worker.failures += 1;
    void runSoon(email, wait);
  } finally {
    worker.running = false;
    worker.current = null;
  }
}

/**
 * A repair that runs once for each mailbox: Deleted Items and Junk Email are
 * read again from the start.
 *
 * Until 2026-09-19 a "left the inbox" report deleted the row whatever folder
 * the copy had it in, so a mail the reader sent to Trash could be lost from
 * the copy for good: it was on the server, in Deleted Items, and in no row
 * here. Nobody saw it while Trash was listed from Graph. The rule is mended
 * (`removeMessages` with `leftFolder`), and the mail already lost comes back
 * only when its folder is read again. These two folders are small, and are
 * where mail goes by the reader's own hand. The mark is kept in the page's
 * storage, for each mailbox and folder, so it runs once and not at each start.
 */
const REPAIR_KEY = "dh-mail-outlook-reread-1";

function repairMarks(): Record<string, true> {
  try {
    return JSON.parse(window.localStorage?.getItem(REPAIR_KEY) ?? "{}") as Record<string, true>;
  } catch {
    return {};
  }
}

function repairDue(email: string, folderId: string): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  return repairMarks()[`${email}|${folderId}`] !== true;
}

function repairDone(email: string, folderId: string): void {
  try {
    const marks = repairMarks();
    marks[`${email}|${folderId}`] = true;
    window.localStorage?.setItem(REPAIR_KEY, JSON.stringify(marks));
  } catch {
    // No storage: the repair runs again next time, which costs a read.
  }
}

/** Graph's folder roles as the store's labels. */
function labelFor(role: string | undefined, path: string): string | null {
  switch (role) {
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
      return path;
  }
}

/** One message's body as the copy keeps it. */
type PageBody = { id: string; text: string; html: string | null; inline: Record<string, string>; attachments: unknown[] };

/**
 * A page of a folder's delta, read: the rows it brings, the ids it says
 * are gone, and each message's body with its files and inline pictures.
 */
async function readPageEntries(
  token: string,
  entries: Awaited<ReturnType<typeof listOutlookFolderDelta>>["entries"],
  label: string | null
): Promise<{ rows: MailStoredMessage[]; removed: string[]; bodies: PageBody[] }> {
  const rows: MailStoredMessage[] = [];
  const removed: string[] = [];
  const pending: Promise<PageBody>[] = [];
  for (const entry of entries) {
    if (entry.kind === "removed") {
      removed.push(entry.id);
      continue;
    }
    const m = entry.message;
    rows.push(rowFrom(m, label));
    const html = m.body?.contentType?.toLowerCase() === "html" ? (m.body.content ?? "") : null;
    const text = html ? "" : (m.body?.content ?? m.bodyPreview ?? "");
    /*
      The attachments of a page's messages are asked for side by side.
      They were asked for one after another: a page of a hundred messages
      with thirty attachments was thirty requests in a row, each waiting
      on the one before, and that was most of the hours a big mailbox
      took. The Graph client lets three requests for a mailbox run at
      once and queues the rest, so this cannot ask faster than it may.
    */
    pending.push(
      (async (): Promise<PageBody> => {
        let inline: Record<string, string> = {};
        let attachments: unknown[] = [];
        if (m.hasAttachments || bodyHasInlineImage(html ?? undefined)) {
          const meta = await listOutlookAttachmentMeta(token, m.id).catch(() => []);
          attachments = meta
            .filter((a) => !a.isInline)
            .map((a) => ({
              section: a.id,
              filename: a.name || "attachment",
              mimeType: a.contentType || "application/octet-stream",
              size: a.size ?? 0,
            }));
          if (html && bodyHasInlineImage(html)) {
            inline = await resolveOutlookInlineImages(token, m.id, html, meta).catch(() => ({}));
          }
        }
        return { id: m.id, text, html, inline, attachments };
      })()
    );
  }
  const bodies = await Promise.all(pending);
  return { rows, removed, bodies };
}

/** A page's rows and their bodies, written to the copy. */
async function storePageRows(email: string, rows: MailStoredMessage[], bodies: PageBody[]): Promise<void> {
  const store = mailStore();
  await store.messages.upsertMany(email, rows);
  for (const b of bodies) {
    await store.messages.putBody(email, b.id, {
      text: b.text || null,
      html: b.html,
      inlineImages: b.inline,
      attachments: b.attachments,
    });
  }
}

/**
 * The rows a page makes stale, taken out of the copy: a moved message's
 * old row, and the messages the folder says it no longer holds. True when
 * any row went.
 */
async function dropReplacedAndRemoved(
  email: string,
  rows: MailStoredMessage[],
  removed: string[],
  label: string | null
): Promise<boolean> {
  const store = mailStore();
  let changed = false;
  // A message this app moved arrives here under its new id. The row it
  // had before the move, kept until now, goes in the same step, so the
  // list never shows the mail twice and never shows it in no folder.
  const replaced = settledOutlookMoves(rows.map((r) => r.messageId));
  if (replaced.length) {
    await store.messages.removeMessages(email, replaced);
    changed = true;
  }
  if (removed.length) {
    // Gone from this folder: moved elsewhere (the other folder's delta
    // brings it back under its new label) or deleted for good. A message
    // that this app moved keeps its row until then: outlook-moves.ts.
    const now = removalsToApplyNow(removed);
    if (now.length) {
      // Believed about this folder only. The report can come after the
      // folder the message went to has delivered it, and must not take
      // the row that stands there now.
      await store.messages.removeMessages(email, now, { leftFolder: label ?? "" });
      changed = true;
    }
  }
  return changed;
}

async function syncFolders(email: string, scope: "all" | "inbox", worker: Worker): Promise<void> {
  const known = scope === "all" || !worker.folders ? await listOutlookFolders(email) : worker.folders;
  worker.folders = known;
  // The inbox first, whatever order Graph lists them in: the list reads
  // the copy from the start of the first walk, and an Archive of twenty
  // thousand walked before the inbox left it empty for minutes.
  const ordered = [...known].sort((a, b) => Number(b.role === "inbox") - Number(a.role === "inbox"));
  const folders = scope === "inbox" ? ordered.filter((f) => f.role === "inbox") : ordered;
  const store = mailStore();
  const states = await store.sync.list();
  const overall = states.find((s) => s.account === email && s.folder === "");
  /*
    The first read is the first pass over every folder that gets to the
    end. It used to be judged by the row's phase, which went wrong two
    ways: an error partway put the row at "paused", which read as "not a
    first time", so the walk that resumed said nothing while it read the
    other forty thousand; and an inbox-only pass in the middle, being the
    first pass to finish, ended the read with a count of the inbox alone.
    A pause after a completed read still announces nothing: the delta
    links stand, and only what changed is read.
  */
  /*
    A worker that starts on a mailbox it read to the end in an earlier sitting
    has no first read to do. Every folder holds a delta link, so the pass reads
    only what changed. Without this, each start of the app put up a bar at
    "0 of fifty thousand" that went away seconds later, which reads as a read
    that gave up.
  */
  const folderRow = (id: string) => states.find((s) => s.account === email && s.folder === id);
  if (scope === "all" && !worker.firstReadDone && folders.length && folders.every((f) => folderRow(f.id)?.phase === "live")) {
    worker.firstReadDone = true;
  }
  const firstTime = scope === "all" && !worker.firstReadDone;
  let total = 0;
  let done = 0;
  if (firstTime) {
    total = folders.reduce((n, f) => n + (f.count || 0), 0);
    // Taken up where the cut-short read left off, not from nought. A row whose
    // count an older version wiped starts from the folders that are finished.
    const kept = overall && overall.phase !== "live" ? (overall.fullSyncDone ?? 0) : 0;
    const finished = folders.reduce((n, f) => n + (folderRow(f.id)?.phase === "live" ? f.count || 0 : 0), 0);
    done = Math.max(kept, finished);
    await publish({ account: email, folder: "", phase: "full", fullSyncTotal: Math.max(total, done), fullSyncDone: done });
  }
  let changed = false;
  for (const folder of folders) {
    const label = labelFor(folder.role, folder.path);
    const state = states.find((s) => s.account === email && s.folder === folder.id);
    let link = state?.deltaLink ?? null;
    // Once: see `repairOnce`. Read from the start, which writes every row of
    // the folder over and brings back the ones the copy had lost.
    const repairing = link != null && (folder.role === "trash" || folder.role === "junk") && repairDue(email, folder.id);
    if (repairing) link = null;
    // The folder was partway through its first read when the last pass ended.
    let resumed = link != null && state?.phase === "reading";
    let deltaLink: string | undefined;
    for (;;) {
      if (worker.stop) return;
      /*
        A token for each page, and not one for the whole pass. The first read
        of a big mailbox takes hours and an access token lives about one. With
        one token taken at the start, the read of fifty thousand messages ran
        until the token ran out, failed with a 401, and was put down as "needs
        reconnect" on a mailbox whose sign-in was fine. The helper keeps a
        token for 45 minutes, so this costs nothing until a new one is due.
      */
      const token = await outlookAccessTokenFor(email);
      let page: Awaited<ReturnType<typeof listOutlookFolderDelta>>;
      try {
        page = await listOutlookFolderDelta(token, folder.id, link);
      } catch (err) {
        // Gone: Graph has forgotten this delta, as it does after a long
        // silence. The folder is read again from the start, which writes
        // every row over; without this the pass failed for ever on the
        // same link. A row the folder no longer holds is corrected when
        // it turns up in another folder's delta.
        const status = (err as { status?: number }).status;
        if (link && status === 410) {
          console.warn(`[mail-sync] ${email}: delta for ${folder.path} expired; reading the folder again`);
          link = null;
          continue;
        }
        // A place kept from a read that was cut short, which Graph no longer
        // takes: the folder is read from the start, once.
        if (link && resumed && (status === 400 || status === 404)) {
          console.warn(`[mail-sync] ${email}: the kept place in ${folder.path} is no longer good; reading the folder again`);
          link = null;
          resumed = false;
          continue;
        }
        throw err;
      }
      const { rows, removed, bodies } = await readPageEntries(token, page.entries, label);
      if (rows.length) {
        await storePageRows(email, rows, bodies);
        changed = true;
        done += rows.length;
        if (firstTime) {
          await publish({ account: email, folder: "", phase: "full", fullSyncTotal: Math.max(total, done), fullSyncDone: done });
        }
      }
      if (await dropReplacedAndRemoved(email, rows, removed, label)) changed = true;
      if (page.nextLink) {
        link = page.nextLink;
        /*
          The place is kept after every page, under a phase of its own. It
          was kept only in memory, and a folder's state was written when the
          folder was finished. So a read that was cut short, by an error or
          by the app being closed, began that folder again from its first
          message. A folder that takes longer to read than the app stays
          open was never finished at all: an inbox of forty thousand on a
          computer that is shut down each evening.
        */
        await publish({ account: email, folder: folder.id, phase: "reading", deltaLink: link, lastOkAt: Date.now() });
        continue;
      }
      deltaLink = page.deltaLink;
      break;
    }
    if (worker.stop) return;
    await publish({ account: email, folder: folder.id, phase: "live", deltaLink: deltaLink ?? link, lastOkAt: Date.now() });
    if (repairing) repairDone(email, folder.id);
  }
  if (worker.stop) return;
  // An inbox-only pass says nothing about the whole: the first read may
  // still be under way, and its bar stays up.
  if (scope === "all") {
    /*
      A read that is complete has a count equal to its total, as the Gmail
      worker's has. The list tells a first read that is not finished by a count
      short of its total, in whatever phase, so the two numbers must agree
      here. Folder counts move while a read runs, and the sum of rows read is
      seldom the sum Graph gave at the start.
    */
    const whole = firstTime ? Math.max(total, done) : (overall?.fullSyncTotal ?? undefined);
    await publish({ account: email, folder: "", phase: "live", fullSyncTotal: whole, fullSyncDone: whole, lastOkAt: Date.now() });
    worker.firstReadDone = true;
  }
  if (changed) {
    invalidateInboxCache();
    notifySyncChanged(email);
  }
}

function rowFrom(m: GraphMessage, label: string | null): MailStoredMessage {
  const from = graphAddress(m.from);
  const at = Date.parse(m.receivedDateTime ?? m.sentDateTime ?? "") || Date.now();
  const labels: string[] = [];
  if (label) labels.push(label);
  if (m.isDraft && !labels.includes("DRAFT")) labels.push("DRAFT");
  const flagged = m.flag?.flagStatus === "flagged";
  if (flagged) labels.push("STARRED");
  return {
    messageId: m.id,
    threadId: m.conversationId || m.id,
    folder: "",
    uid: null,
    rfcMessageId: m.internetMessageId ?? null,
    fromName: from.name ?? "",
    fromEmail: from.email ?? "",
    to: graphAddresses(m.toRecipients).map((a) => ({ name: a.name ?? "", email: a.email })),
    cc: graphAddresses(m.ccRecipients).map((a) => ({ name: a.name ?? "", email: a.email })),
    bcc: graphAddresses(m.bccRecipients).map((a) => ({ name: a.name ?? "", email: a.email })),
    subject: (m.subject ?? "").trim(),
    snippet: (m.bodyPreview ?? "").trim().slice(0, 200),
    sentAt: at,
    hasAttachments: Boolean(m.hasAttachments),
    unread: m.isRead === false,
    starred: flagged,
    isDraft: Boolean(m.isDraft),
    labels,
  };
}

async function publish(state: Partial<MailSyncState> & { account: string; folder: string; phase: string }): Promise<void> {
  const full: MailSyncState = { ...state } as MailSyncState;
  await mailStore().sync.set(full).catch(() => undefined);
  notifySyncState(full);
}
