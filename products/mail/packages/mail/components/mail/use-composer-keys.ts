"use client";

/*
 * The keys that work from inside the reply being written, off
 * useThreadPane: send, focus the message, and float it.
 *
 * The thread's own keys (use-thread-keys) stand down while the focus is in
 * a field, so a reply can contain the letter R. These have to work from
 * exactly there, so they listen separately. The refs always hold the
 * newest action, so the listener is added once per change of its list.
 *
 * One effect. useThreadPane calls this hook where it stood.
 */

import * as React from "react";

import { sendsFromHere, shortcutMatchesEvent } from "@/lib/mail/shortcuts";

import type { ThreadComposerMode } from "@/lib/mail/local-drafts";
import type { MailRecipient } from "@/lib/mail/contact-list-types";
import type { DraftAttachment } from "@/components/mail/attachment-files";
import type { FieldSetter } from "@/components/mail/use-thread-composer";
import type { MailShortcut, MailShortcutAction } from "@/lib/mail/shortcuts";

export function useComposerKeys({
  floatReply,
  floating,
  forwarding,
  mode,
  onUnfloatReply,
  pinchRef,
  send,
  sendForward,
  setReplyFocus,
  shortcuts,
}: {
  floatReply: (snapshot?: {
    mode: ThreadComposerMode | null;
    reply: string;
    subject: string;
    toList: MailRecipient[];
    ccList: MailRecipient[];
    showCc: boolean;
    editRecipients: boolean;
    includeSignature: boolean;
    fromAccount: string;
    replyFocus: boolean;
    attachItems: DraftAttachment[];
    quoteMessageId: string | null;
  }) => void;
  floating: boolean | undefined;
  forwarding: boolean;
  mode: ThreadComposerMode | null;
  onUnfloatReply: (() => void) | undefined;
  pinchRef: React.RefObject<HTMLDivElement | null>;
  send: (sendAt?: string, extras?: { proposeCrm?: boolean; }, pastAttachmentCheck?: boolean) => Promise<void>;
  sendForward: () => void;
  setReplyFocus: FieldSetter<"replyFocus">;
  shortcuts: Record<MailShortcutAction, MailShortcut>;
}) {
  /**
   * Send, focus-message, and float-message from inside the reply being written.
   *
   * The thread handler above stands down whenever the focus is in a field, so
   * a reply can contain the letter R. These have to work from exactly there,
   * so they listen separately. Send guards its own preconditions, so a press
   * with nothing to send does nothing.
   */
  const sendShortcutRef = React.useRef<() => void>(() => {});
  sendShortcutRef.current = () => {
    void (forwarding ? sendForward() : send());
  };
  const focusMessageShortcutRef = React.useRef<() => void>(() => {});
  focusMessageShortcutRef.current = () => {
    // Nothing to fill in the card: it is the message already. See the
    // button, which is not drawn there either.
    if (!mode || floating) return;
    setReplyFocus((v) => !v);
  };
  const floatMessageShortcutRef = React.useRef<() => void>(() => {});
  floatMessageShortcutRef.current = () => {
    if (floating) {
      onUnfloatReply?.();
      return;
    }
    if (!mode) return;
    floatReply();
  };
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const send = shortcutMatchesEvent(event, shortcuts.send);
      const focusMessage = shortcutMatchesEvent(event, shortcuts.focusMessage);
      const floatMessage = shortcutMatchesEvent(event, shortcuts.floatMessage);
      if (!send && !focusMessage && !floatMessage) return;
      /*
        The send key belongs to the box the caret is in — see sendsFromHere,
        which is the whole rule.

        This asked for the opposite of it. `Boolean(floating) !== inThisPane`
        let the thread's own composer send only while the caret was somewhere
        else, and the caret is in the reply box every time somebody writes a
        reply and presses the key. So Cmd+Enter did nothing, in the one place
        it is for.
      */
      const active = document.activeElement;
      if (
        !sendsFromHere({
          caretHere: Boolean(pinchRef.current?.contains(active)),
          caretNowhere: !active || active === document.body,
          floating: Boolean(floating),
        })
      ) {
        return;
      }
      event.preventDefault();
      if (focusMessage) {
        if (event.repeat) return;
        focusMessageShortcutRef.current();
        return;
      }
      if (floatMessage) {
        if (event.repeat) return;
        floatMessageShortcutRef.current();
        return;
      }
      sendShortcutRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, floating, pinchRef]);

  return {

  };
}
