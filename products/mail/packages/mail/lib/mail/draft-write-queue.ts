/**
 * Writes to one draft land in the order they were asked for.
 *
 * The store puts and deletes each open their own IndexedDB transaction, and
 * the browser promises nothing about which of two commits first. The save
 * that runs on a pause in the typing could land after the delete that runs
 * on Send — which put the sent message back on disk as a draft. The next
 * open of that thread then showed a draft of a message that had gone, and
 * sending it again sent the message twice.
 *
 * One queue per key. An action waits for the actions asked for before it,
 * and runs whether they worked or not — the store swallows its own errors,
 * and an earlier failure must not dam the queue. Different keys do not wait
 * for each other.
 */

const tails = new Map<string, Promise<unknown>>();

export function enqueueDraftWrite<T>(
  key: string,
  action: () => Promise<T>
): Promise<T> {
  const tail = tails.get(key) ?? Promise.resolve();
  const next = tail.then(action, action);
  tails.set(key, next);
  // Forget a settled tail, so keys do not accumulate for the life of the
  // page. Only the current tail: a later action has already replaced it.
  // Through a handled copy — the caller owns the real rejection, and this
  // bookkeeping must not double-report it as unhandled.
  void next.then(
    () => {},
    () => {}
  ).then(() => {
    if (tails.get(key) === next) tails.delete(key);
  });
  return next;
}
