/**
 * Navigation, for a build with no server.
 *
 * A server host asks Next to re-read server-rendered data after a change. There
 * is no server here, but there is one thing the interface does not own: the
 * list of connected mailboxes, which App reads from the store and passes down.
 * Mail changes that list from its settings panel and then calls `refresh`, so
 * this turns the call into a message App can hear.
 *
 * Everything else mail renders from its own state, and needs nothing here.
 */

const listeners = new Set<() => void>();

/** Run `fn` on every refresh. Answers the function that stops it. */
export function onMailRefresh(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useMailRouter(): { refresh: () => void } {
  return {
    refresh: () => {
      for (const fn of listeners) fn();
    },
  };
}
