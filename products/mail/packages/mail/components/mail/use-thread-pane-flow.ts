"use client";

/*
 * Parts of useThreadPane (use-thread-pane.tsx): the composer and the
 * stream joined together, and sending. useThreadPane calls them in the
 * order in which their hooks always ran.
 */

import { focusWhenReady } from "@/lib/mail/focus-when-ready";
import { earlierFromSameSender } from "@/lib/mail/repeat-signature";
import * as React from "react";
import { draftThreadProblem } from "@/lib/mail/thread-gone";
import { findLoadedMessage } from "@/components/mail/thread-messages";
import { useThreadSend } from "@/components/mail/use-thread-send";
import { useThreadComposer } from "@/components/mail/use-thread-composer";
import { useOutlookHandover } from "@/components/mail/use-outlook-handover";
import { useThreadZoom } from "@/components/mail/use-thread-pane-geometry";
import { useThreadStream } from "@/components/mail/use-thread-stream";
import { sameDay } from "@/lib/mail/date-format";
import {
  messageMeta,
  threadAuthorship,
  type MessageMeta,
} from "@/lib/mail/message-meta";
import { useReplyContent } from "./use-reply-content";
import { useThreadKeys } from "./use-thread-keys";
import type { useThreadPaneSetup } from "@/components/mail/use-thread-pane-setup";
import type { useReplyState } from "@/components/mail/use-thread-pane-reply";
import type { useReplySpace } from "@/components/mail/use-thread-pane-reply";
import type { useReplyFlow } from "@/components/mail/use-thread-pane-reply";
import type { ThreadPaneProps } from "@/components/mail/use-thread-pane";

