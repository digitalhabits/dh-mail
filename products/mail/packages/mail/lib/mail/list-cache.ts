/**
 * The mail list cache, so a returning tab paints before the network answers.
 *
 * Two layers: a map for this JS session, and localStorage so the list survives
 * a reload. Both are keyed by viewer, because two people can sign in to the
 * same browser and neither must see the other's mail.
 *
 * Everything here is best-effort. A private-mode browser throws on storage, and
 * the session map still works.
 */

import type { MailThreadSummary } from "@/lib/mail/types";

// v8: while Junk and Trash were asking the server for nothing, the inbox was
// cached under their keys. Those entries would paint the wrong mail on the
// next open, before the corrected fetch replaced it.
// v9: rows gained hasAttachments, and a stored row never grows a field.
const MAIL_THREADS_CACHE_PREFIX = "redd-plan-mail-threads-cache-v9";

export type MailListCacheEntry = {
  threads: MailThreadSummary[];
  nextCursor: string | null;
};

const mailThreadsMemory = new Map<string, MailListCacheEntry>();
/** Viewer id that last painted a warm list this JS session. */
let mailSessionWarmViewer: string | null = null;

/** Note that this viewer painted a warm list. */
export function markMailWarm(viewerId: string): void {
  mailSessionWarmViewer = viewerId;
}

export function isMailWarm(viewerId?: string): boolean {
  if (!mailSessionWarmViewer) return false;
  return viewerId == null || mailSessionWarmViewer === viewerId;
}

export function mailThreadsStorageKey(viewerId: string): string {
  return `${MAIL_THREADS_CACHE_PREFIX}:${viewerId}`;
}

export function memoryListKey(viewerId: string, key: string): string {
  return `${viewerId}\0${key}`;
}

/** Drop superseded caches: pre-v7 leaked across Clerk users, v7 held wrong
 * mail under the Junk and Trash keys. */
export function scrubLegacySharedMailCaches(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("redd-plan-page-mail-v2");
    localStorage.removeItem("redd-plan-mail-threads-cache-v7");
    localStorage.removeItem("redd-plan-mail-threads-cache-v6");
    localStorage.removeItem("redd-plan-mail-threads-cache-v5");
    sessionStorage.removeItem("redd-plan-mail-threads-cache-v5");
    sessionStorage.removeItem("redd-plan-mail-threads-cache-v6");
  } catch {
    /* private mode */
  }
}

/**
 * List cache key for folder + search. Account chips filter client-side from
 * the all-accounts list — they must not change this key or we'd refetch.
 */
export function mailListCacheKey(folder: string, q: string): string {
  return `${folder}|${q}`;
}

export function readCachedList(
  viewerId: string,
  key: string
): MailListCacheEntry | null {
  const memKey = memoryListKey(viewerId, key);
  const mem = mailThreadsMemory.get(memKey);
  if (mem) return mem;
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(mailThreadsStorageKey(viewerId));
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, MailListCacheEntry>;
    const entry = all[key];
    if (!entry || !Array.isArray(entry.threads)) return null;
    const normalised: MailListCacheEntry = {
      threads: entry.threads,
      nextCursor: entry.nextCursor ?? null,
    };
    mailThreadsMemory.set(memKey, normalised);
    return normalised;
  } catch {
    return null;
  }
}

/**
 * Take a thread out of every cached list, not only the one on screen.
 *
 * A thread that was archived, trashed or moved is gone from all of them. The
 * cache holds up to ten lists — one per folder and search — and nothing here
 * expires, so a list the reader is not looking at would keep painting that
 * thread every time they came back to it, for as long as the entry survived.
 *
 * The list the reader is on is corrected by the state that removed the row.
 * This is for the other nine.
 */
/**
 * A summary for one thread, from any list already read.
 *
 * The reader can pin what the list is holding. A thread opened from a
 * search hit, from a deep link, or simply older than the page the list has
 * loaded is not in it — so the pin had nothing to pin the thread as, and
 * said so. Unpin such a thread and it could not be pinned again: the pin's
 * own summary went with the pin.
 *
 * Every list this viewer has read is cached, summaries and all, and a
 * thread they are looking at has almost always been in one of them. So it
 * is looked for there before the reader is turned away. Memory first,
 * because it is the freshest; then the store, which outlives the session.
 *
 * A summary from a cache is a snapshot, which is what a pin keeps anyway —
 * `syncMailPinSummaries` brings each one up to date when the list holds it.
 */
export function findCachedThread(
  viewerId: string,
  isThread: (thread: MailThreadSummary) => boolean
): MailThreadSummary | null {
  const prefix = `${viewerId}\0`;
  for (const [memKey, entry] of mailThreadsMemory) {
    if (!memKey.startsWith(prefix)) continue;
    const found = entry.threads.find(isThread);
    if (found) return found;
  }
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(mailThreadsStorageKey(viewerId));
    if (!raw) return null;
    const all = JSON.parse(raw) as Record<string, MailListCacheEntry>;
    for (const entry of Object.values(all)) {
      if (!entry || !Array.isArray(entry.threads)) continue;
      const found = entry.threads.find(isThread);
      if (found) return found;
    }
  } catch {
    /* quota / private mode — memory above is still correct this session */
  }
  return null;
}

export function forgetThreadEverywhere(
  viewerId: string,
  isThread: (thread: MailThreadSummary) => boolean
): void {
  const drop = (entry: MailListCacheEntry): MailListCacheEntry | null => {
    const threads = entry.threads.filter((t) => !isThread(t));
    if (threads.length === entry.threads.length) return null;
    return { threads, nextCursor: entry.nextCursor };
  };

  const prefix = `${viewerId}\0`;
  for (const [memKey, entry] of mailThreadsMemory) {
    if (!memKey.startsWith(prefix)) continue;
    const next = drop(entry);
    if (next) mailThreadsMemory.set(memKey, next);
  }

  if (typeof window === "undefined") return;
  try {
    const storageKey = mailThreadsStorageKey(viewerId);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const all = JSON.parse(raw) as Record<string, MailListCacheEntry>;
    let changed = false;
    for (const [key, entry] of Object.entries(all)) {
      if (!entry || !Array.isArray(entry.threads)) continue;
      const next = drop(entry);
      if (next) {
        all[key] = next;
        changed = true;
      }
    }
    if (changed) localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    /* quota / private mode — memory is still correct this session */
  }
}

export function writeCachedList(
  viewerId: string,
  key: string,
  entry: MailListCacheEntry
): void {
  mailSessionWarmViewer = viewerId;
  const memKey = memoryListKey(viewerId, key);
  mailThreadsMemory.set(memKey, entry);
  try {
    const storageKey = mailThreadsStorageKey(viewerId);
    const raw = localStorage.getItem(storageKey);
    const all = (
      raw ? JSON.parse(raw) : {}
    ) as Record<string, MailListCacheEntry>;
    all[key] = entry;
    const keys = Object.keys(all);
    // Bound growth across filter/search variants.
    if (keys.length > 10) {
      for (const k of keys.slice(0, keys.length - 10)) {
        delete all[k];
        mailThreadsMemory.delete(memoryListKey(viewerId, k));
      }
    }
    localStorage.setItem(storageKey, JSON.stringify(all));
  } catch {
    /* quota / private mode — memory still works this session */
  }
}
