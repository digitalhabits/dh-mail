"use client";

/*
 * Everything ThreadPane knows and does, apart from what it draws.
 *
 * ThreadPane calls this once, at its top, and draws from what it returns.
 * The statements here are ThreadPane's own, in the order they ran, so the
 * hooks run in the same order as before. The markup, which calls no hook,
 * stayed in ThreadPane.tsx and in the components it is split into.
 *
 * New logic for the page goes in a hook of its own (see the use-*.ts files
 * beside this one) and is called from here. `ThreadPaneModel` is what the
 * markup can read.
 */

import * as React from "react";
import { isPublicMailProduct } from "@/lib/mail/product-flavor";
import { draftThreadProblem } from "@/lib/mail/thread-gone";
import { outlookDraftAccount } from "@/lib/mail/outlook-handover";

import { useThreadAssistant } from "@/components/mail/use-thread-assistant";
import { useComposerAttachments } from "@/components/mail/use-composer-attachments";
import { useForwardFiles } from "@/components/mail/use-forward-files";
import { useThreadSend } from "@/components/mail/use-thread-send";
import { useComposerHome } from "@/components/mail/use-composer-home";
import {
  useThreadComposer,
  useThreadComposerState,
} from "@/components/mail/use-thread-composer";
import { useOutlookHandover } from "@/components/mail/use-outlook-handover";
import { useThreadStart } from "@/components/mail/use-thread-start";
import { useReplyBand, useThreadPaneWidth, useThreadZoom } from "@/components/mail/use-thread-pane-geometry";
import {
  useThreadStream,
  useThreadStreamState,
} from "@/components/mail/use-thread-stream";
import { useThreadFind } from "@/components/mail/use-thread-find";
import { readImageChoices, useLoadImagesByDefault } from "@/components/mail/MailBubble";
import { printMailMessages } from "@/components/mail/print-mail";
import {
  THREAD_TOOLBAR_SLOTS,
  useThreadToolbarFold,
  type ThreadToolbarSlot,
} from "@/components/mail/use-thread-toolbar-fold";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { type MoveMenuHere } from "@/components/mail/MailFolders";
import { oneInvitePerMessage } from "@/lib/mail/ics";
import { fetchSignatureSettings, type SignatureSettings } from "@/components/mail/SignatureDialog";
import {
  useCanSendLater,
  useOutlookAccounts,
} from "@/lib/mail/use-outlook-accounts";
import { useComposerHeightPx, useComposerWidthPct } from "@/components/mail/use-mail-layout";
import { type RichTextEditorHandle } from "@/components/ui/RichTextEditor";
import { htmlToPlainText } from "@/lib/client-email-html";
import { signsThisReply } from "@/lib/mail/signature-rules";
import { dropRemoteImagesForEditing } from "@/lib/mail/editor-html";
import { type MailChatRef } from "@/lib/mail/chat-types";
import { recipientsFromEmails } from "@/lib/mail/contact-list-types";
import { useAddressMenu } from "@/components/mail/AddressMenu";
import { sameDay } from "@/lib/mail/date-format";
import {
  messageMeta,
  threadAuthorship,
  type MessageMeta,
} from "@/lib/mail/message-meta";
import type { MailFolder } from "@/lib/mail/folder-types";
import { useCrmProposing } from "@/components/mail/CrmProposalHost";
import {
  canReadAttachmentText,
  isReadableAttachment,
} from "@/lib/mail/attachment-text";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { notifyPlannerCrmChanged } from "@/lib/native-shell";
import type {
  MailAttachment,
  MailMessage,
  MailScheduledMessage,
  MailThreadAction,
} from "@/lib/mail/types";
import { useMailT } from "@/lib/mail/i18n";
import { useFloatingCard } from "@/components/mail/floating-card";
import { useReplyContent } from "./use-reply-content";
import { useThreadKeys } from "./use-thread-keys";
import { useThreadScheduled } from "./use-thread-scheduled";
import { useComposerKeys } from "./use-composer-keys";
export type ThreadPaneProps = {
  account: string;
  accounts: string[];
  threadId: string;
  /** Search hit — open centered on this message instead of the tip. */
  focusMessageId?: string;
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
   * on the list row. This used to only ever mark unread, which made the
   * button on an unread thread do the thing it already was.
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
  /** Thread involves CRM contacts — remote images load by default. */
  inCrm: boolean;
  /**
   * Ignored. There was a second CRM button that only showed for a thread no
   * record matched yet; the one button that replaced it is offered whenever
   * there is a CRM to read. The prop stays until its pass-site in MailPage
   * can be removed — that file is mid-change elsewhere.
   */
  showAddToCrm?: boolean;
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
  onCrmChanged: () => void;
  /**
   * Send the reply being written into a floating card, so the reader can
   * browse other threads while they write. The draft is persisted first;
   * the card reads the same draft, so nothing is handed over but the key.
   */
  onFloatReply?: () => void;
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
  inCrm,
  counterpartName,
  counterpartEmail,
  onChatPromoted,
  onChatThreadChanged,
  onCrmChanged,
  onFloatReply,
  replyFloating,
  onUnfloatReply,
  onEditAsNew,
  floating,
  onSent,
  onDraftDiscarded,
  draftRef,
} = props;

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
  // Update CRM applied: the list moves the thread into In CRM, and the
  // planner window (when there is one) fetches fresh rows for an open tab.
  const crmChanged = React.useCallback(() => {
    onCrmChanged();
    void notifyPlannerCrmChanged();
  }, [onCrmChanged]);
  /**
   * Whether the AI is still reading this thread for the CRM.
   *
   * The proposals are not held here. The ✨ button and a send with the
   * switch on hand them to CrmProposalHost, above the pane: this pane is
   * made again for every thread, and the dialog has to stay open while the
   * reader opens other mail to check it against.
   */
  const updatingCrm = useCrmProposing(account, threadId);
  /** The thread's PDFs, which the reader may choose to give the AI as context. */
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
    updateCrmNotes,
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
    The button no longer waits for a mailbox. The route that needs one is
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
  /** A right-click on a name in the "Replying to" line. */
  const { openAddressMenu, addressMenu } = useAddressMenu();
  const replyRef = React.useRef<HTMLDivElement>(null);
  const replyEditorHandle = React.useRef<RichTextEditorHandle | null>(null);
  const recipientInputRef = React.useRef<HTMLInputElement>(null);
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
    forwardWhole,
    forwardWholeBusy,
    forwardConversation,
    setForwardWholeConversation,
    resetForwardWhole,
    restoreForwardBoxes,
    forwardWholeAppendix,
  } = useForwardFiles({
    account,
    threadId,
    thread,
    chatParts,
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
  /* Pinch and zoom — see use-thread-pane-geometry.ts. */
  const { pinchRef, takeZoomAnchorRef, zoomRef, adjustZoomFromControls } =
    useThreadZoom({
      zoom,
      onZoomAdjust,
      enabled: thread !== null && !replyFocus,
    });
  // The composer opening shrinks the scroller from its bottom edge, and
  // that is the whole of what happens. There used to be a compensation
  // here that scrolled the thread up by the composer's height so the last
  // message stayed visible above the box — which meant the messages moved
  // every time the box opened, grew a line, or closed. They hold still
  // now: the box covers the tail of the thread, and the tail is a scroll
  // away if it is wanted, since the room to scroll grows by exactly the
  // room the box took.

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
   * pressing Cmd+R left the focus on the row, and this read that as the
   * reader having chosen the row — the box opened with the caret nowhere
   * and had to be clicked.
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
  }, []);
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
    resetForwardWhole,
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
  /*
    The floating card is carried by its heading, the same way the CRM
    proposals are: both are read against what they cover, and both are
    in the way of it until they are moved.
  */
  /**
   * Out of the way, ordinary, or the whole window — see `floating-card`,
   * which both floating cards stand in.
   *
   * Only ever the first of those in a pane, which is not a card and has
   * nowhere to go.
   */
  const card = useFloatingCard(
    Boolean(floating),
    "dh-mail-floating-reply-size"
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
    if (!mailUsesCrmPeople()) skip.add("crm");
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
        mailUsesCrmPeople() ? "crm" : "",
        String(toolbarAttachmentCount),
      ].join("|"),
      toolbarSlots
    );
  // Parsed once per change of the reply, not once per render: the pane
  // renders on every keystroke, and this parses HTML.
  const replyText = React.useMemo(() => htmlToPlainText(reply), [reply]);
  /* The AI and CRM panel. Its state lives in the hook — see
     use-thread-assistant.ts. It stands here because it reads `replyText`,
     and it has no effects, so its place changes no effect order. */
  const {
    chatStyleBusy,
    setChatStyle,
    diaryBusy,
    diaryProposal,
    closeDiaryProposal,
    proposeDiaryFromThread,
    updateCrmFromThread,
    draftingReply,
    aiReplyNotes,
    aiReplyWorking,
    stopAiReply,
    draftReplyWithAi,
    restoreAiReplyBrief,
    dismissAiReplyNotes,
  } = useThreadAssistant({
    account,
    threadId,
    thread,
    counterpartName,
    counterpartEmail,
    onChatPromoted,
    updatingCrm,
    readableAttachments,
    replyText,
    replaceWords,
    setThread,
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
      toList: recipientsFromEmails(
        all ? (thread?.reply.allTo ?? []) : (thread?.reply.to ?? [])
      ),
      ccList: recipientsFromEmails(
        all ? (thread?.reply.allCc ?? []) : (thread?.reply.cc ?? [])
      ),
      editRecipients: false,
      includeSignature: signsReply(),
      updateCrmNotes: false,
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
        (choices[message.fromEmail.trim().toLowerCase()] ?? inCrm),
    }));
    printMailMessages({ subject: thread.subject, messages });
  }, [thread, olderParts, loadImagesByDefault, inCrm]);
  /**
   * Reply, quoting this message rather than the newest one.
   *
   * The composer opens at its ordinary height. It used to take the whole
   * pane, which hides the thread — and the thread is what the reader was
   * looking at when they picked one message out of it to answer.
   *
   * Opening it also has to say who the reply goes to. Nothing here did, so
   * the recipient list stayed empty and Send stayed dead: the only things
   * that ever filled it were the toolbar's own Reply and closing the
   * composer, so this worked only on a thread where one of those had already
   * run. An open composer is left alone, draft and recipients and all.
   */
  const replyQuoting = React.useCallback(
    (messageId: string) => {
      // The pop-out answers this thread while it is open, and it has its own
      // reply-to-one-message on every bubble.
      if (answerInPopout()) return;
      if (replyFloating) {
        onUnfloatReply?.();
        return;
      }
      if (mode) {
        // A composer is open: only the pick changes.
        openComposer({ quoteMessageId: messageId });
      } else {
        // Answering one message answers the person who wrote it. On our own
        // message there is nobody to answer, so the thread decides.
        const picked = [
          ...olderParts.flatMap((p) => p.messages),
          ...(thread?.messages ?? []),
        ].find((m) => m.id === messageId);
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
          updateCrmNotes: false,
        });
      }
      focusReply();
    },
    [
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
      updateCrmNotes: false,
      // Forwards start without recipients, so open the chip editor right away.
      editRecipients: true,
    });
    requestAnimationFrame(() => recipientInputRef.current?.focus());
  }, [openComposer]);
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
      updateCrmNotes: false,
      subjectDraft: forwardSubject,
      subjectOpen: false,
      // Forwards start without recipients, so open the chip editor right away.
      editRecipients: true,
    });
    // The files on the message go with it, which is what a forward is
    // usually for. The box under the composer takes them off again.
    beginForwardFiles(forwardSource);
    requestAnimationFrame(() => recipientInputRef.current?.focus());
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
    setMoveMenuSignal,
    setSnoozeMenuSignal,
    shortcuts,
    startForward,
    startReply,
    threadId,
  });
  /** The message being forwarded or quoted: the newest one in the thread. */
  const forwardSource =
    (quoteMessageId
      ? [...olderParts.flatMap((p) => p.messages), ...(thread?.messages ?? [])]
          .find((m) => m.id === quoteMessageId)
      : undefined) ?? thread?.messages[thread.messages.length - 1];
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
  const { metaById, newDayIds } = React.useMemo(() => {
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
    return { metaById, newDayIds };
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
    sending,
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
    fromAccount,
    quoteMessageId,
    updateCrmNotes,
    forwardSource,
    forwardWholeAppendix,
    forwardFiles,
    forwardConversation,
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
    crmChanged,
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
      void actOnScheduled(message.id, "cancel");
      focusReply();
    },
    [actOnScheduled, focusReply, openComposer]
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
    [
      sendQuickReply,
      quoteFromMessage,
      replyQuoting,
      forwardMessage,
      onEditAsNew,
      thread?.subject,
    ]
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
  } = useThreadStart(stream, {
    account,
    threadId,
    scrollRef,
    skipOpenPinRef,
    loadImagesByDefault,
    inCrm,
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

  return {
    account,
    accounts,
    actOnScheduled,
    addAttachFiles,
    addressMenu,
    adjustZoomFromControls,
    aiReplyNotes,
    aiReplyWorking,
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
    canSendLater,
    card,
    cardHadComposer,
    ccList,
    chatParts,
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
    dismissAiReplyNotes,
    draftPreviewId,
    draftReplyWithAi,
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
    forwardConversation,
    forwardFiles,
    forwardFilesBusy,
    forwardSource,
    forwardSubject,
    forwardWhole,
    forwardWholeAppendix,
    forwardWholeBusy,
    forwarding,
    fromAccount,
    fromDrafts,
    fullWidthComposer,
    goToFirstMessage,
    goToLatestMessage,
    handingOver,
    headHasOlderInPart,
    here,
    hidden,
    highlightMessageId,
    historyAppendix,
    inCrm,
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
    restoreAiReplyBrief,
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
    setForwardWholeConversation,
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
    stopAiReply,
    subjectDraft,
    subjectOpen,
    t,
    thread,
    threadId,
    threadOverflows,
    tightToolbar,
    toList,
    unread,
    updateCrmFromThread,
    updatingCrm,
    zoom,
  };
}

export type ThreadPaneModel = ReturnType<typeof useThreadPane>;
