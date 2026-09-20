/**
 * Local-only mail composer drafts (IndexedDB). Not synced with Gmail/Outlook.
 * Survives refresh / tab close until send, explicit discard, or ~90 days idle.
 */

import { enqueueDraftWrite } from "@/lib/mail/draft-write-queue";
import type { MailRecipient } from "@/lib/mail/contact-list-types";
import { htmlToPlainText } from "@/lib/client-email-html";
import { newMailId } from "@/lib/mail/uuid";

const DB_NAME = "redd-plan-mail-drafts";
const DB_VERSION = 1;
const STORE = "drafts";

/** Drop drafts that haven't been edited for this long (editing resets the clock). */
export const DRAFT_MAX_IDLE_MS = 90 * 24 * 60 * 60 * 1000;

export type ThreadComposerMode = "reply" | "replyAll" | "forward";

/** Serializable attachment slice (matches ready DraftAttachment rows). */
export type DraftAttachmentSnapshot = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  progress: null;
  contentBase64: string;
};

type DraftBase = {
  key: string;
  updatedAt: number;
  /** Ready attachments only (with contentBase64). */
  attachments: DraftAttachmentSnapshot[];
  /**
   * The message was handed to Outlook, and when.
   *
   * Not that it was sent — nobody here can know that. The send happens in
   * Outlook, usually in a mailbox this app holds no token for, which is the
   * reason the handover exists. What is recorded is the one thing that did
   * happen in this app, so a list of drafts can tell work that was never
   * finished from work that left by another door.
   */
  handedOver?: { at: number; account: string };
};

export type ThreadMailDraft = DraftBase & {
  kind: "thread";
  account: string;
  threadId: string;
  mode: ThreadComposerMode;
  body: string;
  /**
   * The subject the writer set, when it is not the thread's own.
   *
   * Absent means the reply goes out under the name the thread already has.
   * Saved because the composer's state travels through this record — to the
   * floating card, to another thread and back, into a new window — and a
   * subject left out of it came back as the old one, which is what the
   * message then went out as.
   */
  subject?: string;
  toList: MailRecipient[];
  ccList: MailRecipient[];
  showCc: boolean;
  editRecipients: boolean;
  includeSignature: boolean;
  fromAccount: string;
  replyFocus: boolean;
  /**
   * Where the caret was in the body, counted from the start.
   *
   * Carried so a message handed back from a pop-out opens in the place it
   * was left, rather than at one end of itself. Absent on a draft saved
   * before this existed, and on one nobody was in the middle of.
   */
  caret?: number;
  /**
   * The message a forward carries or a reply quotes, when the reader picked
   * one. Absent means the newest message in the thread.
   *
   * Carried so a forward handed to the floating card is still a forward of
   * the same message. Without it the card forwarded the newest one.
   */
  quoteMessageId?: string | null;
};

export type ComposeMailDraft = DraftBase & {
  kind: "compose";
  from: string;
  subject: string;
  body: string;
  toList: MailRecipient[];
  ccList: MailRecipient[];
  bccList: MailRecipient[];
  showCc: boolean;
  showBcc: boolean;
  includeSignature: boolean;
  /**
   * Chat style, as a new message once asked for it.
   *
   * The composer no longer asks — the question is about replies quoting
   * history, and a new message has none, so it is asked on the first reply
   * instead. Kept optional so a draft saved by an older version still reads
   * back; nothing sets it now.
   */
  chatStyle?: boolean;
};

export type MailDraft = ThreadMailDraft | ComposeMailDraft;

export function threadDraftKey(account: string, threadId: string): string {
  return `thread:${account}:${threadId}`;
}

/**
 * The key a new-message draft used to have — all of them, which is why there
 * was only ever one. Still read, so a draft written before this change is not
 * lost, but nothing writes to it any more.
 */
export const COMPOSE_DRAFT_KEY = "compose";

/** A key of its own for each new message being written. */
export function composeDraftKey(id: string): string {
  return `compose:${id}`;
}

export function newComposeDraftKey(): string {
  return composeDraftKey(newMailId());
}

export function isComposeDraftKey(key: string): boolean {
  return key === COMPOSE_DRAFT_KEY || key.startsWith("compose:");
}

/** In-memory index of thread draft keys for list badges. */
const threadDraftKeys = new Set<string>();
const draftListeners = new Set<() => void>();
let keysLoaded = false;
let keysLoadPromise: Promise<void> | null = null;
/** Stable snapshot for useSyncExternalStore. */
let threadDraftKeysSnapshot: ReadonlySet<string> = new Set();

