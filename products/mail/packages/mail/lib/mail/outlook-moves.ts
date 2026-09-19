/**
 * Messages this app has just moved in an Outlook mailbox, so that the local
 * copy does not lose them between two folders.
 *
 * Graph gives a moved message a new id. The copy learns of a move in two
 * halves: the folder it left says "this id is gone", and the folder it went
 * to says "here is a new message". The halves do not arrive together. The
 * inbox is read every ten seconds and the other folders once a minute, and
 * Graph's change feed for a folder can run behind the move itself. The first
 * half used to delete the row at once. So a mail moved to Trash was shown in
 * Trash for a few seconds, then in no folder at all for a minute or more,
 * and then in Trash again. To the reader it had been deleted.
 *
 * So the first half is held back for a message that this app moved. The row,
 * which already wears its new label, stays where the reader put it. It goes
 * when the second half arrives under the new id, or after `HOLD_MS` if that
 * never comes, so a row cannot outlive the message for long.
 *
 * Keyed by the old message id alone. A Graph id is unique across mailboxes,
 * and the caller that moves a message has a token and no account name.
 *
 * No React and no store here, so a suite can read it.
 */

/** Longer than a walk of every folder and one lagging change feed. */
export const HOLD_MS = 3 * 60_000;

type Held = { newId: string | null; until: number; goneFromSource: boolean };

const held = new Map<string, Held>();

/** A message was moved: `oldId` is what it was, `newId` what Graph answered. */
export function noteOutlookMove(
  oldId: string,
  newId: string | null | undefined,
  now: number = Date.now()
): void {
  if (!oldId || oldId === newId) return;
  held.set(oldId, { newId: newId || null, until: now + HOLD_MS, goneFromSource: false });
}

/**
 * The ids a folder said were gone, less the ones this app moved: those rows
 * stay for now. What comes back is what to remove from the copy at once.
 */
export function removalsToApplyNow(removedIds: string[], now: number = Date.now()): string[] {
  const out: string[] = [];
  for (const id of removedIds) {
    const entry = held.get(id);
    if (!entry || entry.until <= now) {
      held.delete(id);
      out.push(id);
      continue;
    }
    entry.goneFromSource = true;
  }
  return out;
}

/**
 * The old rows whose time has come: the message arrived under its new id
 * (`arrivedIds`, from any folder's changes), or the hold ran out. Call after
 * every batch that was written, and once at the end of a pass with none.
 */
export function settledOutlookMoves(arrivedIds: string[], now: number = Date.now()): string[] {
  const arrived = new Set(arrivedIds);
  const out: string[] = [];
  for (const [oldId, entry] of held) {
    const replaced = entry.newId != null && arrived.has(entry.newId);
    if (!replaced && entry.until > now) continue;
    held.delete(oldId);
    // Run out with no word from the folder it left: that folder has not
    // said the message is gone, so the row is not ours to remove. When it
    // does say so, nothing holds the removal back any more.
    if (replaced || entry.goneFromSource) out.push(oldId);
  }
  return out;
}

/** For a suite, and for a mailbox that is disconnected. */
export function forgetOutlookMoves(): void {
  held.clear();
}

export function heldOutlookMoveCount(): number {
  return held.size;
}
