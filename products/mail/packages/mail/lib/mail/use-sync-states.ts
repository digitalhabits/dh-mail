"use client";

/**
 * Every mailbox's sync state, live.
 *
 * Seeded from the store, then kept current by the worker's `mail-sync-state`
 * events. The list shows a line from it while a mailbox is being read for
 * the first time, and when a sync is paused with a reason.
 */

import * as React from "react";

import { forgetSyncStates, syncStates, SYNC_STATE_WINDOW_EVENT } from "@/lib/mail/local-store";
import { mailSay } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";
import type { MailSyncState } from "@/lib/mail/store/types";

type TauriEvent = {
  listen?: (
    name: string,
    handler: (event: { payload: unknown }) => void
  ) => Promise<() => void>;
};

function sorted(list: MailSyncState[]): MailSyncState[] {
  return [...list].sort(
    (a, b) => a.account.localeCompare(b.account) || a.folder.localeCompare(b.folder)
  );
}

export function useMailSyncStates(): MailSyncState[] {
  const [states, setStates] = React.useState<MailSyncState[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void syncStates().then((list) => {
      if (!cancelled) setStates(sorted(list));
    });
    const onWindowState = (event: Event) => {
      const next = (event as CustomEvent<MailSyncState>).detail;
      if (!next?.account) return;
      setStates((prev) => {
        const rest = prev.filter(
          (s) => !(s.account === next.account && s.folder === (next.folder ?? ""))
        );
        return sorted([...rest, { ...next, folder: next.folder ?? "" }]);
      });
    };
    window.addEventListener(SYNC_STATE_WINDOW_EVENT, onWindowState);
    const tauriEvent = (window as unknown as { __TAURI__?: { event?: TauriEvent } }).__TAURI__?.event;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-sync-state", (event) => {
          const next = event.payload as MailSyncState;
          if (!next?.account) return;
          forgetSyncStates();
          setStates((prev) => {
            const rest = prev.filter(
              (s) => !(s.account === next.account && s.folder === (next.folder ?? ""))
            );
            // In one order, whatever moved: the mailboxes swapped places
            // with every batch when the freshest went to the end.
            return sorted([...rest, { ...next, folder: next.folder ?? "" }]);
          });
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    // The server refused an action for good: the copy was reverted by the
    // next pass, and the reader is told which thread and why.
    let unlistenFailed: (() => void) | null = null;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-sync-action-failed", (event) => {
          const detail = event.payload as { account?: string; kind?: string; error?: string };
          toast.error(
            mailSay("actionRefused", { kind: detail.kind ?? "", account: detail.account ?? "" }),
            { description: detail.error }
          );
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlistenFailed = fn;
        })
        .catch(() => {});
    }
    let unlistenSend: (() => void) | null = null;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-sync-send-failed", (event) => {
          const detail = event.payload as { subject?: string; error?: string };
          toast.error(mailSay("sendRefused", { subject: detail.subject || "(no subject)" }), {
            description: `${detail.error ?? ""} ${mailSay("keptInOutbox")}`.trim(),
            duration: 15_000,
          });
        })
        .then((fn) => {
          if (cancelled) fn();
          else unlistenSend = fn;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener(SYNC_STATE_WINDOW_EVENT, onWindowState);
      unlisten?.();
      unlistenFailed?.();
      unlistenSend?.();
    };
  }, []);
  return states;
}
