"use client";

/*
 * Requests from other windows, off MailPage: a forward or an Edit as new
 * asked for from a chat pop-out, and a message the planner wrote for the
 * composer.
 *
 * Owns: the listeners (the storage event, and the Tauri events when the
 * app has them) and the forward that waits for the reader to start it.
 *
 * Does not own: what the request then does. It opens a thread, a composer
 * or a copy through the page's own functions, passed in.
 *
 * Three effects, in the order they always ran. The page calls this hook
 * where they stood. The planner's message comes through the Tauri bridge
 * only, so no walk covers it; the other two are walked in
 * mounted-list-actions.
 */

import * as React from "react";

import {
  MAIL_EDIT_AS_NEW_REQUEST_KEY,
  MAIL_FORWARD_REQUEST_KEY,
  readComposeSeed,
  readEditAsNewRequest,
  readForwardRequest,
  type MailForwardRequest,
} from "@/lib/mail/popout";
import {
  newComposeDraftKey,
  saveComposeDraft,
  type DraftAttachmentSnapshot,
} from "@/lib/mail/local-drafts";

type OpenThread = {
  account: string;
  threadId: string;
  inCrm: boolean;
  focusMessageId?: string;
};

export function useWindowRequests({
  setComposing,
  setSelectedPersonKey,
  setSelected,
  startCompose,
  editAsNewMessageRef,
}: {
  setComposing: (composing: boolean) => void;
  setSelectedPersonKey: (key: string | null) => void;
  setSelected: (selected: OpenThread | null) => void;
  startCompose: (seed: {
    to: string[];
    subject: string;
    continuedFromLabel: string;
    draftKey?: string;
  }) => void;
  editAsNewMessageRef: React.RefObject<
    (
      row: { account: string; threadId: string },
      messageId?: string
    ) => Promise<void>
  >;
}) {
  /**
   * A forward asked for from a chat popout.
   *
   * That window has no recipient picker and no subject line, so it asks this
   * one. Open the thread and hand the message to the reader, which does have
   * a composer. Both channels, for the same reason the sent signal uses both.
   */
  const [pendingForward, setPendingForward] =
    React.useState<MailForwardRequest | null>(null);

  React.useEffect(() => {
    const take = (raw: unknown) => {
      const request = readForwardRequest(raw);
      if (!request) return;
      setComposing(false);
      setSelectedPersonKey(null);
      setSelected({
        account: request.account,
        threadId: request.threadId,
        inCrm: false,
      });
      setPendingForward(request);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MAIL_FORWARD_REQUEST_KEY || !event.newValue) return;
      take(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const tauriEvent = (
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
    ).__TAURI__?.event;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-forward", (event) => take(event.payload))
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      unlisten?.();
    };
  }, [setComposing, setSelectedPersonKey, setSelected]);

  /**
   * A message written by the planner, to open in the composer.
   *
   * The Facilitators tab writes the joining details for a course and hands
   * them to the shell (see readComposeSeed). Written here as a draft under
   * a fresh key, then the composer is opened on that key, the way a draft
   * continued from the list is. Heard as an event while this is up, and
   * asked for on load in case it was written before this was.
   */
  React.useEffect(() => {
    let cancelled = false;
    const take = async (raw: unknown) => {
      const seed = readComposeSeed(raw);
      if (!seed || cancelled) return;
      const recipient = (email: string) => ({ kind: "email" as const, email });
      const key = newComposeDraftKey();
      const attachments: DraftAttachmentSnapshot[] = seed.attachments.map(
        (file, index) => ({
          id: `${key}-${index}`,
          filename: file.filename,
          mimeType: file.mimeType,
          size: Math.floor((file.contentBase64.length * 3) / 4),
          progress: null,
          contentBase64: file.contentBase64,
        })
      );
      await saveComposeDraft({
        key,
        kind: "compose",
        from: "",
        subject: seed.subject,
        body: seed.bodyHtml,
        toList: seed.to.map(recipient),
        ccList: seed.cc.map(recipient),
        bccList: seed.bcc.map(recipient),
        showCc: seed.cc.length > 0,
        showBcc: seed.bcc.length > 0,
        includeSignature: true,
        attachments,
      });
      if (cancelled) return;
      startCompose({
        to: seed.to,
        subject: seed.subject,
        continuedFromLabel: "",
        draftKey: key,
      });
    };
    const bridge = (
      window as unknown as {
        __TAURI__?: {
          core?: { invoke?: (cmd: string) => Promise<unknown> };
          event?: {
            listen?: (
              name: string,
              handler: (event: { payload: unknown }) => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__;
    if (!bridge) return;
    let unlisten: (() => void) | null = null;
    if (bridge.event?.listen) {
      void bridge.event
        .listen("mail-compose-seed", (event) => void take(event.payload))
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    if (bridge.core?.invoke) {
      void bridge.core
        .invoke("take_mail_compose_seed")
        .then((seed) => (seed ? take(seed) : undefined))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [startCompose]);

  /**
   * Edit as new asked for from a chat popout.
   *
   * Same channels as a forward, but this goes straight to the composer.
   * Opening the thread would copy the newest mail, which is the thing the
   * reader is trying not to do.
   */
  React.useEffect(() => {
    const take = (raw: unknown) => {
      const request = readEditAsNewRequest(raw);
      if (!request) return;
      void editAsNewMessageRef.current(request, request.messageId);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MAIL_EDIT_AS_NEW_REQUEST_KEY || !event.newValue) {
        return;
      }
      take(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const tauriEvent = (
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
    ).__TAURI__?.event;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-edit-as-new", (event) => take(event.payload))
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      unlisten?.();
    };
  }, [editAsNewMessageRef]);

  /** The reader has started the forward; nothing is waiting any more. */
  const forwardStarted = React.useCallback(() => setPendingForward(null), []);

  return { pendingForward, forwardStarted };
}