function rebuildThreadDraftKeysSnapshot(): void {
  threadDraftKeysSnapshot = new Set(threadDraftKeys);
}

function notifyDraftListeners(): void {
  for (const listener of draftListeners) listener();
}

/**
 * The badge index holds only thread drafts, and its snapshot changes
 * reference only when the set really changes — the rows reading it
 * through useSyncExternalStore re-render on membership, not on every
 * save of a body.
 */
function updateThreadDraftKey(key: string, present: boolean): void {
  if (!key.startsWith("thread:")) return;
  const had = threadDraftKeys.has(key);
  if (present === had) return;
  if (present) threadDraftKeys.add(key);
  else threadDraftKeys.delete(key);
  rebuildThreadDraftKeysSnapshot();
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/**
 * Delete drafts whose updatedAt is older than DRAFT_MAX_IDLE_MS, then refresh
 * the in-memory thread-key index used by list badges.
 */
async function loadAndPruneDrafts(): Promise<void> {
  try {
    const db = await openDb();
    try {
      const cutoff = Date.now() - DRAFT_MAX_IDLE_MS;
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const all = await idbRequest<MailDraft[]>(store.getAll());
      const nextKeys = new Set<string>();
      for (const draft of all) {
        if (!draft || typeof draft.key !== "string") continue;
        const updatedAt =
          typeof draft.updatedAt === "number" ? draft.updatedAt : 0;
        if (updatedAt < cutoff) {
          store.delete(draft.key);
          continue;
        }
        if (draft.key.startsWith("thread:")) {
          nextKeys.add(draft.key);
        }
      }
      await txDone(tx);
      threadDraftKeys.clear();
      for (const key of nextKeys) threadDraftKeys.add(key);
      rebuildThreadDraftKeysSnapshot();
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
  keysLoaded = true;
  notifyDraftListeners();
}

function ensureThreadDraftKeysLoaded(): void {
  if (keysLoaded || keysLoadPromise) return;
  keysLoadPromise = loadAndPruneDrafts().finally(() => {
    keysLoadPromise = null;
  });
}

/** Quiet prune + badge index refresh (safe to call from Mail mount). */
export function pruneExpiredMailDrafts(): void {
  ensureThreadDraftKeysLoaded();
}

export function subscribeMailDrafts(onStoreChange: () => void): () => void {
  draftListeners.add(onStoreChange);
  ensureThreadDraftKeysLoaded();
  return () => {
    draftListeners.delete(onStoreChange);
  };
}

export function getThreadDraftKeysSnapshot(): ReadonlySet<string> {
  return threadDraftKeysSnapshot;
}

export function hasThreadDraft(account: string, threadId: string): boolean {
  return threadDraftKeys.has(threadDraftKey(account, threadId));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Couldn't open drafts database"));
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export function getDraft(key: string): Promise<MailDraft | null> {
  // Behind the queue: a hydrate right after Send must not read the row the
  // queued delete is about to remove.
  return enqueueDraftWrite(key, () => readDraft(key));
}

async function readDraft(key: string): Promise<MailDraft | null> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readonly");
      const raw = await idbRequest<MailDraft | undefined>(
        tx.objectStore(STORE).get(key)
      );
      if (!raw) return null;
      const updatedAt =
        typeof raw.updatedAt === "number" ? raw.updatedAt : 0;
      if (updatedAt < Date.now() - DRAFT_MAX_IDLE_MS) {
        // Stale — drop it (deleteDraft also updates the badge index).
        void deleteDraft(key);
        return null;
      }
      return raw;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

/**
 * Every draft we hold, newest first.
 *
 * The Drafts view needs this. Expired ones are dropped on the way out rather
 * than shown and then vanishing when they are next opened.
 */
export async function listMailDrafts(): Promise<MailDraft[]> {
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, "readonly");
      const rows = await idbRequest<MailDraft[]>(
        tx.objectStore(STORE).getAll()
      );
      const cutoff = Date.now() - DRAFT_MAX_IDLE_MS;
      return (rows ?? [])
        .filter((row) => (row?.updatedAt ?? 0) >= cutoff)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export function setDraft(draft: MailDraft): Promise<void> {
  // Queued per key — see draft-write-queue. The save on a pause in the
  // typing and the delete on Send must land in the order they were asked
  // for, or the sent message comes back as a draft.
  return enqueueDraftWrite(draft.key, async () => {
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        await idbRequest(
          tx.objectStore(STORE).put({ ...draft, updatedAt: Date.now() })
        );
      } finally {
        db.close();
      }
      if (draft.kind === "thread") {
        updateThreadDraftKey(draft.key, true);
      }
      // Every save, not only a thread badge flipping: the Drafts list
      // reads through the same subscription, and a compose draft that
      // was written or discarded never reached it — the row stood in
      // the list after the bin had done its work.
      notifyDraftListeners();
    } catch {
      /* private mode / quota — drafts are best-effort */
    }
  });
}

/**
 * Mark a draft as handed to Outlook. Quiet where there is no draft: a
 * handover from a composer that has not saved one yet is nothing to record.
 */
export async function markDraftHandedOver(
  key: string,
  account: string
): Promise<void> {
  const draft = await getDraft(key);
  if (!draft) return;
  await setDraft({ ...draft, handedOver: { at: Date.now(), account } });
}

/** The keys of every draft that went to Outlook, newest first. */
export async function listHandedOverDraftKeys(): Promise<string[]> {
  return (await listMailDrafts())
    .filter((draft) => draft.handedOver)
    .map((draft) => draft.key);
}

export function deleteDraft(key: string): Promise<void> {
  // Queued behind any save still in the air for this key — see setDraft.
  return enqueueDraftWrite(key, async () => {
    try {
      const db = await openDb();
      try {
        const tx = db.transaction(STORE, "readwrite");
        await idbRequest(tx.objectStore(STORE).delete(key));
      } finally {
        db.close();
      }
      updateThreadDraftKey(key, false);
      notifyDraftListeners();
    } catch {
      /* ignore */
    }
  });
}

/** Persist only attachments that already have base64 (skip in-progress reads). */
export function readyAttachmentsForDraft(
  items: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    contentBase64?: string;
    error?: string;
  }>
): DraftAttachmentSnapshot[] {
  return items
    .filter((a): a is typeof a & { contentBase64: string } =>
      Boolean(a.contentBase64 && !a.error)
    )
    .map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      progress: null,
      contentBase64: a.contentBase64,
    }));
}

