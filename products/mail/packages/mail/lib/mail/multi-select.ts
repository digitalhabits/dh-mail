/*
 * The rules of selecting more than one row, as pure functions.
 *
 * `use-mail-selection.ts` holds the state and calls these. Nothing here
 * knows about React, threads or people: a row is a key, and the list is the
 * order of keys as it is painted.
 */

/**
 * The selection after a shift-click or a Cmd-click on `rowKey`.
 *
 * Shift-click (`extend`) takes everything between the anchor and the row,
 * in painted order. With no anchor it is a click, and takes the row alone.
 * When either row is not in the painted order, it takes the two rows.
 *
 * Cmd-click adds the row, or takes it out again. The anchor joins on the
 * first Cmd-click, or the reader is told two rows are selected while one of
 * them is not marked.
 */
export function nextMultiSelection(
  current: Set<string>,
  rowKey: string,
  anchorKey: string | null,
  extend: boolean,
  order: () => string[]
): Set<string> {
  if (extend) {
    if (!anchorKey) return new Set([rowKey]);
    const keys = order();
    const a = keys.indexOf(anchorKey);
    const b = keys.indexOf(rowKey);
    if (a < 0 || b < 0) return new Set([anchorKey, rowKey]);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return new Set(keys.slice(lo, hi + 1));
  }
  const next = new Set(current);
  if (!next.size && anchorKey) next.add(anchorKey);
  if (next.has(rowKey)) next.delete(rowKey);
  else next.add(rowKey);
  return next;
}

/**
 * The selected rows, in painted order, each once.
 *
 * The painted order can hold one row twice (the pins band and the list
 * under it), so a row already taken is skipped.
 */
export function selectedInOrder<T>(
  painted: readonly T[],
  keys: Set<string>,
  keyOf: (row: T) => string
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of painted) {
    const key = keyOf(row);
    if (!keys.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Where to land once the selected rows are gone: the first row after the
 * last selected one that is not itself selected, else the last one before
 * it that is not. Null when every row was selected.
 */
export function rowAfterSelection<T>(
  painted: readonly T[],
  isSelected: (row: T) => boolean
): T | null {
  let lastIdx = -1;
  painted.forEach((row, i) => {
    if (isSelected(row)) lastIdx = i;
  });
  for (let i = lastIdx + 1; i < painted.length; i += 1) {
    if (!isSelected(painted[i])) return painted[i];
  }
  for (let i = lastIdx - 1; i >= 0; i -= 1) {
    if (!isSelected(painted[i])) return painted[i];
  }
  return null;
}