/** The zoom, the reply's focus, the composer and the stream, joined. */
export function useComposerAndStream({
  account,
  attachItems,
  clearAttachments,
  composer,
  focusMessageId,
  messageCount,
  onZoomAdjust,
  refreshToken,
  replaceAttachments,
  replyEditorHandle,
  replyFloating,
  replyFocus,
  replyRef,
  scrollRef,
  stream,
  streamNode,
  thread,
  threadId,
  zoom,
}: Pick<ReturnType<typeof useThreadPaneSetup>, "stream" | "thread"> &
  Pick<ReturnType<typeof useReplyState>, "composer" | "replyFocus"> &
  Pick<ReturnType<typeof useReplySpace>, "attachItems" | "clearAttachments" | "replaceAttachments" | "replyEditorHandle" | "replyRef" | "scrollRef" | "streamNode"> &
  { account: ThreadPaneProps["account"]; focusMessageId: ThreadPaneProps["focusMessageId"]; messageCount: ThreadPaneProps["messageCount"]; onZoomAdjust: ThreadPaneProps["onZoomAdjust"]; refreshToken: ThreadPaneProps["refreshToken"]; replyFloating: ThreadPaneProps["replyFloating"]; threadId: ThreadPaneProps["threadId"]; zoom: ThreadPaneProps["zoom"] }) {
  /* Pinch and zoom — see use-thread-pane-geometry.ts. */
  const { pinchRef, takeZoomAnchorRef, zoomRef, adjustZoomFromControls } =
    useThreadZoom({
      zoom,
      onZoomAdjust,
      enabled: thread !== null && !replyFocus,
    });
  // The composer opening shrinks the scroller from its bottom edge, and
  // that is all. The thread is not scrolled to make up for it: the messages
  // moved every time the box opened, grew a line or closed. The box covers
  // the tail of the thread, and the tail is a scroll away.

  // The composer has only just opened and Quill mounts asynchronously, so keep
  // looking for the editor for a few frames before giving up on focusing it.
  /**
   * Put the caret in the reply box, and check that it landed.
   *
   * Not "focus the first editor you find". Adopting a draft remounts the
   * editor — a new key, so Quill is built again from the new body — and the
   * editor found on the first frame is thrown away a frame later, taking
   * the focus with it. That is why a message handed back from a pop-out
   * arrived in the box with the caret nowhere, and had to be clicked.
   *
   * So it keeps asking until the caret is actually in the box. It gives up
   * the moment the reader puts it somewhere themselves — focus that fights
   * the person typing is worse than no focus at all.
   *
   * "Somewhere themselves" means somewhere they went after asking for the
   * box. Where the focus already was when they asked is not a choice to be
   * left alone: a thread row is focusable, so clicking one and then
   * pressing Cmd+R leaves the focus on the row. If this reads that as the
   * reader having chosen the row, the box opens with the caret nowhere and
   * has to be clicked.
   */
  const focusReply = React.useCallback((caret: number | null = null) => {
    const asked = document.activeElement;
    let frames = 0;
    const tryFocus = () => {
      const box = replyRef.current;
      const editor = box?.querySelector<HTMLElement>(".ql-editor");
      const active = document.activeElement;
      if (editor && active === editor) {
        // Landed. Put the caret where the message was left, once — after
        // this the reader owns it, and moving it again would be the app
        // taking the place they had just chosen.
        if (caret != null) {
          replyEditorHandle.current?.setCaret(caret);
          caret = null;
        }
        return;
      }
      // Somewhere else, and not where it was when the box was asked for,
      // and not the body focus a window hands back on its way to being
      // active: the reader has chosen. Leave them alone.
      if (
        active &&
        active !== document.body &&
        active !== asked &&
        !box?.contains(active)
      )
        return;
      editor?.focus();
      // Longer than it takes Quill to mount, which is a lazy chunk and a
      // couple of frames of layout after that.
      if (frames++ < 60) requestAnimationFrame(tryFocus);
    };
    requestAnimationFrame(tryFocus);
    // It reads refs only, so one copy serves each render.
  }, [replyEditorHandle, replyRef]);
  /* The stored draft, and the ways the whole message changes at once — see
     use-thread-composer.ts. It stands where the draft effects stood, so
     they keep their place in the order. */
  const {
    open: openComposer,
    restore: restoreComposer,
    close: closeComposer,
    handOver: handOverComposer,
    replaceWords,
    composerSnapshotRef,
    discardedKeyRef,
    importedDraftRef,
    importedForThreadRef,
  } = useThreadComposer(composer, {
    account,
    threadId,
    thread,
    replyFloating,
    attachItems,
    replaceAttachments,
    clearAttachments,
  });
  /* The reader stream: loading, paging, the scroll pin and the zoom anchor
     — see use-thread-stream.ts. It stands where that code stood, so every
     effect keeps its place in the order. */
  const {
    loadOlderMessages,
    loadNewerMessages,
    headHasOlderInPart,
    canLoadOlderAcrossParts,
    captureZoomAnchor,
    awayFromLatest,
    goToLatestMessage,
    skipOpenPinRef,
  } = useThreadStream(stream, {
    account,
    threadId,
    focusMessageId,
    refreshToken,
    messageCount,
    zoom,
    zoomRef,
    scrollRef,
    streamNode,
  });
  takeZoomAnchorRef.current = captureZoomAnchor;
  return { adjustZoomFromControls, awayFromLatest, canLoadOlderAcrossParts, closeComposer, composerSnapshotRef, discardedKeyRef, focusReply, goToLatestMessage, handOverComposer, headHasOlderInPart, importedDraftRef, importedForThreadRef, loadNewerMessages, loadOlderMessages, openComposer, pinchRef, replaceWords, restoreComposer, skipOpenPinRef };
}

