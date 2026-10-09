/**
 * What to open when the thing you were looking at goes away.
 *
 * Archiving, trashing, and filing all remove a row from under the reader. The
 * answer is the row below it — that is the direction a list is read in, and it
 * keeps a triage pass moving without the mouse. At the end of the list there
 * is nothing below, so the row above is taken instead: dropping to an empty
 * pane there would be a worse answer than the obvious one.
 *
 * The list must be the order the screen actually shows, not the order the data
 * arrived in, or "below" means something the user cannot see.
 */
export function successorAfterRemoving<T>(
  list: readonly T[],
  isRemoved: (item: T) => boolean
): T | undefined {
  const at = list.findIndex(isRemoved);
  if (at < 0) return undefined;
  return list[at + 1] ?? list[at - 1];
}

/**
 * The same, given two orders to choose between.
 *
 * The painted order is what the reader is looking at — the pins band, then
 * the visible flow — so it is the one to follow. It is put into a ref while
 * the component renders, though, and a removal happens from an event, so the
 * two can disagree about what is on screen. A row missing from the painted
 * order is not a reason to open nothing: dropping to the empty pane after a
 * delete reads as though the delete went wrong. Fall back to the plain list.
 */
export function successorInEitherOrder<T>(
  painted: readonly T[],
  fallback: readonly T[],
  isRemoved: (item: T) => boolean
): T | undefined {
  return painted.some(isRemoved)
    ? successorAfterRemoving(painted, isRemoved)
    : successorAfterRemoving(fallback, isRemoved);
}
