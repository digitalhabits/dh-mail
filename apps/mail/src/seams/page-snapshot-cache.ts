/**
 * Instant tab paint, for a single-window app.
 *
 * A host with tabs keeps the previous tab painted while it navigates. This product
 * has one surface and never leaves it, so a snapshot buys nothing.
 */
export const PAGE_CACHE_KEYS = {
  mail: "dh-mail-standalone-page-v1",
} as const;

export function mailPageCacheKey(viewerId: string): string {
  return `${PAGE_CACHE_KEYS.mail}:${viewerId}`;
}

export function getPageSnapshot<T>(_key: string): T | null {
  return null;
}

export function setPageSnapshot<T>(_key: string, _data: T): void {
  /* nothing to keep */
}
