"use client";

/*
 * Parts of useThreadPane (use-thread-pane.tsx): the reply's state, the room
 * it takes in the pane, and starting, quoting and forwarding it.
 * useThreadPane calls them in the order in which their hooks always ran.
 */

import { focusWhenReady } from "@/lib/mail/focus-when-ready";
import * as React from "react";
import { isPublicMailProduct } from "@/lib/mail/product-flavor";
import { outlookDraftAccount } from "@/lib/mail/outlook-handover";
import { useThreadAssistant } from "@/components/mail/team-layer";
import { useChatStyle } from "@/components/mail/use-chat-style";
import { useComposerAttachments } from "@/components/mail/use-composer-attachments";
import { useForwardFiles } from "@/components/mail/use-forward-files";
import { findLoadedMessage } from "@/components/mail/thread-messages";
import { replyTargets } from "@/lib/mail/reply-target";
import { useComposerHome } from "@/components/mail/use-composer-home";
import { useThreadComposerState } from "@/components/mail/use-thread-composer";
import { useReplyBand } from "@/components/mail/use-thread-pane-geometry";
import { readImageChoices } from "@/components/mail/MailBubble";
import { printMailMessages } from "@/components/mail/print-mail";
import { fetchSignatureSettings, type SignatureSettings } from "@/components/mail/SignatureDialog";
import {
  useCanSendLater,
  useOutlookAccounts,
} from "@/lib/mail/use-outlook-accounts";
import { useComposerHeightPx, useComposerWidthPct } from "@/components/mail/use-mail-layout";
import { type RichTextEditorHandle } from "@/components/ui/RichTextEditor";
import { htmlToPlainText } from "@/lib/client-email-html";
import { signsThisReply } from "@/lib/mail/signature-rules";
import { recipientsFromEmails } from "@/lib/mail/contact-list-types";
import { replyFields } from "@/lib/mail/thread-composer-state";
import { useAddressMenu } from "@/components/mail/AddressMenu";
import type { MailAttachment } from "@/lib/mail/types";
import { useThreadScheduled } from "./use-thread-scheduled";
import type { useThreadPaneSetup } from "@/components/mail/use-thread-pane-setup";
import type { useComposerAndStream } from "@/components/mail/use-thread-pane-flow";
import type { ThreadPaneProps } from "@/components/mail/use-thread-pane";

