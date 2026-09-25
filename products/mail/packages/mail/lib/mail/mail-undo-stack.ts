/*
 * The stack behind Command+Z in the mail list, and behind the Undo button
 * on each toast.
 *
 * Pure: it keeps entries and gives them back. It knows nothing about
 * threads, toasts or requests. What an entry is, and how it is taken back,
 * is in `use-mail-undo.ts`.
 *
 * Two ways out:
 * - `pop` takes the newest entry. That is Command+Z.
 * - `take(id)` takes that one entry, wherever it stands. That is a toast's
 *   Undo: it takes back its own action, even when newer actions followed.
 *
 * The stack holds at most `limit` entries. The oldest one drops off the
 * bottom when a new one would go over.
 */

export type MailUndoStack<E extends { id: string }> = {
  push(entry: E): void;
  pop(): E | undefined;
  take(id: string): E | undefined;
  readonly size: number;
};

export const MAIL_UNDO_LIMIT = 50;

export function createMailUndoStack<E extends { id: string }>(
  limit: number = MAIL_UNDO_LIMIT
): MailUndoStack<E> {
  const entries: E[] = [];
  return {
    push(entry) {
      entries.push(entry);
      if (entries.length > limit) entries.shift();
    },
    pop() {
      return entries.pop();
    },
    take(id) {
      const idx = entries.findIndex((entry) => entry.id === id);
      if (idx < 0) return undefined;
      return entries.splice(idx, 1)[0];
    },
    get size() {
      return entries.length;
    },
  };
}
