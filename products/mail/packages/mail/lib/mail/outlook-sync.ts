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

import "server-only";

import {
  graphAddress,
  graphAddresses,
  listOutlookAttachmentMeta,
  listOutlookFolderDelta,
  resolveOutlookInlineImages,
  bodyHasInlineImage,
  type GraphMessage,
} from "@/lib/outlook/api";
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
  await publish({ account: email, folder: "", phase: "none" });
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
    await publish({
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

async function syncFolders(email: string, scope: "all" | "inbox", worker: Worker): Promise<void> {
  const token = await outlookAccessTokenFor(email);
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
  const firstTime = scope === "all" && !worker.firstReadDone;
  let total = 0;
  let done = 0;
  if (firstTime) {
    total = folders.reduce((n, f) => n + (f.count || 0), 0);
    // Taken up where the cut-short read left off, not from nought.
    done = overall?.phase === "full" || overall?.phase === "paused" ? (overall.fullSyncDone ?? 0) : 0;
    await publish({ account: email, folder: "", phase: "full", fullSyncTotal: Math.max(total, done), fullSyncDone: done });
  }
  let changed = false;
  for (const folder of folders) {
    const label = labelFor(folder.role, folder.path);
    const state = states.find((s) => s.account === email && s.folder === folder.id);
    let link = state?.deltaLink ?? null;
    let deltaLink: string | undefined;
    for (;;) {
      if (worker.stop) return;
      let page: Awaited<ReturnType<typeof listOutlookFolderDelta>>;
      try {
        page = await listOutlookFolderDelta(token, folder.id, link);
      } catch (err) {
        // Gone: Graph has forgotten this delta, as it does after a long
        // silence. The folder is read again from the start, which writes
        // every row over; without this the pass failed for ever on the
        // same link. A row the folder no longer holds is corrected when
        // it turns up in another folder's delta.
        if (link && (err as { status?: number }).status === 410) {
          console.warn(`[mail-sync] ${email}: delta for ${folder.path} expired; reading the folder again`);
          link = null;
          continue;
        }
        throw err;
      }
      const rows: MailStoredMessage[] = [];
      const bodies: { id: string; text: string; html: string | null; inline: Record<string, string>; attachments: unknown[] }[] = [];
      const removed: string[] = [];
      for (const entry of page.entries) {
        if (entry.kind === "removed") {
          removed.push(entry.id);
          continue;
        }
        const m = entry.message;
        rows.push(rowFrom(m, label));
        const html = m.body?.contentType?.toLowerCase() === "html" ? (m.body.content ?? "") : null;
        const text = html ? "" : (m.body?.content ?? m.bodyPreview ?? "");
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
        bodies.push({ id: m.id, text, html, inline, attachments });
      }
      if (rows.length) {
        await store.messages.upsertMany(email, rows);
        for (const b of bodies) {
          await store.messages.putBody(email, b.id, {
            text: b.text || null,
            html: b.html,
            inlineImages: b.inline,
            attachments: b.attachments,
          });
        }
        changed = true;
        done += rows.length;
        if (firstTime) {
          await publish({ account: email, folder: "", phase: "full", fullSyncTotal: Math.max(total, done), fullSyncDone: done });
        }
      }
      if (removed.length) {
        // Gone from this folder: moved elsewhere (the other folder's delta
        // brings it back under its new label) or deleted for good.
        await store.messages.removeMessages(email, removed);
        changed = true;
      }
      if (page.nextLink) {
        link = page.nextLink;
        continue;
      }
      deltaLink = page.deltaLink;
      break;
    }
    if (worker.stop) return;
    await publish({ account: email, folder: folder.id, phase: "live", deltaLink: deltaLink ?? link, lastOkAt: Date.now() });
  }
  if (worker.stop) return;
  // An inbox-only pass says nothing about the whole: the first read may
  // still be under way, and its bar stays up.
  if (scope === "all") {
    await publish({ account: email, folder: "", phase: "live", fullSyncTotal: total || undefined, fullSyncDone: done || undefined, lastOkAt: Date.now() });
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
