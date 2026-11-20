/**
 * The new id of each Exchange item that this app moved.
 *
 * An Exchange server gives an item a new id when the item moves to another
 * folder. The local copy takes the new id at once
 * (`exchange-actions.ts`). But a conversation that is open in the reader
 * still holds the old one, and it is not read again while its mailbox is
 * paused. A snoozed mail moves two times, to the Snoozed folder and back.
 * So a reader who opened a mail that woke from a snooze in a paused mailbox
 * could not get its files: the app asked the server with an id that the
 * server no longer knew (Mikkel, 2026-11-20).
 *
 * This list answers "what is that item called now?". It is in memory only.
 * After a restart, each conversation is read from the copy again, and the
 * copy has the new ids.
 */

const MAX_KEPT = 5000;

/** `account|old id` to the id the item got. Oldest first. */
const moved = new Map<string, string>();

const keyOf = (account: string, itemId: string) => `${account.trim().toLowerCase()}|${itemId}`;

/** The server moved this item, and this is its id now. */
export function noteExchangeItemMoved(account: string, oldId: string, newId: string): void {
  if (!oldId || !newId || oldId === newId) return;
  const key = keyOf(account, oldId);
  moved.delete(key);
  moved.set(key, newId);
  while (moved.size > MAX_KEPT) {
    const oldest = moved.keys().next().value;
    if (oldest === undefined) break;
    moved.delete(oldest);
  }
}

/**
 * The id that the item has now, through each move that this app made. The
 * same id when the app did not move the item.
 */
export function currentExchangeItemId(account: string, itemId: string): string {
  let id = itemId;
  // A move back can give an old id again: stop at an id that was seen.
  const seen = new Set<string>([id]);
  for (;;) {
    const next = moved.get(keyOf(account, id));
    if (!next || seen.has(next)) return id;
    seen.add(next);
    id = next;
  }
}

/** For the tests. */
export function forgetExchangeMoves(): void {
  moved.clear();
}
