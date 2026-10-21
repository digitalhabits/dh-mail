"use client";

/*
 * Everything ThreadPane knows and does, apart from what it draws.
 *
 * ThreadPane calls this once, at its top, and draws from what it returns.
 * The logic is in part hooks, by concern (use-thread-pane-setup.ts,
 * use-thread-pane-reply.ts, use-thread-pane-flow.ts). This hook calls them
 * in the order in which their hooks always ran, so the effects run in the
 * same order. The markup, which calls no hook, is in ThreadPane.tsx and in
 * the components it is split into.
 *
 * New logic for the page goes in a hook of its own (see the use-*.ts files
 * beside this one) and is called from here. `ThreadPaneModel` is what the
 * markup can read.
 */

import * as React from "react";

import { type MoveMenuHere } from "@/components/mail/MoveToFolderMenu";
import { type MailChatRef } from "@/lib/mail/chat-types";
import type { MailFolder } from "@/lib/mail/folder-types";
import type { MailMessage, MailThreadAction } from "@/lib/mail/types";
import { useThreadPaneSetup, useThreadChrome, useThreadPaneLate } from "@/components/mail/use-thread-pane-setup";
import { useReplyState, useReplySpace, useReplyFlow } from "@/components/mail/use-thread-pane-reply";
import { useComposerAndStream, useThreadSending } from "@/components/mail/use-thread-pane-flow";

