/**
 * Thread-body cache: small RAM hot set + IndexedDB for recent opens / prefetch.
 *
 * Freshness is the inbox list tip (`lastAt`): if it matches what we cached
 * against, reopen skips the network.
 *
 * Disk survives reload so the top of the list and recently opened threads
 * stay instant across sessions (Outlook-style local store, scoped).
 */

import type { MailThreadDetail } from "@/lib/mail/types";
import { ownMailIdentity } from "@/lib/own-addresses";

export type MailThreadCacheEntry = {
  thread: MailThreadDetail;
  /** List `lastAt` (or newest message time) when this entry was validated. */
  tipAt: string;
  /** UTF-8 byte length of the serialized thread (for the size budget). */
  bytes: number;
  /** Whose addresses were ours when the thread was worked out. See `ownKey`. */
  own: string;
};

type StoredThreadBody = {
  key: string;
  account: string;
  threadId: string;
  tipAt: string;
  thread: MailThreadDetail;
  bytes: number;
  updatedAt: number;
  own?: string;
};

/** Tiny row per body. Eviction reads these, so it never loads message bodies. */
type StoredThreadMeta = {
  key: string;
  bytes: number;
  updatedAt: number;
};

const DB_NAME = "redd-plan-mail-thread-bodies";
// 3: thread details gained `providerDraft`. A cached thread from before it
// existed can never have one, and a fresh cache entry stops the refetch that
// would find it — so the old entries have to go.
//
// 4: what a thread holds is not only what the provider said. `reply.to` is
// worked out here, and so is the folding of a message cc'd to yourself into
// one bubble. An entry is kept while the conversation has not changed, and a
// conversation does not change because we changed our minds about it — so a
// thread opened before either fix kept answering with the old one.
//
// The rule this is the third instance of: derived data in the cache, and a
// freshness test that only asks about the provider. Anything worked out on
// the way in has to be versioned on the way in too.
const DB_VERSION = 4;
const STORE = "bodies";
const META_STORE = "meta";

/** Hot set in RAM — recently touched only. */
const MAX_RAM_ENTRIES = 40;
const MAX_RAM_BYTES = 24 * 1024 * 1024;

/** Persistent store — first-page prefetch + recent opens. */
const MAX_DISK_ENTRIES = 250;
const MAX_DISK_BYTES = 200 * 1024 * 1024;
const MAX_DISK_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/*
  Which side a bubble sits on, the "You" label, and the folding of a copy
  to yourself all ask whether an address is ours. That answer is in the
  cached thread, and it changes without the conversation changing: an alias
  is added, or the Exchange directory answers after the first threads were
  fetched. So each entry keeps the own addresses it was worked out with, and
  an entry made with other ones is not used. Without this, a reader's own
  mail stayed on the left in threads opened before they added an alias.
*/
function ownKey(): string {
  const { addresses, domains } = ownMailIdentity();
  return `${addresses.join(",")}|${domains.join(",")}`;
}

const cache = new Map<string, MailThreadCacheEntry>();
/** Insertion / touch order — oldest at the front. */
const order: string[] = [];
let totalBytes = 0;

function cacheKey(account: string, threadId: string): string {
  return `${account}|${threadId}`;
}

function measureThreadBytes(thread: MailThreadDetail): number {
  try {
    return new Blob([JSON.stringify(thread)]).size;
  } catch {
    return 0;
  }
}

function touch(key: string): void {
  const i = order.indexOf(key);
  if (i >= 0) order.splice(i, 1);
  order.push(key);
}

function evictRamOverflow(): void {
  while (
    order.length > 0 &&
    (order.length > MAX_RAM_ENTRIES || totalBytes > MAX_RAM_BYTES)
  ) {
    const oldest = order.shift();
    if (!oldest) break;
    const entry = cache.get(oldest);
    if (entry) totalBytes -= entry.bytes;
    cache.delete(oldest);
  }
}

function putRam(
  account: string,
  threadId: string,
  thread: MailThreadDetail,
  tipAt: string,
  bytes: number,
  own: string
): MailThreadCacheEntry {
  const key = cacheKey(account, threadId);
  const prev = cache.get(key);
  if (prev) totalBytes -= prev.bytes;
  const entry: MailThreadCacheEntry = { thread, tipAt, bytes, own };
  cache.set(key, entry);
  totalBytes += bytes;
  touch(key);
  evictRamOverflow();
  return entry;
}

export function tipAtFromThread(thread: MailThreadDetail): string {
  const last = thread.messages[thread.messages.length - 1];
  return last?.sentAt ?? "";
}

/** Sync RAM lookup only. Prefer `loadCachedMailThread` when disk hydrate is OK. */
export function getCachedMailThread(
  account: string,
  threadId: string
): MailThreadCacheEntry | null {
  const key = cacheKey(account, threadId);
  const entry = cache.get(key);
  if (!entry || entry.own !== ownKey()) return null;
  touch(key);
  return entry;
}

/** One connection for the session — open/close per operation is not free. */
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const pending = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // The cache is best-effort, so every version starts clean rather than
      // migrating: v1 kept no meta rows, and v2 predates `providerDraft`.
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      if (db.objectStoreNames.contains(META_STORE)) {
        db.deleteObjectStore(META_STORE);
      }
      db.createObjectStore(STORE, { keyPath: "key" });
      const meta = db.createObjectStore(META_STORE, { keyPath: "key" });
      meta.createIndex("updatedAt", "updatedAt", { unique: false });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () =>
      reject(req.error ?? new Error("Couldn't open thread body database"));
  });
  dbPromise = pending.catch((err) => {
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("Transaction failed"));
  });
}

