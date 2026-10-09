/**
 * "Delete forever", held back long enough for the reader to change their mind.
 *
 * Mail that is deleted for good cannot be put back: the provider has nothing
 * left to restore. So Undo cannot mean "put it back". It means "we had not
 * done it yet". The request is held for a few seconds, and the provider is
 * told only when nobody has taken it back. The same idea as a discarded draft
 * (`pending-discard.ts`) and a sent message (`undo-send.tsx`).
 *
 * One thing is the other way round here. When the window closes inside the
 * count, a held send goes and a held discard runs, because the reader meant
 * them and a mail left unsent is the worse end. A held delete is dropped. The
 * mail then stays in Trash, where the reader can find it, and that is the
 * safe way for this one to fail.
 *
 * No React here, so a suite can read it.
 */

/** Longer than Send's five: this is the one action with no way back. */
export const PURGE_UNDO_SECONDS = 8;

type Held = { timer: ReturnType<typeof setTimeout> };

const pending = new Set<Held>();

/**
 * Hold `run` for `delayMs`. `cancel` answers true when it stopped it, and
 * false when it had already run or was already cancelled. `run` never runs
 * twice, and never after a cancel.
 */
export function holdPurge(
  run: () => void,
  delayMs: number = PURGE_UNDO_SECONDS * 1000
): { cancel: () => boolean } {
  const held: Held = {
    timer: setTimeout(() => {
      if (!pending.delete(held)) return;
      run();
    }, delayMs),
  };
  pending.add(held);
  return {
    cancel: () => {
      if (!pending.delete(held)) return false;
      clearTimeout(held.timer);
      return true;
    },
  };
}

/** Everything still waiting is forgotten, and none of it runs. Returns how many. */
export function dropPendingPurges(): number {
  const count = pending.size;
  for (const held of pending) clearTimeout(held.timer);
  pending.clear();
  return count;
}

export function pendingPurgeCount(): number {
  return pending.size;
}