export type ThreadPaneProps = {
  account: string;
  accounts: string[];
  oneMailbox?: boolean; // one mailbox's tab chosen: the heading says "You" (ThreadHeader)
  threadId: string;
  /** Search hit — open centered on this message instead of the tip. */
  focusMessageId?: string;
  /** First in the toolbar row: the way back to the list the thread came from. */
  toolbarLead?: React.ReactNode;
  /** The search's words, painted in the focus message. */
  searchTerms?: string[];
  zoom: number;
  onZoomAdjust: (delta: number) => void;
  /** Hide the mail list so the thread fills the pane. */
  focusMode: boolean;
  /**
   * Put the list away, or bring it back. Absent in the reader window, where
   * there is no list to put away — the control and its shortcut go with it.
   */
  onToggleFocus?: () => void;
  onArchive: () => void;
  /**
   * Handed the thread this pane is showing, by account and id.
   *
   * The pane knows what it shows — those are its own props — and the
   * parent knows what it thinks is selected. They are the same by
   * construction, and a delete is the one action where "by construction"
   * is not enough: it acts on whatever it is given, and the reader has no
   * way back from a wrong guess. So the pane says which.
   */
  onTrash: (thread: { account: string; threadId: string }) => void;
  /** Put a deleted thread back. Only reachable from the Trash view. */
  onRestore?: () => void;
  /** In Trash or Junk only. Not undoable: the page asks first. */
  onDeleteForever?: () => void;
  /** True when this thread was opened from Trash — it is already deleted. */
  inTrash?: boolean;
  /**
   * The reader stands in the Drafts view. The conversation on screen is
   * only the draft's home, and Delete has to mean the draft.
   */
  fromDrafts?: boolean;
  /** File it as junk. Filing, not reporting — see markMailThreadJunk. */
  onJunk?: () => void;
  /** Take it back out of Junk. The reason a Junk view is worth having. */
  onNotJunk?: () => void;
  /** True when this thread was opened from Junk. */
  inJunk?: boolean;
  /** Back to the inbox — the fourth of the rail's places in the move menu. */
  onMoveToInbox?: () => void;
  /** Which of them this conversation is in, so the menu can say so. */
  here?: MoveMenuHere;
  /** A forward asked for from a chat popout — see MailPage. */
  forwardMessageId?: string;
  onForwardStarted?: () => void;
  /** Something the list's right-click menu asked for — see the effect. */
  pendingAction?: MailThreadAction;
  onPendingActionDone?: () => void;
  onMoveToFolder: (folderName: string, create: boolean) => Promise<void>;
  folders: MailFolder[];
  onSnooze: (untilIso: string) => void;
  onCancelSnooze?: () => void;
  snoozedUntil?: string;
  /**
   * Read becomes unread and unread becomes read, the same as the quick action
   * on the list row. If it only marks unread, the button on an unread
   * thread does nothing that the reader can see.
   */
  onToggleUnread: () => void;
  /** Whether the open thread is unread, so the button can say which way. */
  unread?: boolean;
  /** Pin the thread to the top of the list, or take it back down. */
  onTogglePin?: () => void;
  /** Whether it is pinned, so the action on the strip can say so. */
  pinned?: boolean;
  /** Newest-message timestamp from the list; a change means new mail arrived. */
  refreshToken?: string;
  /** Message count from the list row — a short thread loads in one Gmail call. */
  messageCount?: number;
  /** Thread involves known contacts — remote images load by default. */
  inPeople: boolean;
  /**
   * Ignored. The prop stays until its pass-site in MailPage can be
   * removed.
   */
  showAddToPeople?: boolean;
  counterpartName: string;
  counterpartEmail: string;
  onChatPromoted: (chat: MailChatRef) => void;
  /** Rotate / jump-to-part: open a different provider thread in this conversation. */
  /**
   * Move the pane to another provider thread of the same conversation.
   *
   * `focusMessageId` says where to land in it. Without one the part opens at
   * its newest message, which is right for a seam and wrong for a jump to the
   * beginning.
   */
  onChatThreadChanged: (
    threadId: string,
    chat: MailChatRef,
    focusMessageId?: string
  ) => void;
  onRecordsChanged: () => void;
  /**
   * Send the reply being written into a floating card, so the reader can
   * browse other threads while they write. The draft is persisted first;
   * the card reads the same draft, so nothing is handed over but the key.
   * `full` opens the card over the whole window, dimmed around it.
   */
  onFloatReply?: (opts?: { full?: boolean }) => void;
  /** This pane IS the floating card, and it opens over the whole window. */
  floatingStartsFull?: boolean;
  /**
   * This thread's reply is in the floating card right now. The pane keeps
   * its hands off the draft — no composer from it, no saves onto it — and
   * anything that would open the reply box asks the card home instead.
   */
  replyFloating?: boolean;
  /** Bring the floating reply back into this pane. */
  onUnfloatReply?: () => void;
  /**
   * Copy this message into a new compose, out of the thread.
   *
   * The list row does the same for the first own mail. This is how a
   * later one is picked.
   */
  onEditAsNew?: (message: MailMessage, subject: string) => void;
  /**
   * This pane IS the floating card: the composer alone, in a corner, while
   * another thread is read behind it.
   *
   * The same component, so the box that floats is the box that docks —
   * every control, every width rule, every handler. What it leaves out is
   * everything around the composer: the toolbar, the header, the stream.
   * It also keeps its hands off the window: a second pane answering the
   * same keys as the one on screen would send from whichever heard first.
   */
  floating?: boolean;
  /** Refresh Sent for the mailbox that just sent. */
  onSent?: (accountEmail: string) => void;
  /**
   * The draft this pane was holding has been thrown away.
   *
   * The Drafts view opens a draft by opening the conversation behind it,
   * so once the draft is gone there is nothing here the reader asked to
   * see — and a provider draft leaves a thread with no messages in it.
   */
  onDraftDiscarded?: () => void;
  /**
   * The provider's draft this pane was opened for, from the Drafts list:
   * a thread can load without it, and the discard then deleted nothing.
   */
  draftRef?: string;
};

