"use client";

/*
 * The main window's side of a send that a reply window hands over, off
 * MailPage. See use-send-launch.ts for the steps and
 * lib/mail/send-handover.ts for the rule that only one window sends.
 *
 * Owns: the listener for the shell's "mail-send-handover" event, and the
 * way to open a conversation for an Undo of a message whose conversation
 * is not open.
 *
 * Does not own: the send. `takeSendHandover` claims the message and gives
 * it to the conversation's pane, or runs its count with no pane.
 *
 * One effect. The event comes through the Tauri bridge only: there is no
 * reply window outside the desktop app.
 */

import * as React from "react";

import { setSendHandoverHost, takeSendHandover } from "@/components/mail/send-launch";
import { SEND_HANDOVER_KEEP_MS } from "@/lib/mail/send-handover";
import { idbHandoverRows } from "@/lib/mail/send-handover-store";

type OpenThread = { account: string; threadId: string; inPeople: boolean };

export function useSendHandover({
  setComposing,
  setSelectedPersonKey,
  setSelected,
}: {
  setComposing: (composing: boolean) => void;
  setSelectedPersonKey: (key: string | null) => void;
  setSelected: (selected: OpenThread | null) => void;
}) {
  React.useEffect(() => {
    const listen = (
      window as unknown as {
        __TAURI__?: {
          event?: {
            listen?: (
              name: string,
              handler: (event: { payload: unknown }) => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__?.event?.listen;
    if (!listen) return;
    const dropHost = setSendHandoverHost({
      openThread: (account, threadId) => {
        setComposing(false);
        setSelectedPersonKey(null);
        setSelected({ account, threadId, inPeople: false });
      },
    });
    // Rows of offers that are long closed. Their messages left them then.
    void idbHandoverRows().prune(Date.now() - SEND_HANDOVER_KEEP_MS).catch(() => {});
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listen("mail-send-handover", (event) => {
      const id = (event.payload as { id?: unknown } | null)?.id;
      if (typeof id === "string" && id) void takeSendHandover(id);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
      dropHost();
    };
  }, [setComposing, setSelectedPersonKey, setSelected]);
}
