/**
 * The open person keeps their place in the list until the reader leaves.
 *
 * A stack sits where its newest conversation puts it. Delete that one, and
 * the newest is now older: the stack dropped down the list at once, under
 * the reader's pointer, and the next conversation opened somewhere out of
 * sight. It looked like a wrong click (2026-10-24).
 *
 * So while a person is the one open, their row is placed by the newest
 * time it had while open, not by the time it has now. It can still move
 * up: new mail from them is news, and the top is where news goes. When
 * another row is picked, or none, the hold ends and the row goes where its
 * mail puts it.
 *
 * No React here: the rules are the part a suite reads.
 */

export type PersonHold = { key: string; at: string };

type Placed = { key: string; lastAt: string };

/**
 * The hold after this paint. The same object when nothing changed, so a
 * caller that keeps it in state can tell.
 */
export function nextPersonHold(
  hold: PersonHold | null,
  openKey: string | null,
  rows: readonly Placed[]
): PersonHold | null {
  if (!openKey) return null;
  const row = rows.find((r) => r.key === openKey);
  // Gone for now (a list being read again): keep what was held.
  if (!row) return hold?.key === openKey ? hold : null;
  if (!hold || hold.key !== openKey) return { key: openKey, at: row.lastAt };
  return Date.parse(row.lastAt) > Date.parse(hold.at) ? { key: openKey, at: row.lastAt } : hold;
}

/**
 * The rows with the held one where its held time puts it, among the rows
 * that are not pinned. The same list when it is there already.
 */
export function placeHeldRow<T extends Placed>(
  rows: readonly T[],
  hold: PersonHold | null,
  isPinned: (row: T) => boolean
): T[] {
  if (!hold) return rows as T[];
  const from = rows.findIndex((r) => r.key === hold.key);
  if (from < 0 || isPinned(rows[from])) return rows as T[];
  const at = Date.parse(hold.at);
  if (!(Date.parse(rows[from].lastAt) < at)) return rows as T[];
  const rest = rows.filter((_, i) => i !== from);
  let to = rest.findIndex((r) => !isPinned(r) && Date.parse(r.lastAt) < at);
  if (to < 0) to = rest.length;
  if (to === from) return rows as T[];
  return [...rest.slice(0, to), rows[from], ...rest.slice(to)];
}

/** When a row is filed under a day heading: the held time for the held row. */
export function placedAt(row: Placed, hold: PersonHold | null): string {
  return hold && hold.key === row.key && Date.parse(hold.at) > Date.parse(row.lastAt)
    ? hold.at
    : row.lastAt;
}