export function useThreadPane(props: ThreadPaneProps) {
  const {
  account,
  accounts,
  threadId,
  focusMessageId,
  searchTerms,
  zoom,
  onZoomAdjust,
  focusMode,
  onToggleFocus,
  onArchive,
  onTrash,
  onRestore,
  onDeleteForever,
  inTrash = false,
  fromDrafts = false,
  onJunk,
  onNotJunk,
  inJunk = false,
  onMoveToInbox,
  here,
  forwardMessageId,
  onForwardStarted,
  pendingAction,
  onPendingActionDone,
  onMoveToFolder,
  folders,
  onSnooze,
  onCancelSnooze,
  snoozedUntil,
  onToggleUnread,
  unread = false,
  onTogglePin,
  pinned = false,
  refreshToken,
  messageCount,
  inPeople,
  counterpartName,
  counterpartEmail,
  onChatPromoted,
  onChatThreadChanged,
  onRecordsChanged,
  onFloatReply,
  replyFloating,
  onUnfloatReply,
  onEditAsNew,
  floating,
  onSent,
  onDraftDiscarded,
  draftRef,
} = props;
  const { chatParts, error, highlightMessageId, loadImagesByDefault, loadingNewer, loadingOlder, moveMenuSignal, olderParts, partMenuOpen, readableAttachments, recordsChanged, setMoveMenuSignal, setPartMenuOpen, setSnoozeMenuSignal, setThread, shortcuts, snoozeMenuSignal, stream, t, thread, updatingRecords } = useThreadPaneSetup({ account, onRecordsChanged, threadId });
  const { actOnScheduled, canOpenInOutlook, canSendLater, ccList, composer, confirmDiscard, editRecipients, editorKey, fromAccount, includeSignature, loadScheduled, mode, outlookElsewhere, outlookTarget, quoteMessageId, reply, replyFocus, scheduled, setCcList, setConfirmDiscard, setEditRecipients, setFromAccount, setIncludeSignature, setQuoteMessageId, setReply, setReplyFocus, setShowCc, setShowPreview, setSigDialogOpen, setSigSettings, setSubjectDraft, setSubjectOpen, setToList, showCc, showPreview, sigDialogOpen, sigSettings, subjectDraft, subjectOpen, toList, updateRecordsAfterSend } = useReplyState({ account, setThread, threadId });
  const { addAttachFiles, addressMenu, attachDragging, attachDropHandlers, attachItems, attachPasteHandlers, attachTotalBytes, attachmentPayload, attachmentPreview, attachmentsReady, beginForwardFiles, ccInputRef, clearAttachments, composerColumnRef, composerHeight, composerHeightSet, composerWidthPct, draftPreviewId, forwardFiles, forwardFilesBusy, forwarding, openAddressMenu, originalOf, recipientInputRef, removeAttach, replaceAttachments, replyBandRef, replyBandRestRef, replyEditorHandle, replyFocusSliding, replyGrown, replyRef, restoreForwardBoxes, scrollComposerFromBand, scrollRef, setAttachmentPreview, setDraftPreviewId, setForwardIncludeFiles, setOriginalOf, setScrollNode, startComposerHeightResize, startComposerResize, streamNode } = useReplySpace({ account, mode, replyFocus, thread });
  const { adjustZoomFromControls, awayFromLatest, canLoadOlderAcrossParts, closeComposer, composerSnapshotRef, discardedKeyRef, focusReply, goToLatestMessage, handOverComposer, headHasOlderInPart, importedDraftRef, importedForThreadRef, loadNewerMessages, loadOlderMessages, openComposer, pinchRef, replaceWords, restoreComposer, skipOpenPinRef } = useComposerAndStream({ account, attachItems, clearAttachments, composer, focusMessageId, messageCount, onZoomAdjust, refreshToken, replaceAttachments, replyEditorHandle, replyFloating, replyFocus, replyRef, scrollRef, stream, streamNode, thread, threadId, zoom });
  const { bandFills, card, compactComposer, compactThreadActions, fullWidthComposer, hidden, setPaneNode, setToolbarRowNode, showOverflowMenu, tightToolbar } = useThreadChrome({ floating, inJunk, inTrash, mode, olderParts, onTogglePin, onUnfloatReply, pinchRef, props, replyFocus, thread });
  const { adoptStoredDraft, bringBackPopout, cardHadComposer, chatStyleBusy, closeDiaryProposal, closeFloatingCardRef, diaryBusy, diaryProposal, discardComposer, dismissDraftNotes, draftNotes, draftReplyWithAssist, draftWorking, draftingReply, floatReply, forwardMessage, popOutThread, popoutOpen, printThread, proposeDiaryFromThread, replyQuoting, replyText, requestDiscard, restoreDraftBrief, setChatStyle, signsReply, startReply, stopDraft, updateRecordsFromThread } = useReplyFlow({ account, attachItems, beginForwardFiles, ccList, closeComposer, composerSnapshotRef, confirmDiscard, counterpartEmail, counterpartName, discardedKeyRef, draftRef, floating, focusReply, handOverComposer, importedDraftRef, importedForThreadRef, inPeople, loadImagesByDefault, mode, olderParts, onChatPromoted, onDraftDiscarded, onFloatReply, onUnfloatReply, openComposer, readableAttachments, recipientInputRef, replaceWords, reply, replyEditorHandle, replyFloating, restoreComposer, setCcList, setConfirmDiscard, setShowCc, setThread, setToList, sigSettings, thread, threadId, toList, updatingRecords });
  const { armedSendAt, clearForgottenAttachment, confirmingIds, dropSettledOutboxRows, earlierBySender, editOutboxSend, editingScheduled, forgottenAttachment, forwardSource, forwardSubject, handingOver, historyAppendix, metaById, newDayIds, openInOutlook, outbox, outgoingSubject, quoteFromMessage, quotePayload, quotedForReply, recipientName, replyBoxPlaceholder, replySubject, resetOutbox, retryOutboxSend, send, sendForward, sendQuickReply, senderName, sending, setArmedSendAt, setReplacesScheduled, startForward } = useThreadSending({ account, attachItems, attachmentPayload, attachmentsReady, beginForwardFiles, ccList, closeComposer, closeFloatingCardRef, composer, discardComposer, editRecipients, error, floating, focusReply, forwardFiles, forwarding, fromAccount, fromDrafts, importedDraftRef, inTrash, includeSignature, loadScheduled, mode, olderParts, onArchive, onChatPromoted, onChatThreadChanged, onDeleteForever, onSent, onToggleFocus, onTogglePin, onToggleUnread, onTrash, openComposer, outlookElsewhere, outlookTarget, popOutThread, printThread, quoteMessageId, readableAttachments, recipientInputRef, recordsChanged, reply, replyText, requestDiscard, restoreComposer, restoreForwardBoxes, setMoveMenuSignal, setSnoozeMenuSignal, setThread, shortcuts, showCc, sigSettings, signsReply, startReply, subjectDraft, thread, threadId, toList, updateRecordsAfterSend });
  const { bubbleActions, editScheduled, find, firstMessage, firstPeekAllowImages, firstPeekHtml, firstPeekOpen, goToFirstMessage, goToMessage, latestId, newestKnown, loadingToStart, setFirstPeekOpen, threadOverflows } = useThreadPaneLate({ account, adoptStoredDraft, dropSettledOutboxRows, floatReply, floating, focusReply, forwardMessage, forwardMessageId, forwarding, inPeople, loadImagesByDefault, mode, olderParts, onChatThreadChanged, onEditAsNew, onForwardStarted, onPendingActionDone, onUnfloatReply, openComposer, pendingAction, pinchRef, popOutThread, printThread, quoteFromMessage, replyQuoting, resetOutbox, scrollRef, send, sendForward, sendQuickReply, setOriginalOf, setQuoteMessageId, setReplacesScheduled, setReplyFocus, shortcuts, skipOpenPinRef, startForward, startReply, stream, thread, threadId });

  return {
    account,
    accounts,
    actOnScheduled,
    addAttachFiles,
    addressMenu,
    adjustZoomFromControls,
    draftNotes,
    draftWorking,
    attachDragging,
    attachDropHandlers,
    attachItems,
    attachPasteHandlers,
    attachTotalBytes,
    attachmentPreview,
    attachmentsReady,
    awayFromLatest,
    bandFills,
    bringBackPopout,
    bubbleActions,
    canLoadOlderAcrossParts,
    canOpenInOutlook,
    armedSendAt, setArmedSendAt, editingScheduled,
    canSendLater,
    card,
    cardHadComposer,
    ccList,
    chatParts,
    composer,
    chatStyleBusy,
    clearForgottenAttachment,
    closeDiaryProposal,
    compactComposer,
    compactThreadActions,
    composerColumnRef,
    composerHeight,
    composerHeightSet,
    composerSnapshotRef,
    composerWidthPct,
    confirmDiscard,
    confirmingIds,
    diaryBusy,
    diaryProposal,
    discardComposer,
    dismissDraftNotes,
    draftPreviewId,
    draftReplyWithAssist,
    draftingReply,
    editOutboxSend,
    editRecipients,
    editScheduled,
    editorKey,
    error,
    find,
    firstMessage,
    firstPeekAllowImages,
    firstPeekHtml,
    firstPeekOpen,
    floatReply,
    floating,
    focusMode,
    folders,
    forgottenAttachment,
    forwardFiles,
    forwardFilesBusy,
    forwardSource,
    forwardSubject,
    forwarding,
    fromAccount,
    fromDrafts,
    fullWidthComposer,
    goToFirstMessage,
    goToMessage,
    newestKnown,
    goToLatestMessage,
    handingOver,
    headHasOlderInPart,
    here,
    hidden,
    highlightMessageId,
    historyAppendix,
    focusMessageId,
    searchTerms,
    inPeople,
    inJunk,
    inTrash,
    includeSignature,
    latestId,
    loadNewerMessages,
    loadOlderMessages,
    loadingNewer,
    loadingOlder,
    loadingToStart,
    metaById,
    earlierBySender,
    mode,
    moveMenuSignal,
    newDayIds,
    olderParts,
    onArchive,
    onCancelSnooze,
    onChatThreadChanged,
    onDeleteForever,
    onFloatReply,
    onJunk,
    onMoveToFolder,
    onMoveToInbox,
    onNotJunk,
    onRestore,
    onSnooze,
    onToggleFocus,
    onTogglePin,
    onToggleUnread,
    onTrash,
    openAddressMenu,
    openInOutlook,
    originalOf,
    outbox,
    outgoingSubject,
    outlookElsewhere,
    outlookTarget,
    partMenuOpen,
    pinned,
    popOutThread,
    popoutOpen,
    printThread,
    proposeDiaryFromThread,
    quoteMessageId,
    quotePayload,
    quotedForReply,
    recipientInputRef,
    ccInputRef,
    recipientName,
    removeAttach,
    reply,
    replyBandRef,
    replyBandRestRef,
    replyBoxPlaceholder,
    replyEditorHandle,
    replyFocus,
    replyFocusSliding,
    replyGrown,
    replyRef,
    replySubject,
    replyText,
    requestDiscard,
    restoreDraftBrief,
    retryOutboxSend,
    scheduled,
    scrollComposerFromBand,
    send,
    sendForward,
    sendQuickReply,
    senderName,
    sending,
    setAttachmentPreview,
    setCcList,
    setChatStyle,
    setConfirmDiscard,
    setDraftPreviewId,
    setEditRecipients,
    setFirstPeekOpen,
    setForwardIncludeFiles,
    setFromAccount,
    setIncludeSignature,
    setOriginalOf,
    setPaneNode,
    setPartMenuOpen,
    setQuoteMessageId,
    setReply,
    setReplyFocus,
    setScrollNode,
    setShowCc,
    setShowPreview,
    setSigDialogOpen,
    setSigSettings,
    setSubjectDraft,
    setSubjectOpen,
    setToList,
    setToolbarRowNode,
    shortcuts,
    showCc,
    showOverflowMenu,
    showPreview,
    sigDialogOpen,
    sigSettings,
    snoozeMenuSignal,
    snoozedUntil,
    startComposerHeightResize,
    startComposerResize,
    startForward,
    startReply,
    stopDraft,
    subjectDraft,
    subjectOpen,
    t,
    thread,
    threadId,
    streamNode,
    threadOverflows,
    tightToolbar,
    toList,
    unread,
    updateRecordsFromThread, updateRecordsAfterSend, setUpdateRecordsAfterSend: composer.setUpdateRecordsAfterSend,
    updatingRecords,
    zoom,
  };
}

export type ThreadPaneModel = ReturnType<typeof useThreadPane>;
