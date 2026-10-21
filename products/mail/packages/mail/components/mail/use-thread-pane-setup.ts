"use client";

/*
 * Parts of useThreadPane (use-thread-pane.tsx): the pane's setup, its
 * chrome (the floating card, the width, the toolbar), and the effects and
 * keys that run last. useThreadPane calls them in the order in which their
 * hooks always ran.
 */

import { FLOATING_REPLY_SIZE_KEY } from "@/lib/mail/storage-keys";
import * as React from "react";
import { notifyTeamDataChanged, useTeamProposing } from "@/components/mail/team-layer";
import { useThreadStart } from "@/components/mail/use-thread-start";
import { useThreadPaneWidth } from "@/components/mail/use-thread-pane-geometry";
import { useThreadStreamState } from "@/components/mail/use-thread-stream";
import { useThreadFind } from "@/components/mail/use-thread-find";
import { useLoadImagesByDefault } from "@/components/mail/MailBubble";
import {
  THREAD_TOOLBAR_SLOTS,
  useThreadToolbarFold,
  type ThreadToolbarSlot,
} from "@/components/mail/use-thread-toolbar-fold";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { oneInvitePerMessage } from "@/lib/mail/ics";
import { dropRemoteImagesForEditing } from "@/lib/mail/editor-html";
import {
  canReadAttachmentText,
  isReadableAttachment,
} from "@/lib/mail/attachment-text";
import { mailHasTeamRecords } from "@/lib/mail/product-flavor";
import type { MailMessage, MailScheduledMessage } from "@/lib/mail/types";
import { useMailT } from "@/lib/mail/i18n";
import { useFloatingCard } from "@/components/mail/floating-card";
import { useComposerKeys } from "./use-composer-keys";
import type { useReplyState } from "@/components/mail/use-thread-pane-reply";
import type { useComposerAndStream } from "@/components/mail/use-thread-pane-flow";
import type { useReplySpace } from "@/components/mail/use-thread-pane-reply";
import type { useReplyFlow } from "@/components/mail/use-thread-pane-reply";
import type { useThreadSending } from "@/components/mail/use-thread-pane-flow";
import type { ThreadPaneProps } from "@/components/mail/use-thread-pane";

/** The words, the stream's state, the records, the readable attachments, and the menus' signals. */
export function useThreadPaneSetup({
  account,
  onRecordsChanged,
  threadId,
}: { account: ThreadPaneProps["account"]; onRecordsChanged: ThreadPaneProps["onRecordsChanged"]; threadId: ThreadPaneProps["threadId"] }) {
  const t = useMailT();
  /* The reader stream's state — see use-thread-stream.ts. The state stands
     here, above everything that reads the thread. The code that drives it
     stands lower, at `useThreadStream`, where its effects always ran. */
  const stream = useThreadStreamState();
  const {
    thread,
    setThread,
    loadingOlder,
    loadingNewer,
    highlightMessageId,
    error,
    chatParts,
    olderParts,
  } = stream;
  // The team layer changed its records: the list moves the thread into
  // People, and the shell is told.
  const recordsChanged = React.useCallback(() => {
    onRecordsChanged();
    void notifyTeamDataChanged();
  }, [onRecordsChanged]);
  /**
   * Whether the team layer is still reading this thread.
   *
   * What it finds is not held here. It goes to the team layer's host,
   * above the pane: this pane is
   * made again for every thread, and the dialog has to stay open while the
   * reader opens other mail to check it against.
   */
  const updatingRecords = useTeamProposing(account, threadId);
  /** The thread's PDFs, which the team layer can read as context. */
  const readableAttachments = React.useMemo(() => {
    if (!canReadAttachmentText || !thread) return [];
    const out: { messageId: string; filename: string; mimeType: string; attachmentId: string }[] = [];
    for (const m of thread.messages) {
      for (const a of m.attachments ?? []) {
        if (isReadableAttachment(a.mimeType, a.filename)) {
          out.push({ messageId: m.id, filename: a.filename, mimeType: a.mimeType, attachmentId: a.attachmentId });
        }
      }
    }
    return out;
  }, [thread]);
  /*
  /** Print carries the reader's image choice, so a print matches the screen. */
  const [loadImagesByDefault] = useLoadImagesByDefault();
  const shortcuts = useMailShortcuts();
  // Bumping these opens a menu that owns its own open state.
  const [snoozeMenuSignal, setSnoozeMenuSignal] = React.useState(0);
  const [moveMenuSignal, setMoveMenuSignal] = React.useState(0);
  const [partMenuOpen, setPartMenuOpen] = React.useState(false);
  return { chatParts, error, highlightMessageId, loadImagesByDefault, loadingNewer, loadingOlder, moveMenuSignal, olderParts, partMenuOpen, readableAttachments, recordsChanged, setMoveMenuSignal, setPartMenuOpen, setSnoozeMenuSignal, setThread, shortcuts, snoozeMenuSignal, stream, t, thread, updatingRecords };
}