/** The reply's state, Send later, Outlook, the scheduled replies and the signature. */
export function useReplyState({
  account,
  setThread,
  threadId,
}: Pick<ReturnType<typeof useThreadPaneSetup>, "setThread"> &
  { account: ThreadPaneProps["account"]; threadId: ThreadPaneProps["threadId"] }) {
  /* What the message being written holds — see use-thread-composer.ts.
     The state stands here, above everything that reads `mode` and
     `fromAccount`. The code that drives it stands lower, at
     `useThreadComposer`, where the draft effects always ran. */
  const composer = useThreadComposerState(account);
  const {
    mode,
    reply,
    editorKey,
    subjectDraft,
    subjectOpen,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    quoteMessageId,
    showPreview,
    updateRecordsAfterSend,
    confirmDiscard,
    setReply,
    setSubjectDraft,
    setSubjectOpen,
    setToList,
    setCcList,
    setShowCc,
    setEditRecipients,
    setIncludeSignature,
    setFromAccount,
    setReplyFocus,
    setQuoteMessageId,
    setShowPreview,
    setConfirmDiscard,
  } = composer;
  /** Send later is Outlook's to promise — see `use-outlook-accounts`. */
  const canSendLater = useCanSendLater(fromAccount);
  /*
    Which mailbox a hand-over to Outlook would land in.

    A draft made over Graph has to be made in a mailbox Graph holds — but
    that need not be the one the reply is written from. The reason to
    finish a mail in Outlook is usually that Outlook is the only place an
    address can be sent from at all, and that address is rarely the one
    whose mailbox the thread arrived in.

    So: this mailbox when it is an Outlook one, which keeps the draft in
    the conversation it answers; otherwise the first Outlook mailbox there
    is, which starts a new message from a different address — see the
    hand-over for what it does and does not carry across.
  */
  const outlookAccounts = useOutlookAccounts();
  const outlookTarget = React.useMemo(
    () => outlookDraftAccount(outlookAccounts, fromAccount),
    [outlookAccounts, fromAccount]
  );
  /*
    The button does not wait for a mailbox. The route that needs one is
    the better of the two — a real draft, in the conversation — but the one
    that needs nothing is the one that reaches the mailbox this app cannot
    sign in to, which is usually the mailbox the reader is reaching for.
  */
  const canOpenInOutlook = !isPublicMailProduct();
  /** True when the draft would leave from an address the composer does not name. */
  const outlookElsewhere = Boolean(outlookTarget) && outlookTarget !== fromAccount;
  const {
    actOnScheduled,
    loadScheduled,
    scheduled,
  } = useThreadScheduled({
    account,
    setThread,
    threadId,
  });
  const [sigSettings, setSigSettings] = React.useState<SignatureSettings | null>(
    null
  );
  const [sigDialogOpen, setSigDialogOpen] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    void fetchSignatureSettings(fromAccount)
      .then((s) => {
        if (!cancelled) setSigSettings(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fromAccount]);
  return { actOnScheduled, canOpenInOutlook, canSendLater, ccList, composer, confirmDiscard, editRecipients, editorKey, fromAccount, includeSignature, loadScheduled, mode, outlookElsewhere, outlookTarget, quoteMessageId, reply, replyFocus, scheduled, setCcList, setConfirmDiscard, setEditRecipients, setFromAccount, setIncludeSignature, setQuoteMessageId, setReply, setReplyFocus, setShowCc, setShowPreview, setSigDialogOpen, setSigSettings, setSubjectDraft, setSubjectOpen, setToList, showCc, showPreview, sigDialogOpen, sigSettings, subjectDraft, subjectOpen, toList, updateRecordsAfterSend };
}

/** The pane's refs and nodes, the reply band, attachments, forwarded files and the composer's size. */
export function useReplySpace({
  account,
  mode,
  replyFocus,
  thread,
}: Pick<ReturnType<typeof useThreadPaneSetup>, "thread"> &
  Pick<ReturnType<typeof useReplyState>, "mode" | "replyFocus"> &
  { account: ThreadPaneProps["account"] }) {
  /** A right-click on a name in the "Replying to" line. */
  const { openAddressMenu, addressMenu } = useAddressMenu();
  const replyRef = React.useRef<HTMLDivElement>(null);
  const replyEditorHandle = React.useRef<RichTextEditorHandle | null>(null);
  const recipientInputRef = React.useRef<HTMLInputElement>(null);
  /** The Cc field's box, for the Cc link in the "Replying to" line. */
  const ccInputRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  /**
   * The same element as `scrollRef`, but as state.
   *
   * An effect that wants to listen to the stream has to run when the
   * stream is there, and a ref does not say when that is. This pane
   * returns early while a thread loads, so an effect keyed on the thread
   * id alone runs once against nothing and never runs again — which is
   * how the button offering to go back to the newest message came to
   * appear only when the window itself fell short of the end, and never
   * from scrolling.
   */
  const [streamNode, setStreamNode] = React.useState<HTMLDivElement | null>(
    null
  );
  const setScrollNode = React.useCallback((node: HTMLDivElement | null) => {
    scrollRef.current = node;
    setStreamNode(node);
  }, []);
  /* The reply band's sweep, its resting height and the scroll from beside
     the box — see use-thread-pane-geometry.ts. */
  const {
    replyGrown,
    replyFocusSliding,
    replyBandRestRef,
    replyBandRef,
    composerColumnRef,
    scrollComposerFromBand,
  } = useReplyBand({ replyFocus, mode });
  /* The attachment strip, with paste and drop — see
     use-composer-attachments.ts. It stands where `useDraftAttachments`
     stood, so its effects keep their place. */
  const {
    attachItemsRef,
    attachItems,
    attachTotalBytes,
    attachmentsReady,
    addAttachFiles,
    removeAttach,
    clearAttachments,
    replaceAttachments,
    attachmentPayload,
    attachDragging,
    attachDropHandlers,
    attachPasteHandlers,
  } = useComposerAttachments({
    replyEditorHandle,
    pasteIntoWords: !thread?.chat,
  });
  /* What a forward carries — see use-forward-files.ts. It has no effects. */
  const {
    forwardFiles,
    forwardFilesBusy,
    setForwardIncludeFiles,
    beginForwardFiles,
    restoreForwardBoxes,
  } = useForwardFiles({
    account,
    attachItemsRef,
    addAttachFiles,
    removeAttach,
  });
  const [attachmentPreview, setAttachmentPreview] = React.useState<{
    messageId: string;
    attachment: MailAttachment;
  } | null>(null);
  /** The message whose source is open over the thread, by id. */
  const [originalOf, setOriginalOf] = React.useState<string | null>(null);
  // Another thread, another set of messages: the sheet does not follow.
  React.useEffect(() => {
    setOriginalOf(null);
  }, [thread?.threadId]);
  /** The draft attachment open in the preview, by strip id. */
  const [draftPreviewId, setDraftPreviewId] = React.useState<string | null>(
    null
  );
  const { pct: composerWidthPct, startResize: startComposerResize } =
    useComposerWidthPct();
  const {
    height: composerHeight,
    set: composerHeightSet,
    startResize: startComposerHeightResize,
  } = useComposerHeightPx();
  const forwarding = mode === "forward";
  return { addAttachFiles, addressMenu, attachDragging, attachDropHandlers, attachItems, attachPasteHandlers, attachTotalBytes, attachmentPayload, attachmentPreview, attachmentsReady, beginForwardFiles, ccInputRef, clearAttachments, composerColumnRef, composerHeight, composerHeightSet, composerWidthPct, draftPreviewId, forwardFiles, forwardFilesBusy, forwarding, openAddressMenu, originalOf, recipientInputRef, removeAttach, replaceAttachments, replyBandRef, replyBandRestRef, replyEditorHandle, replyFocusSliding, replyGrown, replyRef, restoreForwardBoxes, scrollComposerFromBand, scrollRef, setAttachmentPreview, setDraftPreviewId, setForwardIncludeFiles, setOriginalOf, setScrollNode, startComposerHeightResize, startComposerResize, streamNode };
}

/** Starting a reply, quoting, printing, the chat style and the assistant. */
export function useReplyFlow({
  account,
  attachItems,
  beginForwardFiles,
  ccList,
  closeComposer,
  composerSnapshotRef,
  confirmDiscard,
  counterpartEmail,
  counterpartName,
  discardedKeyRef,
  draftRef,
  floating,
  focusReply,
  handOverComposer,
  importedDraftRef,
  importedForThreadRef,
  inPeople,
  loadImagesByDefault,
  mode,
  olderParts,
  onChatPromoted,
  onDraftDiscarded,
  onFloatReply,
  onUnfloatReply,
  openComposer,
  readableAttachments,
  recipientInputRef,
  replaceWords,
  reply,
  replyEditorHandle,
  replyFloating,
  restoreComposer,
  setCcList,
  setConfirmDiscard,
  setShowCc,
  setThread,
  setToList,
  sigSettings,
  thread,
  threadId,
  toList,
  updatingRecords,
}: Pick<ReturnType<typeof useThreadPaneSetup>, "loadImagesByDefault" | "olderParts" | "readableAttachments" | "setThread" | "thread" | "updatingRecords"> &
  Pick<ReturnType<typeof useReplyState>, "ccList" | "confirmDiscard" | "mode" | "reply" | "setCcList" | "setConfirmDiscard" | "setShowCc" | "setToList" | "sigSettings" | "toList"> &
  Pick<ReturnType<typeof useReplySpace>, "attachItems" | "beginForwardFiles" | "recipientInputRef" | "replyEditorHandle"> &
  Pick<ReturnType<typeof useComposerAndStream>, "closeComposer" | "composerSnapshotRef" | "discardedKeyRef" | "focusReply" | "handOverComposer" | "importedDraftRef" | "importedForThreadRef" | "openComposer" | "replaceWords" | "restoreComposer"> &
  { account: ThreadPaneProps["account"]; counterpartEmail: ThreadPaneProps["counterpartEmail"]; counterpartName: ThreadPaneProps["counterpartName"]; draftRef: ThreadPaneProps["draftRef"]; floating: ThreadPaneProps["floating"]; inPeople: ThreadPaneProps["inPeople"]; onChatPromoted: ThreadPaneProps["onChatPromoted"]; onDraftDiscarded: ThreadPaneProps["onDraftDiscarded"]; onFloatReply: ThreadPaneProps["onFloatReply"]; onUnfloatReply: ThreadPaneProps["onUnfloatReply"]; replyFloating: ThreadPaneProps["replyFloating"]; threadId: ThreadPaneProps["threadId"] }) {
  // Parsed once per change of the reply, not once per render: the pane
  // renders on every keystroke, and this parses HTML.
  const replyText = React.useMemo(() => htmlToPlainText(reply), [reply]);
  /* The chat style switch, and then the panel of the team
     layer. Their state lives in the hooks — see use-chat-style.ts and
     `@/components/mail/team-layer`. They stand here because the panel reads
     `replyText`, and they have no effects, so their place changes no effect
     order. */
  const { chatStyleBusy, setChatStyle } = useChatStyle({
    account,
    threadId,
    thread,
    counterpartName,
    counterpartEmail,
    onChatPromoted,
    setThread,
  });
  const {
    diaryBusy,
    diaryProposal,
    closeDiaryProposal,
    proposeDiaryFromThread,
    updateRecordsFromThread,
    draftingReply,
    draftNotes,
    draftWorking,
    stopDraft,
    draftReplyWithAssist,
    restoreDraftBrief,
    dismissDraftNotes,
  } = useThreadAssistant({
    account,
    threadId,
    thread,
    updatingRecords,
    readableAttachments,
    replyText,
    replaceWords,
    recipientState: { toList, ccList, setToList, setCcList, setShowCc },
    ownsReply: !replyFloating, // the floating card's pane does not hold the reply
  });
  /* Where the message being written lives: this pane, the floating card or
     the pop-out window — see use-composer-home.ts. It stands where the
     card, the discard and the pop-out code stood, so their three effects
     keep their place. */
  const {
    floatReply,
    closeFloatingCardRef,
    cardHadComposer,
    discardComposer,
    requestDiscard,
    popoutOpen,
    answerInPopout,
    adoptStoredDraft,
    bringBackPopout,
    popOutThread,
  } = useComposerHome({
    account,
    threadId,
    thread,
    floating,
    replyFloating,
    onFloatReply,
    onDraftDiscarded,
    draftRef,
    mode,
    reply,
    replyText,
    attachItems,
    confirmDiscard,
    setConfirmDiscard,
    closeComposer,
    restoreComposer,
    handOverComposer,
    composerSnapshotRef,
    discardedKeyRef,
    importedDraftRef,
    importedForThreadRef,
    focusReply,
    replyEditorHandle,
  });
  /**
   * Have I already written in this conversation?
   *
   * Which is the whole of the question the signature setting asks: it goes on
   * the message that introduces you, and not on the ones after it. A part of
   * a chat carried under an older subject is the same conversation, so it
   * counts too.
   */
  const alreadyWroteHere = React.useMemo(
    () =>
      [
        ...olderParts.flatMap((p) => p.messages),
        ...(thread?.messages ?? []),
      ].some((m) => m.own),
    [olderParts, thread]
  );
  /** Whether the reply about to be opened carries the signature. */
  const signsReply = React.useCallback(
    () => signsThisReply(sigSettings?.onReplies ?? "first", alreadyWroteHere),
    [sigSettings, alreadyWroteHere]
  );
  // Clicking the already-active toolbar icon closes the composer again.
  const startReply = (all: boolean) => {
    if (answerInPopout()) return;
    // The floating card is where this thread is answered — bring it home.
    if (replyFloating) {
      onUnfloatReply?.();
      return;
    }
    const next = all ? "replyAll" : "reply";
    if (mode === next) {
      closeComposer();
      return;
    }
    // No words in the patch: Reply becomes Reply all with the same editor.
    openComposer({
      mode: next,
      ...replyFields(thread?.reply, all),
      editRecipients: false,
      includeSignature: signsReply(),
      updateRecordsAfterSend: false,
    });
    focusReply();
  };
  /**
   * Print every message the thread has loaded, oldest first.
   *
   * Older pages that were never fetched are not in it. What prints is what the
   * reader can scroll to. The image choice is resolved the same way a bubble
   * resolves it, so a print matches what is on the screen.
   */
  /**
   * The thread in a window of its own.
   *
   * Shared by the toolbar button and the shortcut, so the two cannot come to
   * mean different things.
   */

  const printThread = React.useCallback(() => {
    if (!thread) return;
    const choices = readImageChoices();
    const messages = [
      ...olderParts.flatMap((part) => part.messages),
      ...thread.messages,
    ].map((message) => ({
      ...message,
      allowRemoteImages:
        loadImagesByDefault ||
        (choices[message.fromEmail.trim().toLowerCase()] ?? inPeople),
    }));
    printMailMessages({ subject: thread.subject, messages });
  }, [thread, olderParts, loadImagesByDefault, inPeople]);
  /**
   * Reply, quoting this message rather than the newest one.
   *
   * The composer opens at its ordinary height, not over the whole pane. The
   * whole pane hides the thread, and the thread is what the reader looked
   * at when they picked one message out of it to answer.
   *
   * Opening it also must say who the reply goes to. If it does not, the
   * recipient list stays empty and Send stays dead. The only other things
   * that fill it are the toolbar's own Reply and closing the composer. An open composer is left alone, draft and recipients and all.
   */
  const replyQuoting = React.useCallback(
    (messageId: string, all = false) => {
      // The pop-out answers this thread while it is open, and it has its own
      // reply-to-one-message on every bubble.
      if (answerInPopout()) return;
      if (replyFloating) {
        onUnfloatReply?.();
        return;
      }
      if (all) {
        // Reply all to this one message: everybody it went to, worked out
        // as the toolbar's Reply all works it out for the newest message.
        // Picked on purpose, so it sets the people of an open composer too.
        const picked = findLoadedMessage(thread, olderParts, messageId);
        const from = thread?.reply.from ?? account;
        const targets = picked
          ? replyTargets({
              from: picked.fromEmail,
              to: picked.toEmails ?? [],
              cc: picked.ccEmails ?? [],
              account: from,
            })
          : { allTo: thread?.reply.allTo ?? [], allCc: thread?.reply.allCc ?? [] };
        openComposer({
          quoteMessageId: messageId,
          mode: "replyAll",
          toList: recipientsFromEmails(targets.allTo),
          ccList: recipientsFromEmails(targets.allCc),
          ...(mode
            ? null
            : {
                editRecipients: false,
                includeSignature: signsReply(),
                updateRecordsAfterSend: false,
              }),
        });
      } else if (mode) {
        // A composer is open: only the pick changes.
        openComposer({ quoteMessageId: messageId });
      } else {
        // Answering one message answers the person who wrote it. On our own
        // message there is nobody to answer, so the thread decides.
        const picked = findLoadedMessage(thread, olderParts, messageId);
        const to =
          picked && !picked.own && picked.fromEmail
            ? [picked.fromEmail]
            : (thread?.reply.to ?? []);
        openComposer({
          quoteMessageId: messageId,
          mode: "reply",
          toList: recipientsFromEmails(to),
          ccList: recipientsFromEmails(thread?.reply.cc ?? []),
          editRecipients: false,
          includeSignature: signsReply(),
          updateRecordsAfterSend: false,
        });
      }
      focusReply();
    },
    [
      account,
      mode,
      olderParts,
      thread,
      signsReply,
      answerInPopout,
      onUnfloatReply,
      replyFloating,
      focusReply,
      openComposer,
    ]
  );
  const forwardMessage = React.useCallback((messageId: string) => {
    openComposer({
      quoteMessageId: messageId,
      mode: "forward",
      toList: [],
      ccList: [],
      showPreview: false,
      reply: "",
      updateRecordsAfterSend: false,
      // Forwards start without recipients, so open the chip editor right away.
      editRecipients: true,
    });
    // The files on the message go with it, as they do for a forward from the
    // header. Without this, a forward from a bubble left them behind.
    beginForwardFiles(findLoadedMessage(thread, olderParts, messageId));
    focusWhenReady(() => recipientInputRef.current);
  }, [openComposer, beginForwardFiles, olderParts, thread, recipientInputRef]);
  return { adoptStoredDraft, bringBackPopout, cardHadComposer, chatStyleBusy, closeDiaryProposal, closeFloatingCardRef, diaryBusy, diaryProposal, discardComposer, dismissDraftNotes, draftNotes, draftReplyWithAssist, draftWorking, draftingReply, floatReply, forwardMessage, popOutThread, popoutOpen, printThread, proposeDiaryFromThread, replyQuoting, replyText, requestDiscard, restoreDraftBrief, setChatStyle, signsReply, startReply, stopDraft, updateRecordsFromThread };
}
