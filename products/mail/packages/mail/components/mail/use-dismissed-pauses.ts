import * as React from "react";

import { isPauseDismissed, pauseNoticeKey, type PausedSync } from "@/lib/mail/sync-pause";

/* Outside React, so a closed notice stays closed when the list is drawn
   again, and in memory only, so it shows again at the next start if the
   fault is still there. */
let dismissed: ReadonlyMap<string, number | null> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The sync notices the reader closed, and the way to close one. */
export function useDismissedPauses() {
  const map = React.useSyncExternalStore(subscribe, () => dismissed, () => dismissed);
  const dismiss = React.useCallback((s: PausedSync) => {
    const next = new Map(dismissed);
    next.set(pauseNoticeKey(s), s.lastOkAt ?? null);
    dismissed = next;
    listeners.forEach((listener) => listener());
  }, []);
  const isDismissed = React.useCallback((s: PausedSync) => isPauseDismissed(map, s), [map]);
  return { dismiss, isDismissed };
}