/** The floating card, the pane's width, and the toolbar's fold. */
export function useThreadChrome({
  floating,
  inJunk,
  inTrash,
  mode,
  olderParts,
  onTogglePin,
  onUnfloatReply,
  pinchRef,
  props,
  replyFocus,
  thread,
}: Pick<ReturnType<typeof useThreadPaneSetup>, "olderParts" | "thread"> &
  Pick<ReturnType<typeof useReplyState>, "mode" | "replyFocus"> &
  Pick<ReturnType<typeof useComposerAndStream>, "pinchRef"> &
  { floating: ThreadPaneProps["floating"]; inJunk: Exclude<ThreadPaneProps["inJunk"], undefined>; inTrash: Exclude<ThreadPaneProps["inTrash"], undefined>; onTogglePin: ThreadPaneProps["onTogglePin"]; onUnfloatReply: ThreadPaneProps["onUnfloatReply"]; props: ThreadPaneProps }) {
  /**
   * Out of the way, ordinary, or the whole window — see `floating-card`.
   * Only ever the first in a pane. Opened full from the pane's composer, a
   * card that leaves full goes home to the pane, not to the corner.
   */
  const card = useFloatingCard(
    Boolean(floating),
    FLOATING_REPLY_SIZE_KEY,
    props.floatingStartsFull,
    props.floatingStartsFull ? onUnfloatReply : undefined
  );
  const { cardRef, size: cardSize } = card;
  /**
   * The card has a height the reader gave it, so the reply fills the card:
   * the same layout as focus mode, where the reply fills the pane. Without
   * this the band keeps its own ceiling and the card grows empty.
   */
  const bandFills =
    replyFocus ||
    (Boolean(floating) && (Boolean(cardSize.height) || card.full));
  /* The pane's measured width and what it decides — see
     use-thread-pane-geometry.ts. */
  const {
    setPaneNode,
    compactThreadActions,
    compactComposer,
    fullWidthComposer,
  } = useThreadPaneWidth({ pinchRef, cardRef });
  const toolbarAttachmentCount = thread
    ? [
        ...olderParts.flatMap((p) => p.messages),
        ...thread.messages,
      ].reduce(
        (n, m) => n + oneInvitePerMessage(m.attachments).length,
        0
      )
    : 0;
  const toolbarReplyAll =
    thread != null &&
    new Set(
      [...thread.reply.allTo, ...thread.reply.allCc]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ).size > 1;
  const toolbarSlots = React.useMemo(() => {
    const skip = new Set<ThreadToolbarSlot>();
    if (!onTogglePin) skip.add("pin");
    if (!mailHasTeamRecords()) skip.add("records");
    return THREAD_TOOLBAR_SLOTS.filter((slot) => !skip.has(slot));
  }, [onTogglePin]);
  const {
    tight: tightToolbar,
    hidden,
    showOverflowMenu,
    setRowNode: setToolbarRowNode,
  } = useThreadToolbarFold(
      [
        toolbarReplyAll || mode === "replyAll" ? "all" : "",
        onTogglePin ? "pin" : "",
        inJunk ? "junk" : inTrash ? "trash" : "",
        mailHasTeamRecords() ? "records" : "",
        String(toolbarAttachmentCount),
      ].join("|"),
      toolbarSlots
    );
  return { bandFills, card, compactComposer, compactThreadActions, fullWidthComposer, hidden, setPaneNode, setToolbarRowNode, showOverflowMenu, tightToolbar };
}

