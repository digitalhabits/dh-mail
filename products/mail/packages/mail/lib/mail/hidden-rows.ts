/**
 * Rows hidden for a minute after the reader removed them, and from where.
 *
 * A row that is archived, deleted, filed or snoozed leaves the list at once,
 * before the provider has caught up. A list reply that was built before the
 * change, or a provider listing that lags, would bring it straight back. So
 * the row is kept out of the list for a minute.
 *
 * It was kept out of every list. A conversation keeps its id when it moves,
 * so the mail a reader sent to Trash was also hidden in Trash: for a minute
 * it was in no folder of the app at all, while the provider's own site showed
 * it in Trash. To the reader it had been deleted for good.
 *
 * So a hide belongs to the view it was made in. The row is hidden there, and
 * is shown everywhere else, which is where it went.
 *
 * No React here, so a suite can read it.
 */

/** Which rows are hidden until when, and the view each was hidden in. */
export type HiddenRows = {
  until: Map<string, number>;
  view: Map<string, string>;
};

export function newHiddenRows(): HiddenRows {
  return { until: new Map(), view: new Map() };
}

/** Hide `key` in `view` until `until`. */
export function hideRow(hidden: HiddenRows, key: string, view: string, until: number): void {
  hidden.until.set(key, until);
  hidden.view.set(key, view);
}

export function unhideRow(hidden: HiddenRows, key: string): void {
  hidden.until.delete(key);
  hidden.view.delete(key);
}

/** Forget the hides whose time is up. */
export function pruneHiddenRows(hidden: HiddenRows, now: number): void {
  for (const [key, until] of hidden.until) {
    if (until <= now) unhideRow(hidden, key);
  }
}

/**
 * Whether the row is to be left out of the list for `view` now. A hide made
 * with no view on record hides everywhere, as all of them once did.
 */
export function rowIsHidden(hidden: HiddenRows, key: string, view: string, now: number): boolean {
  const until = hidden.until.get(key);
  if (until == null || until <= now) return false;
  const madeIn = hidden.view.get(key);
  return madeIn == null || madeIn === view;
}