function recipientsSignature(list: MailRecipient[]): string {
  return JSON.stringify(list);
}

export function isThreadDraftEmpty(
  draft: Omit<ThreadMailDraft, "key" | "updatedAt" | "kind">,
  defaultTo: MailRecipient[],
  defaultCc: MailRecipient[]
): boolean {
  if (htmlToPlainText(draft.body).trim()) return false;
  if (draft.subject?.trim()) return false;
  if (draft.attachments.length) return false;
  if (recipientsSignature(draft.toList) !== recipientsSignature(defaultTo)) {
    return false;
  }
  if (recipientsSignature(draft.ccList) !== recipientsSignature(defaultCc)) {
    return false;
  }
  return true;
}

export function isComposeDraftEmpty(
  draft: Omit<ComposeMailDraft, "key" | "updatedAt" | "kind">
): boolean {
  if (htmlToPlainText(draft.body).trim()) return false;
  if (draft.subject.trim()) return false;
  if (draft.attachments.length) return false;
  if (draft.toList.length || draft.ccList.length || draft.bccList.length) {
    return false;
  }
  return true;
}

/** Upsert or delete a thread draft depending on whether it still has content. */
export async function saveThreadDraft(
  draft: Omit<ThreadMailDraft, "updatedAt">,
  defaultTo: MailRecipient[],
  defaultCc: MailRecipient[],
  /**
   * Keep a draft that says nothing yet. The hand-over to the floating card
   * asks for this: the card opens from the draft, and with no draft it has
   * no composer to show.
   */
  keepEmpty = false
): Promise<void> {
  const { key, kind: _kind, ...rest } = draft;
  if (!keepEmpty && isThreadDraftEmpty(rest, defaultTo, defaultCc)) {
    await deleteDraft(key);
    return;
  }
  await setDraft({ ...draft, updatedAt: Date.now() });
}

export async function saveComposeDraft(
  draft: Omit<ComposeMailDraft, "updatedAt">
): Promise<void> {
  const { key, kind: _kind, ...rest } = draft;
  if (isComposeDraftEmpty(rest)) {
    await deleteDraft(key);
    return;
  }
  await setDraft({ ...draft, updatedAt: Date.now() });
}