/** The effects that run last, editing a scheduled reply, the bubbles' actions, the thread's start, find, and the composer's keys. */
export function useThreadPaneLate({
  account,
  adoptStoredDraft,
  dropSettledOutboxRows,
  floatReply,
  floating,
  focusReply,
  forwardMessage,
  forwardMessageId,
  forwarding,
  inPeople,
  loadImagesByDefault,
  mode,
  olderParts,
  onChatThreadChanged,
  onEditAsNew,
  onForwardStarted,
  onPendingActionDone,
  onUnfloatReply,
  openComposer,
  pendingAction,
  pinchRef,
  popOutThread,
  printThread,
  quoteFromMessage,
  replyQuoting,
  resetOutbox,
  scrollRef,
  send,
  sendForward,
  sendQuickReply,
  setOriginalOf,
  setQuoteMessageId,
  setReplacesScheduled,
  setReplyFocus,
  shortcuts,
  skipOpenPinRef,
  startForward,
  startReply,
  stream,
  thread,
  threadId,
}: Pick<ReturnType<typeof useThreadPaneSetup>, "loadImagesByDefault" | "olderParts" | "shortcuts" | "stream" | "thread"> &
  Pick<ReturnType<typeof useReplyState>, "mode" | "setQuoteMessageId" | "setReplyFocus"> &
  Pick<ReturnType<typeof useReplySpace>, "forwarding" | "scrollRef" | "setOriginalOf"> &
  Pick<ReturnType<typeof useComposerAndStream>, "focusReply" | "openComposer" | "pinchRef" | "skipOpenPinRef"> &
  Pick<ReturnType<typeof useReplyFlow>, "adoptStoredDraft" | "floatReply" | "forwardMessage" | "popOutThread" | "printThread" | "replyQuoting" | "startReply"> &
  Pick<ReturnType<typeof useThreadSending>, "dropSettledOutboxRows" | "quoteFromMessage" | "resetOutbox" | "send" | "sendForward" | "sendQuickReply" | "setReplacesScheduled" | "startForward"> &
  { account: ThreadPaneProps["account"]; floating: ThreadPaneProps["floating"]; forwardMessageId: ThreadPaneProps["forwardMessageId"]; inPeople: ThreadPaneProps["inPeople"]; onChatThreadChanged: ThreadPaneProps["onChatThreadChanged"]; onEditAsNew: ThreadPaneProps["onEditAsNew"]; onForwardStarted: ThreadPaneProps["onForwardStarted"]; onPendingActionDone: ThreadPaneProps["onPendingActionDone"]; onUnfloatReply: ThreadPaneProps["onUnfloatReply"]; pendingAction: ThreadPaneProps["pendingAction"]; threadId: ThreadPaneProps["threadId"] }) {
  /* The window comes to the front: look for a draft from the pop-out. The
     function stands higher, above the key that opens the pop-out. The
     effect stands here, where it always ran. */
  React.useEffect(() => {
    window.addEventListener("focus", adoptStoredDraft);
    return () => window.removeEventListener("focus", adoptStoredDraft);
  }, [adoptStoredDraft]);
  /** Take it back into the composer: it stops being held, and it is a draft. */
  const editScheduled = React.useCallback(
    (message: MailScheduledMessage) => {
      openComposer({
        mode: "reply",
        reply: message.bodyHtml
          ? dropRemoteImagesForEditing(message.bodyHtml)
          : message.bodyText,
      });
      // A copy to work on: the original stays until this one is sent.
      setReplacesScheduled({ account, id: message.id, sendAt: message.sendAt }); focusReply();
    },
    [account, focusReply, openComposer, setReplacesScheduled]
  );
  const bubbleActions = React.useCallback(
    (m: MailMessage) => ({
      onReact: (emoji: string) =>
        void sendQuickReply(emoji, quoteFromMessage(m)),
      onReplyTo: () => replyQuoting(m.id),
      onForward: () => forwardMessage(m.id),
      onEditAsNew: onEditAsNew
        ? () => onEditAsNew(m, thread?.subject ?? "")
        : undefined,
      onShowOriginal: () => setOriginalOf(m.id),
    }),
    [sendQuickReply,
      quoteFromMessage,
      replyQuoting,
      forwardMessage,
      onEditAsNew,
      thread?.subject, setOriginalOf]
  );
  /**
   * Start the forward another window asked for, once the message is here.
   *
   * The thread has to load first, so this waits for it rather than firing on
   * the request. Reported back so the request is not acted on twice.
   */
  React.useEffect(() => {
    if (!forwardMessageId || !thread) return;
    const known = [
      ...olderParts.flatMap((p) => p.messages),
      ...thread.messages,
    ].some((m) => m.id === forwardMessageId);
    if (!known) return;
    forwardMessage(forwardMessageId);
    onForwardStarted?.();
  }, [forwardMessageId, thread, olderParts, forwardMessage, onForwardStarted]);
  /**
   * An action the list asked for, carried out once the thread is here.
   *
   * The right-click menu on a row offers everything this strip does, and
   * five of those need the messages: a reply quotes them, a forward carries
   * them, printing lays them out, a pop-out seeds its window with them. A
   * row holds a summary and no messages at all, so the list opens the
   * thread and hands the action here — the same way a pop-out asks for a
   * forward it has no composer for.
   *
   * Waits for the thread rather than firing on the request, and reports
   * back so the request is not acted on twice.
   */
  React.useEffect(() => {
    if (!pendingAction || !thread) return;
    onPendingActionDone?.();
    switch (pendingAction) {
      case "reply":
        startReply(false);
        break;
      case "replyAll":
        startReply(true);
        break;
      case "forward":
        startForward();
        break;
      case "print":
        printThread();
        break;
      case "popOut":
        popOutThread();
        break;
    }
    // The handlers are rebuilt on nearly every render — see the shortcut
    // listener below, which keeps its own list empty for the same reason.
    // What decides this is the request and whether the thread has arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction, thread]);
  React.useEffect(() => {
    skipOpenPinRef.current = false;
    resetOutbox();
    setQuoteMessageId(null);
  }, [threadId, skipOpenPinRef, setQuoteMessageId, resetOutbox]);
  // Drop outbox rows once the provider message replaced the local-* bubble.
  React.useEffect(() => {
    if (!thread) return;
    dropSettledOutboxRows(thread);
  }, [thread, dropSettledOutboxRows]);
  const latestId = thread?.messages[thread.messages.length - 1]?.id;
  /* The thread's beginning: the chip in the header, the peek at the first
     message and the jump to the start — see use-thread-start.ts. It stands
     where that code stood, so its effects keep their place. */
  const {
    threadOverflows,
    firstPeekOpen,
    setFirstPeekOpen,
    firstMessage,
    firstPeekHtml,
    firstPeekAllowImages,
    loadingToStart,
    goToFirstMessage,
    goToMessage,
    newestKnown,
  } = useThreadStart(stream, {
    account,
    threadId,
    scrollRef,
    skipOpenPinRef,
    loadImagesByDefault,
    inPeople,
    onChatThreadChanged,
  });
  // Above the early returns below: hooks must run in the same order every
  // render. The key re-runs the search when messages arrive or expand, since
  // each one brings its own frame of text with it.
  const find = useThreadFind({
    rootRef: scrollRef,
    enabled: Boolean(thread),
    contentKey: [
      threadId,
      thread?.messages.length ?? 0,
      olderParts.length,
    ].join(":"),
  });
  useComposerKeys({
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
  });
  return { bubbleActions, editScheduled, find, firstMessage, firstPeekAllowImages, firstPeekHtml, firstPeekOpen, goToFirstMessage, goToMessage, latestId, newestKnown, loadingToStart, setFirstPeekOpen, threadOverflows };
}
