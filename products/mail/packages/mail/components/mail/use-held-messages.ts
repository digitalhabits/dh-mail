"use client";

/*
 * The Outbox, off MailPage: the messages the providers are holding to send
 * later, and the ones the worker gave up on.
 *
 * Owns: the held messages, their reads, and the two ways out for a message
 * that failed (send now, or cancel).
 *
 * Reads the list on mount, every minute, when the window gets focus, when a
 * thread says one changed, and when the worker says one went or failed.
 * That is its one effect. The page calls this hook where that effect always
 * stood. The rows themselves are drawn by the page.
 */

import * as React from "react";

import { toast } from "@/lib/mail/toast";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { onScheduledChanged } from "@/lib/mail/scheduled-events";
import type { MailScheduledMessage } from "@/lib/mail/types";

export function useHeldMessages() {
  /**
   * What the providers are holding, across every mailbox that can hold.
   *
   * Its own group above the days, and only when there is something in it —
   * an empty heading is one more thing to read and rule out. Refreshed on a
   * slow timer so a row leaves the group when its message goes.
   */
  const [heldMessages, setHeldMessages] = React.useState<
    MailScheduledMessage[]
  >([]);
  const loadHeldMessages = React.useCallback(async () => {
    try {
      const json = await apiJson<{ messages?: MailScheduledMessage[] }>(
        "/api/mail/scheduled"
      );
      setHeldMessages(json.messages ?? []);
    } catch {
      // No Outlook, or the provider would not say. Show no group.
      setHeldMessages([]);
    }
  }, []);
  /** Try a failed message again, or let it go. */
  const actOnHeld = React.useCallback(
    async (held: MailScheduledMessage, action: "sendNow" | "cancel") => {
      try {
        await apiJson("/api/mail/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: held.account, id: held.id, action }),
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't change the message");
      }
      void loadHeldMessages();
    },
    [loadHeldMessages]
  );
  React.useEffect(() => {
    void loadHeldMessages();
    const timer = window.setInterval(() => void loadHeldMessages(), 60_000);
    const onFocus = () => void loadHeldMessages();
    window.addEventListener("focus", onFocus);
    // The thread says so the moment one is cancelled, sent, or edited. The
    // timer is for messages that leave on their own, at their time.
    const stopListening = onScheduledChanged(() => void loadHeldMessages());
    // And the worker says when one has gone, or has been given up, so the
    // Outbox changes as it happens rather than at the next minute.
    let cancelled = false;
    const unlisten: (() => void)[] = [];
    const tauriEvent = (window as unknown as {
      __TAURI__?: { event?: { listen: (name: string, cb: () => void) => Promise<() => void> } };
    }).__TAURI__?.event;
    if (tauriEvent?.listen) {
      for (const name of ["mail-sync-sent", "mail-sync-send-failed"]) {
        void tauriEvent
          .listen(name, () => void loadHeldMessages())
          .then((fn) => {
            if (cancelled) fn();
            else unlisten.push(fn);
          })
          .catch(() => {});
      }
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      stopListening();
      for (const fn of unlisten) fn();
    };
  }, [loadHeldMessages]);

  return { heldMessages, actOnHeld };
}
