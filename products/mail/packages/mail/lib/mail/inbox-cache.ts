import "server-only";

/**
 * Tiny invalidation surface so routes (folders, account connect) do not
 * import the full inbox module graph just to clear a Map.
 *
 * `inbox.ts` registers the real clearers on load.
 */

const listClearers: Array<() => void> = [];
const fullClearers: Array<() => void> = [];

export function registerInboxListCacheClear(fn: () => void): void {
  listClearers.push(fn);
}

export function registerMailFullCacheClear(fn: () => void): void {
  fullClearers.push(fn);
}

/** Clears the short-TTL list response cache. Keeps Gmail prior pages / history
 *  so the next incremental poll can still delta instead of rebuilding. */
export function invalidateInboxCache(): void {
  for (const fn of listClearers) fn();
}

/** Clears list cache, Gmail incremental memory, and the contact classifier. */
export function invalidateMailCaches(): void {
  invalidateInboxCache();
  for (const fn of fullClearers) fn();
}