/** Forwarding, the thread's keys, what a send carries, the send itself, and handing a draft to Outlook. */
export function useThreadSending({
  account,
  attachItems,
  attachmentPayload,
  attachmentsReady,
  beginForwardFiles,
  ccList,
  closeComposer,
  closeFloatingCardRef,
  composer,
  discardComposer,
  editRecipients,
  error,
  floating,
  focusReply,
  forwardFiles,
  forwarding,
  fromAccount,
  fromDrafts,
  importedDraftRef,
  inTrash,
  includeSignature,
  loadScheduled,
  mode,
  olderParts,
  onArchive,
  onChatPromoted,
  onChatThreadChanged,
  onDeleteForever,
  onSent,
  onToggleFocus,
  onTogglePin,
  onToggleUnread,
  onTrash,
  openComposer,
  outlookElsewhere,
  outlookTarget,
  popOutThread,
  printThread,
  quoteMessageId,
  readableAttachments,
  recipientInputRef,
  recordsChanged,
  reply,
  replyText,
  requestDiscard,
  restoreComposer,
  restoreForwardBoxes,
  setConfirmDiscard,
  setMoveMenuSignal,
  setSnoozeMenuSignal,
  setThread,
  shortcuts,
  showCc,
  sigSettings,
  signsReply,
  startReply,
  subjectDraft,
  thread,
  threadId,
  toList,
  updateRecordsAfterSend,
}: Pick<ReturnType<typeof useThreadPaneSetup>, "error" | "olderParts" | "readableAttachments" | "recordsChanged" | "setMoveMenuSignal" | "setSnoozeMenuSignal" | "setThread" | "shortcuts" | "thread"> &
  Pick<ReturnType<typeof useReplyState>, "ccList" | "composer" | "editRecipients" | "fromAccount" | "includeSignature" | "loadScheduled" | "mode" | "outlookElsewhere" | "outlookTarget" | "quoteMessageId" | "reply" | "setConfirmDiscard" | "showCc" | "sigSettings" | "subjectDraft" | "toList" | "updateRecordsAfterSend"> &
  Pick<ReturnType<typeof useReplySpace>, "attachItems" | "attachmentPayload" | "attachmentsReady" | "beginForwardFiles" | "forwardFiles" | "forwarding" | "recipientInputRef" | "restoreForwardBoxes"> &
  Pick<ReturnType<typeof useComposerAndStream>, "closeComposer" | "focusReply" | "importedDraftRef" | "openComposer" | "restoreComposer"> &
  Pick<ReturnType<typeof useReplyFlow>, "closeFloatingCardRef" | "discardComposer" | "popOutThread" | "printThread" | "replyText" | "requestDiscard" | "signsReply" | "startReply"> &
  { account: ThreadPaneProps["account"]; floating: ThreadPaneProps["floating"]; fromDrafts: Exclude<ThreadPaneProps["fromDrafts"], undefined>; inTrash: Exclude<ThreadPaneProps["inTrash"], undefined>; onArchive: ThreadPaneProps["onArchive"]; onChatPromoted: ThreadPaneProps["onChatPromoted"]; onChatThreadChanged: ThreadPaneProps["onChatThreadChanged"]; onDeleteForever: ThreadPaneProps["onDeleteForever"]; onSent: ThreadPaneProps["onSent"]; onToggleFocus: ThreadPaneProps["onToggleFocus"]; onTogglePin: ThreadPaneProps["onTogglePin"]; onToggleUnread: ThreadPaneProps["onToggleUnread"]; onTrash: ThreadPaneProps["onTrash"]; threadId: ThreadPaneProps["threadId"] }) {
  const startForward = () => {
    if (mode === "forward") {
      closeComposer();
      return;
    }
    openComposer({
      mode: "forward",
      toList: [],
      ccList: [],
      showPreview: false,
      reply: "",
      includeSignature: signsReply(),
      updateRecordsAfterSend: false,
      subjectDraft: forwardSubject,
      subjectOpen: false,
      // Forwards start without recipients, so open the chip editor right away.
      editRecipients: true,
    });
    // The files on the message go with it, which is what a forward is
    // usually for. The box under the composer takes them off again.
    beginForwardFiles(forwardSource);
    focusWhenReady(() => recipientInputRef.current);
  };
  useThreadKeys({
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
    // The thread is gone, so its dialogs are not drawn: no question to ask.
    requestDiscard:
      fromDrafts && draftThreadProblem(error) ? discardComposer : requestDiscard,
    // Delete with a reply open and the focus outside it: always asked, even
    // over an empty reply, since the focus can slip out of a reply being
    // written and Backspace then lands here.
    requestDiscardAndTrash: () => setConfirmDiscard("andTrash"),
    setMoveMenuSignal,
    setSnoozeMenuSignal,
    shortcuts,
    startForward,
    startReply,
    threadId,
  });
  /** The message being forwarded or quoted: the newest one in the thread. */
  const forwardSource =
    (quoteMessageId ? findLoadedMessage(thread, olderParts, quoteMessageId) : undefined) ??
    thread?.messages[thread.messages.length - 1];
  /**
   * What each message still has to say above itself, and where a day turns.
   *
   * Both are answered against the message before, so they are worked out once
   * over the thread rather than by each bubble about itself.
   *
   * A part is a run of messages we hold; between two parts there is a seam and
   * an unknown number of messages we do not. The first message after a seam is
   * therefore compared with nothing — we cannot say what changed across a gap
   * we cannot see.
   */
  const { metaById, newDayIds, earlierBySender } = React.useMemo(() => {
    const segments = [
      ...olderParts.map((part) => part.messages),
      thread?.messages ?? [],
    ];
    const everything = segments.flat();
    const authorship = threadAuthorship(everything, account);
    const metaById = new Map<string, MessageMeta>();
    for (const segment of segments) {
      segment.forEach((message, i) => {
        metaById.set(
          message.id,
          messageMeta(message, segment[i - 1] ?? null, authorship)
        );
      });
    }
    const newDayIds = new Set<string>();
    everything.forEach((message, i) => {
      const previous = everything[i - 1];
      if (!message.sentAt) return;
      if (!previous || !sameDay(previous.sentAt, message.sentAt)) {
        newDayIds.add(message.id);
      }
    });
    // Each one's previous from the same sender, to fold a repeated signature.
    const earlierBySender = earlierFromSameSender(everything);
    return { metaById, newDayIds, earlierBySender };
  }, [olderParts, thread?.messages, account]);
  const {
    forwardSubject,
    historyAppendix,
    outgoingSubject,
    quoteFromMessage,
    quotePayload,
    quotedForReply,
    recipientName,
    replyBoxPlaceholder,
    replySubject,
    senderName,
    startsNewThread,
  } = useReplyContent({
    account,
    ccList,
    forwardSource,
    forwarding,
    fromAccount,
    olderParts,
    quoteMessageId,
    subjectDraft,
    thread,
    toList,
  });
  /* Send, forward, the outbox and Undo — see use-thread-send.ts. It has no
     effects. It reads the composer's fields one by one, and writes the
     composer only through `closeComposer` and `restoreComposer`. */
  const {
    armedSendAt, setArmedSendAt, setReplacesScheduled, editingScheduled, sending,
    outbox,
    confirmingIds,
    forgottenAttachment,
    clearForgottenAttachment,
    send,
    sendForward,
    sendQuickReply,
    retryOutboxSend,
    editOutboxSend,
    resetOutbox,
    dropSettledOutboxRows,
  } = useThreadSend({
    account,
    bccList: composer.bccList,
    threadId,
    thread,
    olderParts,
    setThread,
    mode,
    reply,
    replyText,
    subjectDraft,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    signatureHtml: composer.signatureHtml,
    fromAccount,
    quoteMessageId,
    updateRecordsAfterSend,
    forwardSource,
    forwardFiles,
    restoreForwardBoxes,
    outgoingSubject,
    replySubject,
    startsNewThread,
    quotePayload,
    historyAppendix,
    attachItems,
    attachmentPayload,
    attachmentsReady,
    closeComposer,
    restoreComposer,
    focusReply,
    closeFloatingCardRef,
    importedDraftRef,
    loadScheduled,
    readableAttachments,
    recordsChanged,
    onSent,
    onChatPromoted,
    onChatThreadChanged,
  });
  /* "Open in Outlook instead" — see use-outlook-handover.ts. It has no
     effects, and it writes nothing of the composer's. */
  const { handingOver, openInOutlook } = useOutlookHandover({
    account,
    threadId,
    thread,
    attachmentPayload,
    attachmentsReady,
    toList,
    ccList,
    fromAccount,
    outlookTarget,
    outlookElsewhere,
    historyAppendix,
    includeSignature,
    signatureHtml: composer.signatureHtml,
    quoteMessageId,
    quotePayload,
    reply,
    replyText,
    forwarding,
    forwardSource,
    outgoingSubject,
    signature: sigSettings?.signature,
    closeComposer,
  });
  return { armedSendAt, clearForgottenAttachment, confirmingIds, dropSettledOutboxRows, earlierBySender, editOutboxSend, editingScheduled, forgottenAttachment, forwardSource, forwardSubject, handingOver, historyAppendix, metaById, newDayIds, openInOutlook, outbox, outgoingSubject, quoteFromMessage, quotePayload, quotedForReply, recipientName, replyBoxPlaceholder, replySubject, resetOutbox, retryOutboxSend, send, sendForward, sendQuickReply, senderName, sending, setArmedSendAt, setReplacesScheduled, startForward };
}
