/**
 * Work held back long enough for the reader to change their mind.
 *
 * Discarding a reply throws away the draft the provider is holding, and a
 * Gmail draft cannot be un-deleted. So Undo cannot mean "put it back" — it
 * has to mean "we had not done it yet". This holds the request for the length
 * of the toast and sends it only when nobody has taken it back.
 *
 * The timer lives here rather than in the composer because the composer is
 * gone the moment the draft is discarded, and an unmounting component takes
 * its timers with it. Keyed by thread, so discarding the same one twice
 * replaces the first hold rather than sending two requests.
 *
 * No React here, so a suite can read it.
 */

type Held = { timer: ReturnType<typeof setTimeout>; run: () => void };

const pending = new Map<string, Held>();

/** How long a discarded draft is held before the provider is told. */
export const DISCARD_UNDO_MS = 8_000;

export function schedulePendingDiscard(
  key: string,
  run: () => void,
  delayMs: number = DISCARD_UNDO_MS
): void {
  cancelPendingDiscard(key);
  const timer = setTimeout(() => {
    pending.delete(key);
    run();
  }, delayMs);
  pending.set(key, { timer, run });
}

/** True when there was one to take back. */
export function cancelPendingDiscard(key: string): boolean {
  const held = pending.get(key);
  if (!held) return false;
  clearTimeout(held.timer);
  pending.delete(key);
  return true;
}

export function hasPendingDiscard(key: string): boolean {
  return pending.has(key);
}

/**
 * Run everything still waiting, now.
 *
 * For the one moment worth not waiting for: the window is closing, and the
 * reader has had their chance to take it back. Without this, quitting inside
 * the window would leave the draft in Gmail — which is a safe way to fail,
 * but a confusing one when the discard looked like it had happened.
 */
export function flushPendingDiscards(): void {
  const held = [...pending.values()];
  pending.clear();
  for (const { timer, run } of held) {
    clearTimeout(timer);
    run();
  }
}