async function idbGet(key: string): Promise<StoredThreadBody | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const raw = await idbRequest<StoredThreadBody | undefined>(
      tx.objectStore(STORE).get(key)
    );
    if (!raw?.thread) return null;
    if (
      typeof raw.updatedAt !== "number" ||
      raw.updatedAt < Date.now() - MAX_DISK_AGE_MS
    ) {
      void idbDelete(key);
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

async function idbDelete(key: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.objectStore(META_STORE).delete(key);
    await txDone(tx);
  } catch {
    /* best-effort */
  }
}

/**
 * Trim the store to the entry / byte / age budget. Reads meta rows only —
 * never the bodies, which is what made this expensive when it ran per write.
 */
async function evictDiskOverflow(db: IDBDatabase): Promise<void> {
  const tx = db.transaction([STORE, META_STORE], "readwrite");
  const bodies = tx.objectStore(STORE);
  const meta = tx.objectStore(META_STORE);
  // Index order is oldest → newest by updatedAt.
  const all = await idbRequest<StoredThreadMeta[]>(
    meta.index("updatedAt").getAll()
  );
  if (!all.length) return;

  let total = all.reduce((n, row) => n + (row.bytes || 0), 0);
  const cutoff = Date.now() - MAX_DISK_AGE_MS;
  const keep: StoredThreadMeta[] = [];

  const drop = (row: StoredThreadMeta) => {
    bodies.delete(row.key);
    meta.delete(row.key);
    total -= row.bytes || 0;
  };

  for (const row of all) {
    if ((row.updatedAt || 0) < cutoff) drop(row);
    else keep.push(row);
  }

  while (keep.length > MAX_DISK_ENTRIES || total > MAX_DISK_BYTES) {
    const oldest = keep.shift();
    if (!oldest) break;
    drop(oldest);
  }

  await txDone(tx);
}

/** Eviction is amortized: a write does not pay for it. */
const EVICT_AFTER_WRITES = 25;
const EVICT_MIN_INTERVAL_MS = 60_000;
let writesSinceEvict = 0;
let lastEvictAt = 0;
let evicting = false;

async function maybeEvictDisk(db: IDBDatabase): Promise<void> {
  writesSinceEvict += 1;
  if (evicting) return;
  const now = Date.now();
  if (
    writesSinceEvict < EVICT_AFTER_WRITES &&
    now - lastEvictAt < EVICT_MIN_INTERVAL_MS
  ) {
    return;
  }
  evicting = true;
  writesSinceEvict = 0;
  lastEvictAt = now;
  try {
    await evictDiskOverflow(db);
  } catch {
    /* best-effort */
  } finally {
    evicting = false;
  }
}

async function idbPut(row: StoredThreadBody): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([STORE, META_STORE], "readwrite");
    tx.objectStore(STORE).put(row);
    tx.objectStore(META_STORE).put({
      key: row.key,
      bytes: row.bytes,
      updatedAt: row.updatedAt,
    } satisfies StoredThreadMeta);
    await txDone(tx);
    await maybeEvictDisk(db);
  } catch {
    /* private mode / quota — cache is best-effort */
  }
}

/**
 * RAM first, then IndexedDB. Promotes a disk hit into the hot set.
 */
export async function loadCachedMailThread(
  account: string,
  threadId: string
): Promise<MailThreadCacheEntry | null> {
  const ram = getCachedMailThread(account, threadId);
  if (ram) return ram;

  const key = cacheKey(account, threadId);
  const stored = await idbGet(key);
  // No `own` is an entry from before this check: worked out with unknown
  // addresses, so not used either.
  if (!stored || stored.own !== ownKey()) return null;

  return putRam(
    account,
    threadId,
    stored.thread,
    stored.tipAt || tipAtFromThread(stored.thread),
    stored.bytes || measureThreadBytes(stored.thread),
    stored.own
  );
}

export function setCachedMailThread(
  account: string,
  threadId: string,
  thread: MailThreadDetail,
  tipAt?: string | null
): void {
  const tip = tipAt || tipAtFromThread(thread);
  const own = ownKey();
  const key = cacheKey(account, threadId);
  const prev = cache.get(key);
  // The open pane re-runs this on every render pass. Same object, same tip —
  // nothing new to store, so skip the serialize and the disk write.
  if (prev && prev.thread === thread && prev.tipAt === tip && prev.own === own) {
    touch(key);
    return;
  }
  const bytes = measureThreadBytes(thread);
  putRam(account, threadId, thread, tip, bytes, own);
  void idbPut({
    key,
    account,
    threadId,
    tipAt: tip,
    thread,
    bytes,
    updatedAt: Date.now(),
    own,
  });
}

export function invalidateCachedMailThread(
  account: string,
  threadId: string
): void {
  const key = cacheKey(account, threadId);
  const entry = cache.get(key);
  if (entry) {
    totalBytes -= entry.bytes;
    cache.delete(key);
    const i = order.indexOf(key);
    if (i >= 0) order.splice(i, 1);
  }
  void idbDelete(key);
}

/** True when cache can be shown as authoritative (skip network). */
export function isMailThreadCacheFresh(
  entry: MailThreadCacheEntry,
  listTipAt: string | undefined,
  focusMessageId?: string
): boolean {
  if (
    focusMessageId &&
    !entry.thread.messages.some((m) => m.id === focusMessageId)
  ) {
    return false;
  }
  // No list tip yet — trust the session cache.
  if (!listTipAt) return true;
  return entry.tipAt === listTipAt;
}
