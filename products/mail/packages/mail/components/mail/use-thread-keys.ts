"use client";

/*
 * The open thread's keys, off useThreadPane: reply, reply all, forward,
 * snooze, move, archive, delete, unread, print, pop out, pin and focus.
 *
 * Owns: the one keydown listener and when a key is left alone (typing, or
 * inside a modal dialog). Every action is the pane's, passed in.
 *
 * One effect, with no dependency list on purpose: it closes over composer
 * state that changes on nearly every key press. useThreadPane calls this
 * hook where the effect stood. The keys of the composer itself (send,
 * focus the message, float it) stay in useThreadPane.
 */

import * as React from "react";

import { actionForEvent } from "@/lib/mail/shortcuts";

import type { MailShortcut, MailShortcutAction } from "@/lib/mail/shortcuts";

export function useThreadKeys({
  account,
  floating,
  fromDrafts,
  inTrash,
  onArchive,
  onDeleteForever,
  onToggleFocus,
  onTogglePin,
  onToggleUnread,
  onTrash,
  popOutThread,
  printThread,
  requestDiscard,
  setMoveMenuSignal,
  setSnoozeMenuSignal,
  shortcuts,
  startForward,
  startReply,
  threadId,
}: {
  account: string;
  floating: boolean | undefined;
  fromDrafts: boolean;
  inTrash: boolean;
  onArchive: () => void;
  onDeleteForever: (() => void) | undefined;
  onToggleFocus: (() => void) | undefined;
  onTogglePin: (() => void) | undefined;
  onToggleUnread: () => void;
  onTrash: (thread: { account: string; threadId: string; }) => void;
  popOutThread: () => void;
  printThread: () => void;
  requestDiscard: () => void;
  setMoveMenuSignal: React.Dispatch<React.SetStateAction<number>>;
  setSnoozeMenuSignal: React.Dispatch<React.SetStateAction<number>>;
  shortcuts: Record<MailShortcutAction, MailShortcut>;
  startForward: () => void;
  startReply: (all: boolean) => void;
  threadId: string;
}) {
  /**
   * Keyboard shortcuts, while a thread is open.
   *
   * They live here rather than in MailPage because this is where the actions
   * are. A key press is ignored while the focus is in a field, so Cmd+R still
   * reloads the page everywhere else, and typing a reply is never intercepted.
   *
   * Expand-list lives on MailPage. Send, focus-message, and float-message
   * live on the composer.
   */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = actionForEvent(event, shortcuts);
      if (!action) return;
      const target = event.target as HTMLElement | null;
      // A key pressed inside a modal dialog belongs to the dialog.
      if (target?.closest('[role="dialog"][aria-modal="true"]')) return;
      const typing = Boolean(
        target?.closest('input, textarea, [contenteditable="true"]')
      );
      /**
       * Nearly all of these stand down while a reply is being written, so
       * Cmd+R still reloads and the letter R still types.
       *
       * Pop out is not one of them. It moves the conversation into a window
       * of its own, which is a thing to want most while answering it — and
       * the composer here keeps what was written, so nothing is left behind.
       */
      if (
        action === "expandList" ||
        action === "focusMessage" ||
        action === "send" ||
        action === "floatMessage"
      ) {
        return;
      }
      if (typing && action !== "popOut") return;
      event.preventDefault();
      /**
       * A held key repeats, and the second archive is not a second wish.
       *
       * Archiving hands the selection to the next thread, so a repeat acts
       * on a conversation the reader has never opened — hold Cmd+Shift+A a
       * beat too long and it machine-guns down the list, one toast per
       * thread nobody meant to touch. The same for delete, which is
       * Backspace with nothing held. One press, one act; after
       * preventDefault, so the held key does not fall back to the browser
       * (a repeating Cmd+R would reload).
       */
      if (event.repeat) return;
      switch (action) {
        case "reply":
          startReply(false);
          break;
        case "replyAll":
          startReply(true);
          break;
        case "forward":
          startForward();
          break;
        case "snooze":
          setSnoozeMenuSignal((n) => n + 1);
          break;
        case "moveToFolder":
          setMoveMenuSignal((n) => n + 1);
          break;
        case "archive":
          // The button is not there in Trash, so the key does nothing there.
          if (inTrash) break;
          onArchive();
          break;
        case "delete":
          /*
            In Trash the key asks the "Delete forever" question, as it does
            in Outlook and Apple Mail. It only opens the dialog. The focus
            there starts on Cancel and Return cancels, so the key alone, held
            or pressed twice, never deletes anything.
          */
          if (inTrash) {
            onDeleteForever?.();
            break;
          }
          /*
            In the Drafts view the key means the draft. It meant the
            conversation: deleting a draft sent its whole thread to the
            provider's Trash, and the toast named the thread's own
            subject — which, over a draft that had been given a new one,
            read as somebody else's mail going.

            With or without the composer open. A provider draft can open
            as a thread with no composer — it is imported once per thread,
            and only when the thread comes back carrying it — and the key
            then did nothing, so the draft looked unselected. The discard
            finds the provider's copy on the loaded thread by itself.
          */
          if (fromDrafts) {
            requestDiscard();
            break;
          }
          onTrash({ account, threadId });
          break;
        case "toggleUnread":
          onToggleUnread();
          break;
        case "print":
          printThread();
          break;
        case "popOut":
          popOutThread();
          break;
        case "togglePin":
          onTogglePin?.();
          break;
        case "focusThread":
          onToggleFocus?.();
          break;
      }
    };
    if (floating) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // No dependency list on purpose: the handler closes over composer state
    // that changes on nearly every keystroke, and one listener swapped per
    // render is cheaper than a list that goes stale.
  });

  return {

  };
}
