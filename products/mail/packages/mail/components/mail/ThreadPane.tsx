"use client";

/**
 * The open thread: its messages, the actions above them, and the reply box.
 *
 * Everything it needs arrives as a prop — it holds no page state of its own,
 * which is why 2,389 lines could leave MailPage without untangling anything.
 */

import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock,
  Forward,
  Loader2,
  Maximize2,
  Minimize2,
  MessagesSquare,
  PictureInPicture2,
  Pin,
  Printer,
  Reply,
  ReplyAll,
  SendHorizontal,
  ExternalLink,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { TrashForeverIcon } from "@/components/mail/TrashForeverIcon";
import { toast } from "@/lib/mail/toast";
import { isPublicMailProduct } from "@/lib/mail/product-flavor";
import { outlookDraftAccount } from "@/lib/mail/outlook-handover";

import { CrmProposeMenu } from "@/components/mail/CrmProposeMenu";
import { DiaryEntriesDialog } from "@/components/mail/DiaryEntriesDialog";
import { AiReplyMenu } from "@/components/mail/AiReplyMenu";
import { AiReplyNotes } from "@/components/mail/AiReplyNotes";
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
import {
  COMPOSER_MAX_SHARE,
  useReplyBand,
  useThreadPaneWidth,
  useThreadZoom,
} from "@/components/mail/use-thread-pane-geometry";
import {
  useThreadStream,
  useThreadStreamState,
} from "@/components/mail/use-thread-stream";
import { FromAccountMenu } from "@/components/mail/FromAccountMenu";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import {
  SettingsDialog,
  settingsSecondaryButton,
} from "@/components/mail/settings-ui";
import {
  ComposerSignature,
  SentPreview,
  SignatureMetaControls,
} from "@/components/mail/composer-preview";
import {
  EmailHtmlView,
  sanitizeEmailHtml,
} from "@/components/mail/EmailHtmlView";
import { ThreadFindBar } from "@/components/mail/ThreadFindBar";
import { useThreadFind } from "@/components/mail/use-thread-find";
import {
  AttachmentPreviewDialog,
  AttachToolbarButton,
  ComposerDropOverlay,
  DraftAttachmentChips,
  DraftAttachmentPreviewDialog,
  ThreadAttachmentsRollup,
} from "@/components/mail/MailAttachments";
import {
  isPendingLocalMessage,
  MailBubble,
  messageSnippet,
  readImageChoices,
  useLoadImagesByDefault,
} from "@/components/mail/MailBubble";
import { printMailMessages } from "@/components/mail/print-mail";
import {
  THREAD_TOOLBAR_SLOTS,
  useThreadToolbarFold,
  type ThreadToolbarSlot,
} from "@/components/mail/use-thread-toolbar-fold";
import { reactionQuoteText } from "@/lib/mail/reaction-message";
import {
  actionForEvent,
  formatShortcut,
  sendsFromHere,
  shortcutMatchesEvent,
} from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import {
  type MoveMenuHere, MoveToFolderMenu } from "@/components/mail/MailFolders";
import { oneInvitePerMessage } from "@/lib/mail/ics";
import {
  RecipientCarryProvider,
  RecipientField,
} from "@/components/mail/RecipientField";
import {
  fetchSignatureSettings,
  SignatureDialog,
  type SignatureSettings,
} from "@/components/mail/SignatureDialog";
import { SendLaterMenu } from "@/components/mail/SendLaterMenu";
import { ComposerToolbar } from "@/components/mail/ComposerToolbar";
import {
  formatSnoozeWakeLabel,
  SnoozeMenu,
} from "@/components/mail/SnoozeMenu";
import { notifyScheduledChanged } from "@/lib/mail/scheduled-events";
import {
  useCanSendLater,
  useOutlookAccounts,
} from "@/lib/mail/use-outlook-accounts";
import {
  THREAD_ACTION_ACTIVE_CLASS,
} from "@/components/mail/thread-actions";
import {
  DEFAULT_COMPOSER_HEIGHT,
  isInteractiveDoubleClickTarget,
  useComposerHeightPx,
  useComposerWidthPct,
} from "@/components/mail/use-mail-layout";
import { ZoomControls } from "@/components/mail/ZoomControls";
import { EmojiReactionButton } from "@/components/ui/EmojiPicker";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/ui/RichTextEditor";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { bodyToEmailHtml, htmlToPlainText } from "@/lib/client-email-html";
import { formatEmailBody } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import {
  buildQuoteHistory,
  REPLY_HISTORY_CAP,
} from "@/lib/mail/quote-history";
import {
  PANE_SLIDE_MS,
  PANE_SLIDE_EASE,
} from "@/lib/mail/pane-slide";
import { signsThisReply } from "@/lib/mail/signature-rules";
import { dropRemoteImagesForEditing } from "@/lib/mail/editor-html";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import {
  partJumpLabel,
  type MailChatPartSummary,
  type MailChatRef,
} from "@/lib/mail/chat-types";
import {
  emailsOfRecipients,
  recipientsFromEmails,
} from "@/lib/mail/contact-list-types";
import {
  replyPlaceholder,
  replyPlaceholderNames,
} from "@/lib/mail/reply-placeholder";
import { RecipientSummary, useAddressMenu } from "@/components/mail/AddressMenu";
import { OriginalMessageSheet } from "@/components/mail/OriginalMessageSheet";
import { messageStamp,
  sameDay,
  shortDate,
  timeOfDay,
} from "@/lib/mail/date-format";
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
import { focusChatPopout, notifyPlannerCrmChanged } from "@/lib/native-shell";
import type {
  MailAttachment,
  MailMessage,
  MailScheduledMessage,
  MailThreadAction,
} from "@/lib/mail/types";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import {
  FloatingCardChrome,
  useFloatingCard,
} from "@/components/mail/floating-card";
import { ThreadParticipants, participantsWithAddresses, threadPeople } from "@/components/mail/ThreadParticipants";
import { scheduleThreadRefetchAfterSend, historyEntryOf } from "@/components/mail/thread-messages";
import { PopoutStrip } from "@/components/mail/PopoutStrip";
import { ThreadToolbarOverflow } from "@/components/mail/ThreadToolbarOverflow";
import { ThreadAction } from "@/components/mail/ThreadAction";
import { DayHeading, PartSeam } from "@/components/mail/ThreadStreamMarks";


/**
 * The action strip folds from a measurement of the row itself.
 *
 * A pane-width guess misses the attachments chip, Reply all, and the zoom
 * pill. `useThreadToolbarFold` closes the gaps first, then hides one
 * control at a time, the one the pane can spare first, and puts it behind
 * the ellipsis.
 */

/** The secondary reply actions: a labelled button, or a circle with a name
 *  on hover once there is no room for the label. */
/* No light island: Reply and Forward are our own words on our own buttons,
   with no email in them, so they take the theme like the rest of the chrome.
   As a light island they were two white slabs at the foot of a dark pane.

   Named colours rather than stone classes, because the theme's blanket
   rewrites are what put those white slabs there: `bg-white` inside a light
   subtree stays white however dark the page is. These say what they are,
   and each theme says it once — see --mail-action in mail.css. */
const threadActionBase =
  "inline-flex shrink-0 items-center gap-2 rounded-full border px-5 py-2.5 text-[15px] font-semibold";
/** Reply: the one pressed nearly every time, and the only one with a fill. */
const threadActionClass = cn(
  threadActionBase,
  "border-[var(--mail-action-border)] bg-[var(--mail-action)] text-[var(--mail-action-fg)] hover:bg-[var(--mail-action-hover)]"
);
/** An icon on its own in that row: the outline, and a quieter mark in it. */
const threadActionIconClass =
  "inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--mail-action-2-border)] bg-[var(--mail-action-2)] p-2.5 text-[var(--mail-action-2-icon)] hover:bg-[var(--mail-action-2-hover)] disabled:opacity-50";
/** Reply all and Forward: an outline, so Reply is the one the eye lands on. */
const threadActionSecondaryClass = cn(
  threadActionBase,
  "border-[var(--mail-action-2-border)] bg-[var(--mail-action-2)] text-[var(--mail-action-2-fg)] hover:bg-[var(--mail-action-2-hover)]"
);
const circleActionClass = "h-11 w-11 justify-center rounded-full px-0";

export function ThreadPane({
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
}: {
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
}) {
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

  /**
   * Messages the provider is holding for this thread.
   *
   * They live at the end of the thread rather than in Drafts, because that is
   * where the reader left them: a scheduled reply is part of this
   * conversation, and a folder they never open is where it goes to be
   * forgotten about.
   */
  const [scheduled, setScheduled] = React.useState<MailScheduledMessage[]>([]);
  const loadScheduled = React.useCallback(async () => {
    try {
      const json = await apiJson<{ messages?: MailScheduledMessage[] }>(
        `/api/mail/scheduled?account=${encodeURIComponent(
          account
        )}&threadId=${encodeURIComponent(threadId)}`
      );
      setScheduled(json.messages ?? []);
    } catch {
      // Nothing held, or the provider would not say. Either way, show none.
      setScheduled([]);
    }
  }, [account, threadId]);
  React.useEffect(() => {
    void loadScheduled();
  }, [loadScheduled]);

  const actOnScheduled = React.useCallback(
    async (id: string, action: "cancel" | "sendNow") => {
      // Off the screen first: the reader has decided, and a row that lingers
      // while the provider is asked reads as a button that did nothing.
      setScheduled((current) => current.filter((m) => m.id !== id));
      try {
        await apiJson("/api/mail/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, id, action }),
        });
        if (action === "sendNow") {
          toast.success(mailSay("sent"));
          scheduleThreadRefetchAfterSend(account, threadId, setThread);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't change the message"
        );
      }
      // Not straight away. The row is already off the screen, and Graph can
      // still answer with a message it has only just been told to drop —
      // which would put it back, and read as a cancel that did not work.
      window.setTimeout(() => {
        void loadScheduled();
        notifyScheduledChanged();
      }, 1500);
    },
    [account, threadId, loadScheduled, setThread]
  );

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
          */
          if (fromDrafts) {
            if (mode) requestDiscard();
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
  /**
   * What a reply is called when nobody has said otherwise.
   *
   * The thread's subject, with the Re: a reply carries — the same string
   * the send used to build inline in three places.
   */
  const replySubject = thread
    ? thread.subject.startsWith("Re:")
      ? thread.subject
      : `Re: ${thread.subject}`
    : "";
  const forwardSubject = thread
    ? /^fwd?:/i.test(thread.subject)
      ? thread.subject
      : `Fwd: ${thread.subject}`
    : "";

  /**
   * The subject this composer sends.
   *
   * The writer's, when they set one; otherwise what the thread implies.
   * The send, the Outlook hand-over and the preview all read this, so a
   * changed subject cannot reach one of them and not the others — which is
   * how the hand-over used to go out saying "Re:" over a forward.
   */
  const outgoingSubject =
    subjectDraft.trim() || (forwarding ? forwardSubject : replySubject);

  /**
   * A reply under a name of its own is a new conversation.
   *
   * Which is not a rule this app is free to make. Gmail and Outlook both
   * group by subject — Outlook's conversation topic is the subject with
   * "Re:" taken off — so a renamed reply lands in a conversation of its own
   * wherever it arrives, and Google's own rule is that a message joins a
   * thread only when the subject matches. Sending the thread's id with a
   * changed subject was asking for two things at once.
   *
   * So the id is left off and the send starts a thread. `In-Reply-To` and
   * `References` still go, which costs nothing and leaves the trail for a
   * client that reads them — the new name is the break, not a lost
   * ancestry. A forward has always started its own thread and needs none
   * of this.
   */
  const startsNewThread =
    !forwarding &&
    Boolean(subjectDraft.trim()) &&
    subjectDraft.trim() !== replySubject.trim();

  // Replies quote the newest message Gmail-style; built once so the preview
  // shows exactly what goes out.
  const quoteFromMessage = React.useCallback(
    (source: MailMessage | undefined) => {
      if (!source) return undefined;
      return {
        fromName:
          source.fromName === "You" ||
          source.fromName.toLowerCase() === source.fromEmail.toLowerCase()
            ? ""
            : source.fromName,
        fromEmail: source.fromEmail,
        date: messageStamp(source.sentAt),
        text: decodeHtmlEntities(formatEmailBody(source.bodyText)).trim(),
        html: source.bodyHtml ? sanitizeEmailHtml(source.bodyHtml) : undefined,
      };
    },
    []
  );

  /**
   * The message the reader picked to answer, when they picked one.
   *
   * Not `forwardSource`, which falls back to the newest message so that a
   * plain reply still has something to quote. This is only ever the pick, so
   * the strip above the composer appears for a pick and for nothing else.
   */
  const quotedForReply = React.useMemo(() => {
    if (!quoteMessageId) return undefined;
    return [
      ...olderParts.flatMap((p) => p.messages),
      ...(thread?.messages ?? []),
    ].find((m) => m.id === quoteMessageId);
  }, [quoteMessageId, olderParts, thread]);

  const quotePayload = React.useMemo(() => {
    if (!forwardSource) return undefined;
    return {
      // Gmail sometimes reports the address itself as the display name.
      fromName:
        forwardSource.fromName === "You" ||
        forwardSource.fromName.toLowerCase() ===
          forwardSource.fromEmail.toLowerCase()
          ? ""
          : forwardSource.fromName,
      fromEmail: forwardSource.fromEmail,
      date: messageStamp(forwardSource.sentAt),
      text: decodeHtmlEntities(formatEmailBody(forwardSource.bodyText)).trim(),
      // Sanitized so we never relay scripts/embeds from the original.
      html: forwardSource.bodyHtml
        ? sanitizeEmailHtml(forwardSource.bodyHtml)
        : undefined,
    };
  }, [forwardSource]);

  /**
   * The thread's history, rebuilt for the tail of the next reply.
   *
   * Classic mail inherits its tail from the mail it answers, so one mail
   * sent without one — chat style here, a trimmed reply anywhere — starves
   * every mail after it, and ticking "Quote history" back on could never
   * reach past the break. Built from the thread instead, the box means
   * what it says. See lib/mail/quote-history for the whole story.
   */
  const historyAppendix = React.useMemo(() => {
    if (!thread) return null;
    const all = [
      ...olderParts.flatMap((p) => p.messages),
      ...thread.messages,
    ].filter((m) => !isPendingLocalMessage(m.id));
    if (!all.length) return null;
    // What the thread holds beyond what is loaded still counts: the note
    // under the tail says how much of the conversation it is not.
    const total =
      olderParts.reduce((n, p) => n + p.messages.length, 0) +
      (thread.totalMessageCount ?? thread.messages.length);
    const kept = all.slice(-REPLY_HISTORY_CAP);
    return buildQuoteHistory(kept.map(historyEntryOf), {
      omittedBeyond: Math.max(0, total - kept.length),
    });
  }, [thread, olderParts]);

  /**
   * Who the empty box says the reply goes to: everyone in To and Cc, named
   * from the thread where a name is known. A reply-all names them all; a
   * reply names one. With nobody in the fields yet, the first person on the
   * thread who is not you, as before.
   */
  const replyBoxPlaceholder = React.useMemo(() => {
    const names = replyPlaceholderNames({
      toList,
      ccList,
      messages: thread?.messages ?? [],
      account,
    });
    const fallback =
      thread?.participants.filter((p) => p !== "You")[0] ?? "the thread";
    return replyPlaceholder(names, fallback);
  }, [thread, toList, ccList, account]);

  /** First name of the first recipient, for the preview header. */
  const recipientName = React.useMemo(() => {
    const first = toList[0];
    if (!first) return "the recipient";
    if (first.kind === "list") return first.name;
    const match = thread?.messages.find(
      (m) => m.fromEmail.toLowerCase() === first.email.toLowerCase()
    );
    return (
      match?.fromName?.split(" ")[0] ||
      first.name?.split(" ")[0] ||
      first.email
    );
  }, [thread, toList]);

  /** Display name Gmail will attach to the sending account, if we know it. */
  const senderName = React.useMemo(() => {
    const own = thread?.messages.find(
      (m) =>
        m.own &&
        m.fromName !== "You" &&
        m.fromName.toLowerCase() !== m.fromEmail.toLowerCase() &&
        m.fromEmail.toLowerCase() === fromAccount.toLowerCase()
    );
    return own?.fromName ?? "";
  }, [thread, fromAccount]);

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

  if (error) {
    return <p className="px-8 py-8 text-sm text-red-600">{error}</p>;
  }
  if (!thread) {
    return (
      <div className="mail-thread-surface flex min-h-0 flex-1 flex-col bg-[var(--mail-thread)]">
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-8 text-sm text-stone-500"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
          {t("loadingMessage")}
        </div>
      </div>
    );
  }

  const first = thread.messages[0];
  const last = thread.messages[thread.messages.length - 1];
  /* Everyone on the thread but us — who a saved list would hold. Plainly,
     not memoized: this sits after the early returns above, where a hook
     would change the order React counts. */
  const threadOthers = threadPeople(thread.messages, [account, ...accounts])
    .others;
  const dateRange =
    first?.sentAt && last?.sentAt && shortDate(first.sentAt) !== shortDate(last.sentAt)
      ? `${shortDate(first.sentAt)} – ${shortDate(last.sentAt)}`
      : shortDate(last?.sentAt ?? null);
  // The thread's own total when the provider gave one, so the header does
  // not undercount a thread that is only partly loaded. Older parts still
  // count what is on hand — their totals are not known here.
  const totalMessageCount =
    olderParts.reduce((n, p) => n + p.messages.length, 0) +
    (thread.totalMessageCount ?? thread.messages.length);

  const chat = thread.chat;
  // Missing noQuote on older cached rows means former chat-mode threads.
  const chatStyle = Boolean(chat && chat.noQuote !== false);
  const headerTitle = thread.subject.replace(/^((re|fwd?):\s*)+/i, "");
  // Gmail-style bottom bar: Reply all only when it reaches more people than Reply.
  const showReplyAll =
    new Set(
      [...thread.reply.allTo, ...thread.reply.allCc]
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
    ).size > 1;

  const jumpToPart = (p: MailChatPartSummary) => {
    if (!chat || p.providerThreadId === threadId) return;
    onChatThreadChanged(p.providerThreadId, {
      ...chat,
      partIndex: p.partIndex,
      subject: p.subject,
      isOpenPart: p.status === "open",
    });
  };

  return (
    <div
      ref={setPaneNode}
      /* The size it was dragged to — one for the corner, one for the
         dialog. Put away, neither: that one is its heading, and as wide
         as a heading needs. */
      style={card.style}
      className={cn(
        "mail-thread-surface relative flex flex-col bg-[var(--mail-thread)]",
        floating
          ? // The card. It has a width of its own, so the composer inside
            // measures a pane that width and lays itself out to it — the
            // same rules it follows when a pane is this narrow. Full
            // screen is wide enough that it lays itself out as a pane.
            "mail-floating-reply overflow-hidden rounded-xl border border-stone-300 shadow-2xl"
          : "min-h-0 flex-1",
        card.className,
        /*
          The card is the message being written, so with the composer shut
          there is nothing in it to show — it stood there as an empty thread
          with Reply and Forward on it, over a message that had just gone.

          Out of sight rather than unmounted: the seconds after Send and
          after the bin belong to Undo, which puts the words back in this
          very box. Once the message has left, `closeFloatingCard` takes
          the card away for good.
        */
        floating && !mode && cardHadComposer.current && "hidden"
      )}
    >
      {/*
        The dimmed page, the edges that size the card, and the heading with
        its buttons — all of it the frame both floating cards stand in. The
        card's own way home is the key, not a button: see
        `floatMessageShortcutRef`.
      */}
      <FloatingCardChrome
        card={card}
        title={thread?.subject || "\u2026"}
        hidden={!mode}
        onClose={() => onFloatReply?.()}
      />
      {!floating ? (
      <div
        onDoubleClick={(e) => {
          if (isInteractiveDoubleClickTarget(e.target)) return;
          onToggleFocus?.();
        }}
      >
        {/* Cream action strip. Slightly tighter than the New email row.
            Pull left over the w-2 resize gutter so cream meets the list
            border — only this band, not the full-height sidebar chrome. */}
        <div className="mail-chrome-strip relative z-[1] -ml-2 w-[calc(100%+0.5rem)] border-b border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] pt-1.5">
          <div
            ref={setToolbarRowNode}
            data-tight={tightToolbar ? "" : undefined}
            className={cn(
              "group/toolbar flex h-10 w-full min-w-0 items-center overflow-hidden pl-7 pr-5",
              tightToolbar ? "gap-0" : "gap-1"
            )}
          >
          {/* min-w-0 and overflow-hidden keep the row as wide as the pane,
              so a shrink-0 button that would leave it can be measured and
              moved behind the ellipsis. */}
          <ThreadAction
            label={`${t("actionReply")} (${formatShortcut(
              shortcuts.reply
            )})`}
            icon={Reply}
            className={mode === "reply" ? THREAD_ACTION_ACTIVE_CLASS : undefined}
            onClick={() => startReply(false)}
          />
          {/* Only where it reaches somebody Reply does not — the same rule
              the buttons at the foot of the thread follow, and the same
              one Gmail follows. A mail from one person to you alone has
              nobody for it to add, so the strip was offering a second way
              to do exactly what Reply does. It stays while a reply-all is
              being written, so the button that opened the composer does
              not vanish out from under it. */}
          {showReplyAll || mode === "replyAll" ? (
            <ThreadAction
              label={`${t("actionReplyAll")} (${formatShortcut(
                shortcuts.replyAll
              )})`}
              icon={ReplyAll}
              className={
                mode === "replyAll" ? THREAD_ACTION_ACTIVE_CLASS : undefined
              }
              onClick={() => startReply(true)}
            />
          ) : null}
          <ThreadAction
            label={`${t("actionForward")} (${formatShortcut(
              shortcuts.forward
            )})`}
            icon={Forward}
            className={
              mode === "forward" ? THREAD_ACTION_ACTIVE_CLASS : undefined
            }
            onClick={startForward}
          />
          {hidden.has("read") &&
          hidden.has("snooze") &&
          (!onTogglePin || hidden.has("pin")) ? null : (
            <span
              aria-hidden
              className="mx-1.5 h-5 w-px shrink-0 bg-[var(--mail-chrome-border)] group-data-[tight]/toolbar:mx-1"
            />
          )}
          {/* Each of these leaves on its own, when the row runs out of
              room — not as a group. See `hidden`. */}
          {hidden.has("read") ? null : (
            <ThreadAction
              label={`${t(
                unread ? "markAsRead" : "markAsUnread"
              )} (${formatShortcut(shortcuts.toggleUnread)})`}
              icon={MailDotIcon}
              onClick={onToggleUnread}
            />
          )}
          {hidden.has("snooze") ? null : (
            <SnoozeMenu
              onSnooze={onSnooze}
              onCancelSnooze={onCancelSnooze}
              currentUntil={snoozedUntil}
              openSignal={snoozeMenuSignal}
              title={`${t("actionSnooze")} (${formatShortcut(
                shortcuts.snooze
              )})`}
            />
          )}
          {/* Beside snooze, because the two are the same question asked
              the other way round: one puts a conversation out of the way
              until later, the other keeps it in the way until it is done.
              A filled teal pin is the only thing here that says it is
              already on — the rest of the strip does something each time
              it is pressed, and this one is a state. */}
          {onTogglePin && !hidden.has("pin") ? (
            <ThreadAction
              label={`${t(pinned ? "unpin" : "pinToTop")} (${formatShortcut(
                shortcuts.togglePin
              )})`}
              icon={Pin}
              /* The accent, which is the one colour that is the same teal
                 in both themes — see --mail-accent. */
              className={
                pinned
                  ? "text-[var(--mail-accent)] [&_svg]:fill-current"
                  : undefined
              }
              onClick={onTogglePin}
            />
          ) : null}
          <span
            aria-hidden
            className="mx-1.5 h-5 w-px shrink-0 bg-[var(--mail-chrome-border)] group-data-[tight]/toolbar:mx-1"
          />
          {hidden.has("move") ? null : (
            <MoveToFolderMenu
              folders={folders}
              onMoved={onMoveToFolder}
              destinations={{
                inbox: onMoveToInbox,
                archived: onArchive,
                junk: onJunk,
                trash: inTrash
                  ? undefined
                  : () => onTrash({ account, threadId }),
              }}
              here={here}
              openSignal={moveMenuSignal}
              title={`${t("moveToFolder")} (${formatShortcut(
                shortcuts.moveToFolder
              )})`}
            />
          )}
          {/* Not in Trash: the mail is deleted, and the list rows there do
              not offer Archive either. Restore is the way out of Trash. */}
          {inTrash ? null : (
            <ThreadAction
              label={`${t("actionArchive")} (${formatShortcut(
                shortcuts.archive
              )})`}
              icon={Archive}
              onClick={onArchive}
            />
          )}
          {/* Already in the bin: the useful action is getting it out again.
              "Delete forever" stands beside it, in Trash and in Junk only.
              It is the one action with nothing behind it, so the page asks
              before it does it. */}
          {/* Junk itself is in the move menu — filing something is a move.
              Getting it back out is not, so that keeps its own action. */}
          {inJunk && onNotJunk ? (
            <ThreadAction
              label={t("notJunk")}
              icon={ShieldCheck}
              onClick={onNotJunk}
            />
          ) : null}
          {inTrash && onRestore ? (
            <ThreadAction
              label={t("restore")}
              icon={ArchiveRestore}
              onClick={onRestore}
            />
          ) : (
            <ThreadAction
              label={`${t("actionDelete")} (${formatShortcut(
                shortcuts.delete
              )})`}
              icon={Trash2}
              // The same rule as the key: in the Drafts view, the draft.
              onClick={() =>
                fromDrafts && mode
                  ? requestDiscard()
                  : onTrash({ account, threadId })
              }
            />
          )}
          {(inTrash || inJunk) && onDeleteForever ? (
            <ThreadAction
              // In Trash the delete key opens the same question.
              label={
                inTrash
                  ? `${t("deleteForever")} (${formatShortcut(shortcuts.delete)})`
                  : t("deleteForever")
              }
              icon={TrashForeverIcon}
              onClick={onDeleteForever}
            />
          ) : null}
          {hidden.has("print") &&
          hidden.has("popOut") &&
          (!mailUsesCrmPeople() || hidden.has("crm")) ? null : (
            <span
              aria-hidden
              className="mx-1.5 h-5 w-px shrink-0 bg-[var(--mail-chrome-border)] group-data-[tight]/toolbar:mx-1"
            />
          )}
          {hidden.has("print") ? null : (
            <ThreadAction
              label={`${t("actionPrint")} (${formatShortcut(
                shortcuts.print
              )})`}
              icon={Printer}
              onClick={printThread}
            />
          )}
          {hidden.has("popOut") ? null : (
            <ThreadAction
              label={`${t("popOutChat")} (${formatShortcut(
                shortcuts.popOut
              )})`}
              icon={MessagesSquare}
              onClick={popOutThread}
            />
          )}
          {mailUsesCrmPeople() && !hidden.has("crm") ? (
            <CrmProposeMenu
              busy={updatingCrm || diaryBusy}
              onPropose={(hint) => void updateCrmFromThread(hint)}
              onProposeDiary={(hint) => void proposeDiaryFromThread(hint)}
            />
          ) : null}
          {/*
            Room for the thread, at the end of the actions.

            Not out at the far right where it began, at the end of a row it
            has nothing to do with: Reply, Forward, Archive and the rest act
            on the mail, and this one only decides how much of the window
            the mail gets. Last of the left-hand row instead, so it is the
            step after everything that acts, and the eye finds it without
            crossing the pane.
          */}
          {onToggleFocus ? (
          <ThreadAction
            label={`${t(focusMode ? "showMailList" : "focusMode")} (${formatShortcut(
              shortcuts.focusThread
            )})`}
            icon={focusMode ? Minimize2 : Maximize2}
            className={cn(
              /*
                The size the list's own expand button is.

                It is the same control in two places — one puts the list
                away, the other brings it back — and the pair read as two
                different things while one was a step bigger than the other.
                Held at that size in the tight row too, where the rest step
                down: matching the other button matters more than matching
                its neighbours, which is the whole point of it.
              */
              "h-8 w-8 [&_svg]:size-4",
              "group-data-[tight]/toolbar:h-8 group-data-[tight]/toolbar:w-8 group-data-[tight]/toolbar:[&_svg]:size-4"
            )}
            onClick={onToggleFocus}
          />
          ) : null}
          <div className="ml-auto flex items-center gap-1.5">
            {showOverflowMenu ? (
              <ThreadToolbarOverflow
                hidden={hidden}
                zoom={zoom}
                onZoomAdjust={adjustZoomFromControls}
                onPrint={hidden.has("print") ? printThread : undefined}
                onPopOut={hidden.has("popOut") ? popOutThread : undefined}
                pinned={pinned}
                onTogglePin={hidden.has("pin") ? onTogglePin : undefined}
                unread={unread}
                onToggleUnread={hidden.has("read") ? onToggleUnread : undefined}
                onSnooze={hidden.has("snooze") ? onSnooze : undefined}
                onCancelSnooze={onCancelSnooze}
                snoozedUntil={snoozedUntil}
                folders={folders}
                onMoveToFolder={hidden.has("move") ? onMoveToFolder : undefined}
                onMoveToJunk={onJunk}
                onMoveToInbox={onMoveToInbox}
                onArchive={onArchive}
                onTrash={inTrash ? undefined : () => onTrash({ account, threadId })}
                here={here}
                onProposeCrm={
                  hidden.has("crm")
                    ? (hint) => void updateCrmFromThread(hint)
                    : undefined
                }
                crmBusy={updatingCrm}
                printLabel={`${t("actionPrint")} (${formatShortcut(
                  shortcuts.print
                )})`}
                popOutLabel={`${t("popOutChat")} (${formatShortcut(
                  shortcuts.popOut
                )})`}
              />
            ) : null}
            <ThreadAttachmentsRollup
              account={account}
              items={[
                ...olderParts.flatMap((p) => p.messages),
                ...thread.messages,
              ].flatMap((m) =>
                /*
                  One invitation per message, however many times it was
                  sent.

                  A meeting mail carries the same event twice: once as the
                  `text/calendar` part the mail is, and once as the
                  `invite.ics` file attached to it. Both are calendar
                  attachments, so a single acceptance counted as two
                  invitations up here — while the message below it drew one
                  card, because the card takes the first and ignores the
                  rest. This counts what the reader can actually show.
                */
                oneInvitePerMessage(m.attachments).map((attachment) => ({
                  messageId: m.id,
                  attachment,
                }))
              )}
              onPreview={(messageId, attachment) => {
                setAttachmentPreview({ messageId, attachment });
              }}
            />
            {hidden.has("zoom") ? null : (
              <ZoomControls zoom={zoom} onAdjust={adjustZoomFromControls} />
            )}
          </div>
          </div>
        </div>
        {/* The subject stays while the thread moves under it, and says so
            with a shadow rather than a rule. It reaches about ten pixels
            down: enough to lift the header off what is scrolling beneath,
            not so far that it reads as a bar of its own.

            `relative z-10` is what makes it visible at all — the stream is
            painted after this in the document, so without a layer to sit
            on, the shadow would land under it.

            Pulled left over the w-2 resize gutter, the same as the cream
            strip above it, so the shadow reaches the mail list instead of
            stopping eight pixels short of it. pl-10 rather than pl-8 puts
            the subject back where it was after the pull. */}
        <div className="mail-thread-header relative z-10 -ml-2 w-[calc(100%+0.5rem)] min-w-0 border-b border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] pb-2 pl-10 pr-8 pt-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-serif text-lg font-bold text-stone-900">
              {headerTitle}
            </h2>
            {/*
              Where the thread began, for a thread long enough to have lost
              its beginning off the top. It reads the first message rather
              than describing it, because "what was this about" is answered by
              the words and not by a date.

              Not on a thread of one message. A long single message overflows
              too, but its beginning is the top of the message the reader is
              already looking at, and "Started" says nothing about a mail
              nobody has answered. The first message is the newest one when
              their ids agree — across a chat's rotated parts, they will not.
            */}
            {threadOverflows && firstMessage && firstMessage.id !== latestId ? (
              <Popover
                open={firstPeekOpen}
                onOpenChange={setFirstPeekOpen}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    title={t("threadStarted")}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-600 transition-colors hover:bg-stone-50"
                  >
                    Started {shortDate(firstMessage.sentAt)}
                    <ArrowUpRight
                      className="h-3.5 w-3.5 text-stone-400"
                      aria-hidden
                    />
                  </button>
                </PopoverTrigger>
                <MailPopoverContent
                  align="end"
                  className="w-[420px] max-w-[80vw] p-0"
                >
                  <div className="flex items-start justify-between gap-3 px-3.5 pt-3">
                    <div className="min-w-0 text-xs text-stone-500">
                      <p className="truncate">
                        <span className="text-stone-400">
                          {t("fieldFromColon")}{" "}
                        </span>
                        <span className="font-semibold text-stone-800">
                          {firstMessage.fromEmail || firstMessage.fromName}
                        </span>
                      </p>
                      {firstMessage.toEmails?.length ? (
                        <p className="truncate">
                          <span className="text-stone-400">To: </span>
                          {firstMessage.toEmails.join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={t("close")}
                      className="-mr-1 shrink-0 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                      onClick={() => setFirstPeekOpen(false)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {/*
                    Six lines and no more. This is a peek, and a first message
                    long enough to fill the pane would put the way back to the
                    thread off the bottom of it.

                    The frame is the one the thread reads with, so a link is a
                    link here too, and a picture at the head of a message is a
                    picture — capped at 72px, which is a thumbnail, because a
                    screenshot at its own height is six lines of screenshot.
                    `mail-bubble-surface`: the mail inside is dark on white,
                    the same island the bubbles are.
                  */}
                  {firstPeekHtml ? (
                    /* No padding of our own: the frame carries 14px of its
                       own, which is exactly where the From line above and
                       the buttons below sit. */
                    <div className="mail-bubble-surface mt-1 max-h-[8.5rem] overflow-hidden">
                      <EmailHtmlView
                        html={firstPeekHtml}
                        inlineImages={firstMessage.inlineImages}
                        allowImages={firstPeekAllowImages}
                        imageMaxHeight={72}
                      />
                    </div>
                  ) : (
                    <p className="mt-2 max-h-[8.5rem] overflow-hidden px-3.5 text-sm leading-relaxed text-stone-800">
                      {messageSnippet(firstMessage) || "(no text)"}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between gap-3 px-3.5 pb-3">
                    {/* The peek stays up until the jump lands. Closing it
                        first left the reader looking at an unchanged thread
                        while a page was fetched, with nothing to say so. */}
                    <button
                      type="button"
                      disabled={loadingToStart}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-teal-700 hover:underline disabled:opacity-60 disabled:hover:no-underline"
                      onClick={() => void goToFirstMessage()}
                    >
                      {loadingToStart ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t("goingToFirst")}
                        </>
                      ) : (
                        t("goToThisMessage")
                      )}
                    </button>
                    <span className="shrink-0 text-xs text-stone-400">
                      {messageStamp(firstMessage.sentAt)}
                    </span>
                  </div>
                </MailPopoverContent>
              </Popover>
            ) : null}
          </div>
          {/* Its own colour, because the two themes want two answers —
              see `--mail-thread-meta`. Small type on cream needs the
              contrast; the same step on navy would make this line as loud
              as the subject above it. */}
          <p className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-[var(--mail-thread-meta)]">
            {/*
              A circular arrives with the whole club on it, and that is a
              list worth keeping — the same list the composer offers to save
              when you type the names in yourself. Here they are already
              gathered, so the offer belongs here too. It lives inside the
              participants, which is what knows whether the names are out.
            */}
            <ThreadParticipants
              people={participantsWithAddresses(thread.messages, [
                account,
                ...accounts,
              ])}
              others={threadOthers}
              meta={
                <>
                  ·{" "}
                  {totalMessageCount === 1
                    ? t("threadMessageOne")
                    : t("threadMessageMany", { count: totalMessageCount })}{" "}
                  · {dateRange} · {t("threadReceivedOn")} {account}
                </>
              }
            />
            {chatParts.length > 1 ? (
              <>
                <span aria-hidden>·</span>
                <Popover open={partMenuOpen} onOpenChange={setPartMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-0.5 font-medium text-stone-700 hover:text-stone-900"
                    >
                      {t("earlier")}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <MailPopoverContent align="start" className="w-56 p-1">
                    {[...chatParts].reverse().map((p) => (
                      <button
                        key={p.partIndex}
                        type="button"
                        className={cn(
                          "flex w-full rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-stone-100",
                          p.partIndex === chat?.partIndex
                            ? "font-semibold text-stone-900"
                            : "text-stone-700"
                        )}
                        onClick={() => {
                          setPartMenuOpen(false);
                          jumpToPart(p);
                        }}
                      >
                        {partJumpLabel(p, chat?.partIndex ?? p.partIndex)}
                      </button>
                    ))}
                  </MailPopoverContent>
                </Popover>
              </>
            ) : null}
          </p>
        </div>
      </div>
      ) : null}

      {!floating && !replyFocus && find.open ? (
        <ThreadFindBar
          query={find.query}
          onQueryChange={find.setQuery}
          count={find.count}
          index={find.index}
          onNext={find.next}
          onPrev={find.prev}
          onClose={find.close}
        />
      ) : null}

      {/* The ground the reply sweep plays on: the thread and the composer
          band together, below the toolbar — a band standing absolute
          during the sweep covers the thread, never the controls. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      {originalOf ? (
        <OriginalMessageSheet
          account={account}
          messageId={originalOf}
          subject={thread?.subject ?? ""}
          onClose={() => setOriginalOf(null)}
        />
      ) : null}
      {!floating ? (
        /* The stream, and the way back down to the end of it laid over the
           bottom of the stream rather than under it — a row of its own
           would push the composer down every time somebody scrolled.

           Mounted through reply focus, not re-created after it. It used to
           unmount while the composer had the pane, and the remade stream
           came back scrolled to wherever a fresh one lands — the reader
           left writing at the end of the thread and came back to the top
           of it. While the composer has the pane the stream stands out of
           the flow instead, absolute at the same rect, covered and
           untouched — so the scroll is not restored, because it was never
           lost. */
        <div
          className="relative flex min-h-0 flex-1 flex-col"
          style={
            replyFocus && !replyFocusSliding
              ? { position: "absolute", inset: 0 }
              : undefined
          }
        >
        <div
          ref={setScrollNode}
          /* Less above than below: the first thing in the stream is nearly
             always a day heading, which brings its own space, and the two
             together left a hole under the subject. */
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-none bg-[var(--mail-thread)] px-4 pb-5 pt-2"
          )}
        >
          <div className="flex flex-col gap-4" style={{ zoom }}>
            {headHasOlderInPart ||
            canLoadOlderAcrossParts ||
            loadingOlder ? (
              <div className="flex justify-center py-1">
                {loadingOlder ? (
                  <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
                ) : (
                  <button
                    type="button"
                    className="text-[11px] font-medium text-stone-400 hover:text-stone-600"
                    onClick={() => void loadOlderMessages()}
                  >
                    {t("loadEarlier")}
                  </button>
                )}
              </div>
            ) : null}
            {olderParts.map((part, i) => {
              const nextPartIndex =
                olderParts[i + 1]?.partIndex ?? chat?.partIndex;
              return (
                <React.Fragment key={`part-${part.partIndex}`}>
                  {part.messages.map((m) => (
                    <React.Fragment key={`day-${m.id}`}>
                    {newDayIds.has(m.id) ? (
                      <DayHeading iso={m.sentAt} />
                    ) : null}
                    <div
                      key={m.id}
                      data-mail-bubble="1"
                      data-message-id={m.id}
                      className={cn(
                        "min-w-0",
                        highlightMessageId === m.id &&
                          "mail-search-hit rounded-2xl"
                      )}
                    >
                      <MailBubble
                        message={m}
                        account={account}
                        subject={thread.subject}
                        defaultAllowImages={inCrm}
                        isLatest={false}
                        zoom={zoom}
                        meta={metaById.get(m.id)}
                        timeLabel={timeOfDay(m.sentAt)}
                        {...bubbleActions(m)}
                        onPreviewAttachment={(attachment) =>
                          setAttachmentPreview({
                            messageId: m.id,
                            attachment,
                          })
                        }
                      />
                    </div>
                    </React.Fragment>
                  ))}
                  {nextPartIndex != null ? (
                    <PartSeam
                      onView={() => {
                        const earlier = chatParts.find(
                          (p) => p.partIndex === part.partIndex
                        );
                        if (earlier) jumpToPart(earlier);
                      }}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
            {chat &&
            chat.partIndex > 1 &&
            olderParts.length === 0 &&
            chatParts.some((p) => p.partIndex < chat.partIndex) ? (
              <PartSeam
                onView={() => {
                  const earlier = [...chatParts]
                    .filter((p) => p.partIndex < chat.partIndex)
                    .sort((a, b) => b.partIndex - a.partIndex)[0];
                  if (earlier) jumpToPart(earlier);
                }}
              />
            ) : null}
            {thread.messages.map((m) => {
              const outboxStatus = outbox[m.id]?.status;
              return (
                <React.Fragment key={`day-${m.id}`}>
                {newDayIds.has(m.id) ? <DayHeading iso={m.sentAt} /> : null}
                <div
                  key={m.id}
                  data-mail-bubble="1"
                  data-message-id={m.id}
                  className={cn(
                    "min-w-0",
                    highlightMessageId === m.id && "mail-search-hit rounded-2xl",
                    confirmingIds.has(m.id) && "mail-sent-confirm"
                  )}
                >
                  <MailBubble
                    message={m}
                    account={account}
                    subject={thread.subject}
                    defaultAllowImages={inCrm}
                    isLatest={m.id === latestId}
                    sendStatus={outboxStatus}
                    zoom={zoom}
                    meta={metaById.get(m.id)}
                    timeLabel={timeOfDay(m.sentAt)}
                    onRetrySend={
                      outboxStatus === "failed"
                        ? () => retryOutboxSend(m.id)
                        : undefined
                    }
                    onEditSend={
                      outboxStatus === "failed"
                        ? () => editOutboxSend(m.id)
                        : undefined
                    }
                    {...bubbleActions(m)}
                    onPreviewAttachment={(attachment) =>
                      setAttachmentPreview({ messageId: m.id, attachment })
                    }
                  />
                </div>
                </React.Fragment>
              );
            })}
            {/* Held, not sent. Dashed and dimmed says the same thing the
                undo count says: this has not gone anywhere yet. */}
            {scheduled.map((held) => (
              <div key={held.id} className="flex flex-col items-end gap-1 py-1">
                <div className="w-full max-w-[85%] self-end rounded-2xl rounded-br-md border border-dashed border-teal-300 bg-[var(--mail-bubble-own)]/60 px-3.5 py-2.5">
                  <p className="whitespace-pre-wrap break-words text-sm text-stone-600">
                    {held.bodyText}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 pr-1 text-xs text-stone-500">
                  <Clock className="h-3.5 w-3.5" aria-hidden />
                  <span>Sends {formatSnoozeWakeLabel(held.sendAt)}</span>
                  <span aria-hidden className="text-stone-300">·</span>
                  <button
                    type="button"
                    className="font-semibold text-teal-700 hover:text-teal-800"
                    onClick={() => editScheduled(held)}
                  >
                    {t("edit")}
                  </button>
                  <span aria-hidden className="text-stone-300">·</span>
                  <button
                    type="button"
                    className="font-semibold text-teal-700 hover:text-teal-800"
                    onClick={() => void actOnScheduled(held.id, "sendNow")}
                  >
                    {t("sendNow")}
                  </button>
                  <span aria-hidden className="text-stone-300">·</span>
                  <button
                    type="button"
                    className="font-semibold text-teal-700 hover:text-teal-800"
                    onClick={() => void actOnScheduled(held.id, "cancel")}
                  >
                    {t("cancel")}
                  </button>
                </div>
              </div>
            ))}
            {thread.hasNewer || loadingNewer ? (
              <div className="flex justify-center py-1">
                {loadingNewer ? (
                  <Loader2 className="h-4 w-4 animate-spin text-stone-400" />
                ) : (
                  <button
                    type="button"
                    className="text-[11px] font-medium text-stone-400 hover:text-stone-600"
                    onClick={() => void loadNewerMessages()}
                  >
                    {t("loadNewer")}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          aria-label={t("goToLatest")}
          title={t("goToLatest")}
          /* Kept in the tree and faded, so it arrives and leaves quietly.
             `pointer-events-none` while it is invisible, or it would go on
             taking clicks meant for the message under it. */
          className={cn(
            /* Above the actions that appear beside a message on hover.
               They share this corner when the last message is the one
               under the pointer, and this is the one being aimed at. */
            "absolute bottom-4 right-5 z-30 flex h-9 w-9 items-center justify-center rounded-full",
            "border border-stone-200 bg-white text-stone-600 shadow-md",
            "transition-opacity hover:bg-stone-50 hover:text-stone-900",
            /* Scrolled up, or looking at a window that does not reach the
               end of the thread. The second is how the start of a long
               thread looks: at the bottom of that page, with the newest
               message still hundreds of messages away. */
            awayFromLatest || thread.hasNewer
              ? "opacity-100"
              : "pointer-events-none opacity-0"
          )}
          onClick={() => void goToLatestMessage()}
        >
          <ChevronDown className="h-5 w-5" aria-hidden />
        </button>
        </div>
      ) : null}

      <AttachmentPreviewDialog
        account={account}
        messageId={attachmentPreview?.messageId ?? ""}
        attachment={attachmentPreview?.attachment ?? null}
        siblings={
          attachmentPreview
            ? (thread?.messages.find((m) => m.id === attachmentPreview.messageId)
                ?.attachments ?? [])
            : []
        }
        onSelect={(next) =>
          setAttachmentPreview((current) =>
            current ? { ...current, attachment: next } : current
          )
        }
        onClose={() => setAttachmentPreview(null)}
      />
      <DraftAttachmentPreviewDialog
        items={attachItems}
        previewId={draftPreviewId}
        onSelect={setDraftPreviewId}
        onClose={() => setDraftPreviewId(null)}
      />

      {!mode && popoutOpen ? (
        <PopoutStrip
          onShow={() => void focusChatPopout({ account, threadId })}
          onBringBack={() => void bringBackPopout()}
        />
      ) : null}

      {!mode && !popoutOpen ? (
        /**
         * One row, whatever the pane is doing.
         *
         * Four words and their icons need about 480px, and below that they
         * used to wrap — a second row of buttons appearing under the first
         * and pushing itself off the bottom of the pane.
         *
         * What goes is the words on the other three. Reply is the one
         * pressed nearly every time, so it keeps its own: an icon on its
         * own is a thing to be worked out, and the commonest action in the
         * app should never be that. The rest become what a toolbar is
         * anyway — an icon with a name on hover.
         */
        <div
          className={cn(
            "flex items-center justify-end border-t border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] py-3",
            compactThreadActions ? "gap-2 px-4" : "gap-3 px-8"
          )}
        >
          <button
            type="button"
            title={`${t("actionReply")} (${formatShortcut(shortcuts.reply)})`}
            /* The same class as its neighbours, which is what it was
               written out to be — with `mail-light-surface`, and that is
               what kept it a white slab on a dark pane while Reply all and
               Forward beside it took the theme. There is no email in this
               button; it is our own word on our own chrome. */
            className={threadActionClass}
            onClick={() => startReply(false)}
          >
            <Reply className="h-4 w-4" />
            {t("actionReply")}
          </button>
          {showReplyAll ? (
            <button
              type="button"
              title={`${t("actionReplyAll")} (${formatShortcut(
                shortcuts.replyAll
              )})`}
              aria-label={t("actionReplyAll")}
              className={cn(
                threadActionSecondaryClass,
                compactThreadActions && circleActionClass
              )}
              onClick={() => startReply(true)}
            >
              <ReplyAll className="h-4 w-4" />
              {compactThreadActions ? null : t("actionReplyAll")}
            </button>
          ) : null}
          <button
            type="button"
            title={`${t("actionForward")} (${formatShortcut(
              shortcuts.forward
            )})`}
            aria-label={t("actionForward")}
            className={cn(
              threadActionSecondaryClass,
              compactThreadActions && circleActionClass
            )}
            onClick={startForward}
          >
            <Forward className="h-4 w-4" />
            {compactThreadActions ? null : t("actionForward")}
          </button>
          <EmojiReactionButton
            disabled={sending}
            className={cn(threadActionIconClass, "[&_svg]:h-5 [&_svg]:w-5")}
            onPick={(emoji) => void sendQuickReply(emoji)}
          />
        </div>
      ) : null}

      {mode ? (
        /*
          The sweep's frame. Neutral at rest — display: contents, so the
          band beneath is an ordinary child of the column — and, while the
          focus is changing, absolute over the pane with the clip edge
          travelling across it. The band inside already stands where it is
          going: filling the frame on the way up, back on its resting
          strip at the bottom on the way down, so the edge only ever
          reveals what will be there when it stops.
        */
        <div
          className={
            replyFocusSliding
              ? "absolute inset-0 z-10 transition-[clip-path] motion-reduce:transition-none"
              : "contents"
          }
          style={
            replyFocusSliding
              ? {
                  clipPath: replyGrown
                    ? "inset(0px)"
                    : `inset(calc(100% - ${Math.max(
                        replyBandRestRef.current,
                        160
                      )}px) 0px 0px 0px)`,
                  willChange: "clip-path",
                  transitionDuration: `${PANE_SLIDE_MS}ms`,
                  transitionTimingFunction: PANE_SLIDE_EASE,
                }
              : undefined
          }
        >
        <div
          ref={replyBandRef}
          onWheel={bandFills ? undefined : scrollComposerFromBand}
          className={cn(
            "mail-composer-region relative flex min-h-0 flex-col border-t border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] py-4",
            /* Edge to edge at this width, all but the right: the box was
               ending exactly where the window does, and the words in it
               ran up to the glass. The left has the list beside it to
               stand off, and the right had nothing. Eight pixels, which
               is what the box needed and all the room there is to give.

               The floating card is not a pane in a window. It stands on
               its own, with its own border down both sides and nothing
               beside it to stand off, so the left is given the same eight
               pixels as the right. */
            compactComposer
              ? floating
                ? "px-2"
                : "pl-0 pr-2"
              : fullWidthComposer
                ? "px-3"
                : "px-8",
            /* The card put away keeps everything it holds — the words, the
               caret, the files picked — and shows none of it. */
            card.minimised && "hidden",
            bandFills && "flex-1",
            !bandFills && "overflow-hidden"
          )}
          /*
            How much of the pane the reply may take, on the band rather than
            on the box inside it.

            The ceiling used to sit on the words alone, so everything around
            them — the recipients, a forward's own banner and subject, the
            row with Send on it — was added to it. On a short window that
            put Send below the sill, with nothing to scroll to reach it: the
            thread scrolls, and the band it sits above does not.

            The card used to hold the zoom, so a 45vh cap was then drawn at
            118% and the foot sat off the window. Zoom is on this band, and
            the cap is divided by it, so the band that is seen is still 45vh
            (or the dragged height) and the words scroll inside it.

            Bounded here, the parts that cannot shrink take what they need
            and the words take the rest. Not in focus mode, where the band
            is the pane.
          */
          style={
            replyFocusSliding
              ? replyFocus
                ? // Sweeping open: the band already fills the frame.
                  ({
                    zoom,
                    position: "absolute",
                    inset: 0,
                  } as React.CSSProperties)
                : // Sweeping shut: the band already stands on its resting
                  // strip at the bottom, at its resting bounds, and the
                  // closing edge comes down to meet it.
                  ({
                    zoom,
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    maxHeight: composerHeightSet
                      ? `${composerHeight / (zoom || 1)}px`
                      : `${COMPOSER_MAX_SHARE / (zoom || 1)}vh`,
                  } as React.CSSProperties)
              : bandFills
                ? ({ zoom } as React.CSSProperties)
                : ({
                    zoom,
                    maxHeight: composerHeightSet
                      ? `${composerHeight / (zoom || 1)}px`
                      : `${COMPOSER_MAX_SHARE / (zoom || 1)}vh`,
                  } as React.CSSProperties)
          }
        >
          {/*
            The line where the thread stops and the reply starts is the
            handle, all the way across.

            It used to be the top edge of the box itself, which is a
            different line: the box is right-aligned and as narrow as its
            dragged width, so the handle began somewhere in the middle of
            the pane and sat on the recipients — a few pixels over the To
            field, found by hunting for the cursor to change. This is the
            seam the reader can already see, it runs the width of the pane,
            and dragging a seam is what a seam is for.

            Not in focus mode, where the box is already the whole pane and
            there is nothing to give it.
          */}
          {bandFills ? null : (
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label={t("resizeReplyHeight")}
              title={t("dragToResize")}
              onPointerDown={startComposerHeightResize}
              className="absolute inset-x-0 top-0 z-10 h-3 -translate-y-1/2 cursor-ns-resize touch-none"
            />
          )}
          {/* Full-width measure root so % width is of the content box, not padding. */}
          <div className="flex min-h-0 w-full flex-1 flex-col items-end">
          {/* Width matches own bubbles; right-aligned; drag either edge to resize. */}
          <div
            className="relative flex min-h-0 flex-1 flex-col"
            // Its dragged width, until there is not enough pane for a
            // width to be worth choosing.
            style={{
              width:
                /* The card given the whole window is all for this message,
                   so the box takes it — right-aligned at a share of a pane
                   that wide, it stood with half the dialog empty beside
                   it. */
                compactComposer || fullWidthComposer || card.full
                  ? "100%"
                  : `${composerWidthPct}%`,
              maxWidth: "100%",
            }}
          >
          {/* No edges to drag while the box is the whole pane: there is
              nowhere for either to go, and a handle that cannot move is a
              handle that reads as broken. */}
          {compactComposer || fullWidthComposer || card.full ? null : (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("resizeReplyWidth")}
                title={t("dragToResize")}
                onPointerDown={startComposerResize("left")}
                className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none"
              />
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t("resizeReplyWidth")}
                title={t("dragToResize")}
                onPointerDown={startComposerResize("right")}
                className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize touch-none"
              />
            </>
          )}
          {/* Hidden (not unmounted) during preview so the draft is kept.

              Scrolls when what it holds is taller than the band. A forward
              on a short window used to fill the band with its banner,
              subject and recipients, and the box you type in was squeezed
              to nothing — there was a toolbar and no place to write. The box
              keeps a floor now, and this column scrolls rather than let the
              band cut Send off below it. */}
          <div
            ref={composerColumnRef}
            className={cn(
              showPreview ? "hidden" : undefined,
              "mail-composer-column flex min-h-0 flex-1 flex-col",
              !bandFills && "overflow-y-auto"
            )}
          >
          {/* What is going with it.
              The forwarded message is attached when the mail is sent, so
              nothing on screen said which one it was — and a forward started
              from a message's own hover menu could not be told from one
              started from the toolbar, which takes the newest. */}
          {forwarding && forwardSource ? (
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
              <Forward
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-stone-500">
                  {forwardWhole
                    ? t("forwardingWholeConversation")
                    : `Forwarding ${
                        forwardSource.own
                          ? "your message"
                          : `${forwardSource.fromName || forwardSource.fromEmail}'s message`
                      }`}
                </span>
                <span className="mt-0.5 block truncate text-xs text-stone-600">
                  {forwardWhole && forwardConversation
                    ? `${forwardConversation.length} messages, oldest first, files included`
                    : reactionQuoteText(forwardSource.bodyText) || "(no text)"}
                </span>
              </span>
            </div>
          ) : null}
          {/* What this reply answers.
              Picking one message out of a thread used to do nothing you could
              see: the caret moved into the box, and which message had been
              picked was invisible until it arrived at the other end. */}
          {!forwarding && quotedForReply ? (
            <div className="mb-2 flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
              <Reply
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-stone-400"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-semibold text-stone-500">
                  Replying to{" "}
                  {quotedForReply.own
                    ? t("yourself")
                    : quotedForReply.fromName || quotedForReply.fromEmail}
                </span>
                <span className="mt-0.5 block truncate text-xs text-stone-600">
                  {reactionQuoteText(quotedForReply.bodyText) || t("noText")}
                </span>
              </span>
              <button
                type="button"
                title={t("answerThreadInstead")}
                aria-label={t("answerThreadInstead")}
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
                onClick={() => setQuoteMessageId(null)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}
          {forwarding || subjectOpen ? (
            /* A forward often starts something of its own, so its subject
               is the writer's to set, and the row is always there.

               A reply's subject is the thread's, so the row would say
               nothing on most replies — but sometimes the conversation has
               moved on and the old subject is now wrong. Asked for, the
               same row appears, and the reply keeps its place in the
               thread and its quoted history under a name that fits. */
            <label className="mb-1.5 flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-2.5 py-[7px]">
              <span className="shrink-0 text-xs text-muted-foreground">
                {t("fieldSubject")}
              </span>
              <input
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                placeholder={forwarding ? forwardSubject : replySubject}
                autoFocus={subjectOpen && !forwarding}
                className="min-w-0 flex-1 bg-transparent text-sm text-stone-800 outline-none placeholder:text-stone-400"
              />
            </label>
          ) : null}
          {/* Said where it is done, not in a tooltip on the way in. A
              forward starts its own conversation whatever it is called,
              so it has nothing to be told. */}
          {subjectOpen && !forwarding ? (
            <p className="mb-1.5 px-1 text-xs text-stone-500">
              {t("newSubjectStartsConversation")}
            </p>
          ) : null}
          <div
            className={cn(
              "mb-1 flex gap-2",
              /* On one line, the focus button is taller than the words
                 beside it, and aligned to the top it hung below them —
                 which read as space under the line rather than as a
                 button standing proud of it. Centred, that height is
                 shared above and below.

                 Opened out into the recipient fields, the block is taller
                 than the button and centring would strand it halfway down
                 the side, so there it still sits at the top. */
              editRecipients ? "items-start" : "items-center",
              /* Stays at the top while the reply scrolls under it, so the
                 pop-out and expand buttons are always in reach. Not when
                 the recipient fields are open: that block is tall, and
                 held in place it would cover the box you type in. */
              !editRecipients &&
                "sticky top-0 z-20 bg-[var(--mail-thread-chrome)] py-1"
            )}
            onDoubleClick={(e) => {
              if (floating) return;
              if (isInteractiveDoubleClickTarget(e.target)) return;
              setReplyFocus((v) => !v);
            }}
          >
            <div className="min-w-0 flex-1">
              {editRecipients ? (
                /* The provider is what lets a chip be dragged from To to
                   Cc. The compose window has one; the reply had none, so
                   its chips would not lift. */
                <RecipientCarryProvider>
                <div className="flex flex-col gap-1.5">
                  {/*
                    To beside From while there is room, From above To when
                    there is not. The From box is as wide as an address and
                    does not give, so on a narrow pane it squeezed the To
                    field into a column of one chip per line. Wrapped in
                    reverse, the line that no longer fits — From — goes
                    above rather than below, which is where the compose
                    window keeps it; and with the cross axis turned around,
                    items-end is the top.
                  */}
                  <div className="flex flex-wrap-reverse items-end gap-2">
                    <div className="min-w-[min(16rem,100%)] flex-1">
                      <RecipientField
                        label={t("fieldTo")}
                        values={toList}
                        onChange={setToList}
                        allowSaveList
                        // Reply-all to a circular is thirty addresses. Folded
                        // while nobody is editing them, as in the compose
                        // window — see RecipientField.
                        collapseAfter={6}
                        ownAccounts={accounts}
                        placeholder={
                          forwarding
                            ? "name@example.com, second@example.com"
                            : t("addRecipient")
                        }
                        inputRef={recipientInputRef}
                      />
                    </div>
                    <div className="flex max-w-full shrink-0 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2.5 py-[7px]">
                      <span className="text-xs text-muted-foreground">
                        {t("fieldFrom")}
                      </span>
                      {accounts.length > 1 ? (
                        <span className="relative inline-flex items-center">
                          <select
                            value={fromAccount}
                            onChange={(e) => setFromAccount(e.target.value)}
                            className="max-w-[22ch] cursor-pointer appearance-none truncate bg-transparent py-0.5 pr-4 text-sm text-stone-700 outline-none"
                          >
                            {accounts.map((a) => (
                              <option key={a} value={a}>
                                {a}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-stone-400" />
                        </span>
                      ) : (
                        <span className="py-0.5 text-sm text-stone-700">
                          {account}
                        </span>
                      )}
                    </div>
                  </div>
                  {ccList.length || showCc ? (
                    <RecipientField
                      label={t("fieldCc")}
                      values={ccList}
                      onChange={setCcList}
                      collapseAfter={6}
                      ownAccounts={accounts}
                      placeholder={t("addRecipient")}
                    />
                  ) : (
                    <p className="px-1 text-xs text-muted-foreground">
                      <button
                        type="button"
                        className="text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
                        onClick={() => setShowCc(true)}
                      >
                        {t("addCc")}
                      </button>
                    </p>
                  )}
                </div>
                </RecipientCarryProvider>
              ) : (
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-muted-foreground">
                  <span>{t(forwarding ? "forwardingTo" : "replyingTo")}</span>
                  {addressMenu}
                  <button
                    type="button"
                    title={t("editRecipients")}
                    className="min-w-0 truncate font-semibold text-stone-800 underline-offset-2 hover:underline"
                    onClick={() => setEditRecipients(true)}
                  >
                    {toList.length ? (
                      <RecipientSummary
                        recipients={toList}
                        onAddressMenu={openAddressMenu}
                      />
                    ) : (
                      t("addRecipients")
                    )}
                  </button>
                  <span aria-hidden>·</span>
                  <button
                    type="button"
                    title={t(ccList.length ? "editCc" : "addCc")}
                    className="min-w-0 truncate text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
                    onClick={() => {
                      setShowCc(true);
                      setEditRecipients(true);
                    }}
                  >
                    Cc
                    {ccList.length ? (
                      <span className="ml-1 font-semibold text-stone-800">
                        <RecipientSummary
                          recipients={ccList}
                          onAddressMenu={openAddressMenu}
                        />
                      </span>
                    ) : null}
                  </button>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1">
                    from
                    {accounts.length > 1 ? (
                      /* As wide as the address it names, with the chevron
                         where the words stop. A select was as wide as its
                         longest option, so with a team address in the list
                         the shorter ones left a gap with nothing in it. */
                      <FromAccountMenu
                        value={fromAccount}
                        accounts={accounts}
                        onChange={setFromAccount}
                      />
                    ) : (
                      <span className="text-stone-700">{account}</span>
                    )}
                  </span>
                </p>
              )}
            </div>
            {onFloatReply && !floating ? (
              /*
               * Sends the reply to the floating card. The card does not
               * draw it: a button to pop out what is already out says
               * nothing, and the card's heading has the way back to the
               * thread. The shortcut still works both ways.
               */
              <button
                type="button"
                title={`${t("writeWhileYouBrowse")} (${formatShortcut(
                  shortcuts.floatMessage
                )})`}
                aria-label={`${t("writeWhileYouBrowse")} (${formatShortcut(
                  shortcuts.floatMessage
                )})`}
                className="shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
                /* Called, not handed to the button: the first argument is
                   the snapshot to hand over, and a click event is not one. */
                onClick={() => floatReply()}
              >
                <PictureInPicture2 className="h-4 w-4" />
              </button>
            ) : null}
            {floating ? null : (
              /*
               * Grow the message over the thread. The card has no thread
               * under it to grow over — it is the message on its own, and
               * as big as it is dragged — so the button is not drawn there.
               * The compose window's card leaves it out for the same
               * reason. What the card does have is its heading, and the way
               * back to the thread on it.
               */
              <button
                type="button"
                title={`${t(replyFocus ? "showThread" : "focusMode")} (${formatShortcut(
                  shortcuts.focusMessage
                )})`}
                aria-label={`${t(replyFocus ? "showThread" : "focusMode")} (${formatShortcut(
                  shortcuts.focusMessage
                )})`}
                aria-pressed={replyFocus}
                className="shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
                onClick={() => setReplyFocus((v) => !v)}
              >
                {replyFocus ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
            {aiReplyNotes || aiReplyWorking ? (
              <AiReplyNotes
                result={aiReplyNotes}
                working={aiReplyWorking}
                onStop={stopAiReply}
                onRestoreBrief={restoreAiReplyBrief}
                onDismiss={dismissAiReplyNotes}
              />
            ) : null}
            <div
            key={editorKey}
            ref={replyRef}
            className={cn(
              // The card is chrome and takes the theme; only the box you
              // type in is a light island — see below, and the compose
              // window, which is split the same way.
              "mail-composer-card relative flex flex-1 flex-col rounded-xl border border-teal-700/50 bg-white focus-within:border-teal-700",
              // Never shorter than its own floor and the row with Send on
              // it. In focus mode the card is the pane and may shrink.
              bandFills ? "mail-composer-card-focus min-h-0" : "min-h-min"
            )}
            {...attachDropHandlers}
            {...attachPasteHandlers}
          >
              <ComposerDropOverlay visible={attachDragging} />
              {/* Where the words go. No light island: what you write is
                  shown in the thread on a dark bubble now, so writing it on
                  a white one would be the odd half of the pair. In focus
                  mode this is the child that grows, so it carries the flex
                  chain the editor needs. */}
              {/* The message, the signature and the files scroll as one:
                  the signature is the end of the letter, not a lid on it.
                  It used to sit under a box that scrolled by itself, so a
                  long reply stopped mid-sentence and the signature began. */}
              <div
                className={cn(
                  "mail-composer-scroll flex-1 rounded-t-xl",
                  // A floor of about three lines, so there is always a place
                  // to click and type, however much sits above the box.
                  bandFills ? "flex min-h-0 flex-col" : "min-h-[4.5rem]"
                )}
              >
              <RichTextEditor
                className="mail-message-editor"
                toolbarId="mail-reply-toolbar"
                handleRef={replyEditorHandle}
                defaultValue={reply}
                onChange={setReply}
                placeholder={
                  forwarding ? t("forwardNotePlaceholder") : replyBoxPlaceholder
                }
                /*
                  The floor never moves.

                  What the reader drags is the ceiling — how much room the
                  box may take — and an empty reply starts small whatever
                  they have set, the way it always did. Making the drag set
                  both was worse than the thing it fixed: every new reply
                  opened at the full height somebody had once dragged to,
                  with nothing in it.
                */
                minHeight={replyFocus ? 240 : bandFills ? 120 : DEFAULT_COMPOSER_HEIGHT}
              />
              {includeSignature && sigSettings?.signature ? (
                <ComposerSignature signature={sigSettings.signature} />
              ) : null}
              </div>
            <div className="flex shrink-0 flex-col gap-1.5 px-3 pb-2.5 pt-1">
              {/* The files, docked here above Send rather than at the end
                  of the body: a long reply scrolled them out of view, and a
                  file was attached twice for want of seeing it once. */}
              <DraftAttachmentChips
                docked
                className="pb-1"
                items={attachItems}
                onRemove={removeAttach}
                onPreview={setDraftPreviewId}
              />
              <div className="flex flex-wrap items-center gap-3">
                {/* One control: Send, and a section that says when. Not on a
                    forward — that leaves through its own path, which has
                    nowhere to put a time. */}
                <div className="inline-flex items-stretch overflow-hidden rounded-lg">
                  <Button
                    type="button"
                    className="h-8 rounded-none bg-teal-600 pl-3 pr-2 text-sm font-semibold text-white hover:bg-teal-700"
                    /* Named with its key, the way the actions above the
                       thread are. The same key sends a forward, so the
                       tooltip follows the word on the button. */
                    title={`${t(forwarding ? "actionForward" : "send")} (${formatShortcut(
                      shortcuts.send
                    )})`}
                    disabled={
                      sending ||
                      !emailsOfRecipients(toList).length ||
                      !attachmentsReady ||
                      (!forwarding && !replyText.trim() && !attachItems.length)
                    }
                    onClick={() => void (forwarding ? sendForward() : send())}
                  >
                    {/* Before the word, pointing the way out. A forward is
                        a send too, so it carries the same arrow.

                        Under the 16px the button gives every icon it
                        holds — an arrow beside one word reads as a mark
                        on it rather than a button of its own. The `!`
                        is what beats the button's rule, which reaches
                        the icon as a descendant and so outranks a plain
                        class on it. */}
                    <SendHorizontal aria-hidden className="!size-3.5" />
                    {sending
                      ? t("sending")
                      : t(forwarding ? "actionForward" : "send")}
                  </Button>
                  <SendLaterMenu
                    schedule={canSendLater && !forwarding}
                    onPick={(iso) => void send(iso)}
                    extras={[
                      ...(mailUsesCrmPeople() &&
                      !forwarding &&
                      (mode === "reply" || mode === "replyAll")
                        ? [
                            {
                              id: "crm",
                              label: t("sendAndProposeCrm"),
                              disabled:
                                sending ||
                                !emailsOfRecipients(toList).length ||
                                !attachmentsReady ||
                                (!replyText.trim() && !attachItems.length),
                              onSelect: () =>
                                void send(undefined, { proposeCrm: true }),
                            },
                          ]
                        : []),
                      {
                        id: "preview",
                        label: t("previewFirst"),
                        onSelect: () => setShowPreview(true),
                      },
                      ...(canOpenInOutlook
                        ? [
                            {
                              id: "outlook",
                              label: t("openInOutlookInstead"),
                              icon: <ExternalLink aria-hidden />,
                              title: outlookElsewhere
                                ? t("openInOutlookFrom", {
                                    account: outlookTarget,
                                  })
                                : undefined,
                              disabled:
                                sending ||
                                handingOver ||
                                !emailsOfRecipients(toList).length ||
                                !attachmentsReady ||
                                (!replyText.trim() && !attachItems.length),
                              onSelect: () => void openInOutlook(),
                            },
                          ]
                        : []),
                    ]}
                    trigger={
                      <button
                        type="button"
                        aria-label={t("sendOptions")}
                        title={t("sendOptions")}
                        className="flex h-8 items-center border-l border-white/25 bg-teal-600 pl-1.5 pr-2 text-white hover:bg-teal-700 disabled:opacity-50"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      </button>
                    }
                  />
                </div>
                {/* Quill binds to this element by id and writes its own
                    classes on it, so nothing here sets className: React
                    would overwrite them on the next render and leave the
                    buttons unstyled.

                    The lists live in Aa. They used to sit on this row and
                    wrap it off the pane long before B, I, U and the link
                    ran out of room. */}
                <ComposerToolbar id="mail-reply-toolbar" editorHandle={replyEditorHandle} />
                <AttachToolbarButton
                  onPick={addAttachFiles}
                  disabled={sending}
                />
                {/* No size line: the chips above the row name every file
                    already, and the compose box says it once too. What is
                    left of a warning is the one below, which speaks only
                    when a forward is near the provider's limit. */}
                {/* One row, so the bin sits level with Send rather than on
                    a line of its own under it. There were two rows because
                    the second held Add signature, Preview and Chat style
                    as well; those are under the card now, and what is left
                    belongs beside the buttons it is one of. */}
                <span className="ml-auto flex items-center gap-3">
                  {/* The bin only bins. Escape is what asks first, and
                      what it asks with is the dialog at the foot of this
                      component — over the whole reader rather than in the
                      corner it was pointing at. */}
                  <button
                    type="button"
                    title={t(forwarding ? "discardForward" : "discardReply")}
                    aria-label={
                      t(forwarding ? "discardForward" : "discardReply")
                    }
                    className="mail-composer-discard rounded p-1 text-stone-500"
                    onClick={discardComposer}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </div>
            </div>
          </div>
          {/* Under the box, outside the card.
              Facts about the message, not the writing of it. Preview,
              Outlook and a CRM propose sit on the Send chevron. */}
          <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <SignatureMetaControls
              account={fromAccount}
              configured={Boolean(sigSettings?.signature)}
              included={includeSignature}
              onAdd={() => {
                if (sigSettings?.signature) setIncludeSignature(true);
                else setSigDialogOpen(true);
              }}
              onEdit={() => setSigDialogOpen(true)}
              onRemove={() => setIncludeSignature(false)}
            />
            {/* A reply under a subject that no longer fits.
                The conversation stays whole — same thread, same quoted
                history — and only the name of it changes. Offered rather
                than shown, because on most replies the subject is not a
                question worth putting a field in front of somebody for.
                A forward's row is always up, so it needs no way in. */}
            {!forwarding && !subjectOpen ? (
              <button
                type="button"
                title={t("changeSubjectHint")}
                className="text-xs text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
                onClick={() => {
                  setSubjectDraft(replySubject);
                  setSubjectOpen(true);
                  /*
                    And out of the thread, into the card in the corner.

                    The message is about to stop being part of the
                    conversation it is written under, and that is worth
                    seeing at the moment it is asked for rather than in
                    somebody else's inbox afterwards. Gmail says the same
                    thing by popping the reply out.

                    The card passes its own snapshot: the subject was set
                    a line ago and is not in the rendered one yet. Already
                    in the card, or on a phone that has no card, the row
                    simply opens.
                  */
                  if (!floating && onFloatReply) {
                    floatReply({
                      ...composerSnapshotRef.current,
                      subject: replySubject,
                    });
                  }
                }}
              >
                {t("changeSubject")}
              </button>
            ) : null}
            {/* Asked the way round it is answered: quoting the history is
                what a reply does, so the box is ticked and unticking it is
                the choice. `chatStyle` is still the state underneath — the
                name of a reply that quotes nothing — and this is its
                opposite, which is why the two are crossed here. */}
            {!forwarding && mode === "reply" ? (
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800">
                {/* Drawn rather than accented. `accent-color` fills the box
                    with the colour and leaves the tick white, so teal was
                    a solid teal square on a line of quiet grey — the
                    loudest thing under the message. This is the box the
                    line is written in, with the tick in the same ink.

                    Both colours are turned over by the dark theme, which
                    rewrites bg-white and text-stone-700 for the shell — so
                    a dark box with a light tick needs nothing said here. */}
                <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    className="peer h-3.5 w-3.5 appearance-none rounded-[3px] border border-stone-300 bg-white outline-none checked:border-stone-400 focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-50"
                    checked={!chatStyle}
                    disabled={chatStyleBusy}
                    onChange={(e) => void setChatStyle(!e.target.checked)}
                  />
                  <Check
                    aria-hidden
                    className="pointer-events-none absolute h-3 w-3 text-stone-700 opacity-0 peer-checked:opacity-100"
                  />
                </span>
                {t("quoteHistory")}
              </label>
            ) : null}
            {/* The same drawn box as Quote history. This is the forward's
                version of the same question — how much of the past goes
                with the mail — so it stands where that one stands. */}
            {/* Only where there is something to include. A message with no
                files has nothing for this to say. The whole-conversation box
                brings its own files, so this one stands down for it. */}
            {forwarding &&
            !forwardWhole &&
            forwardSource?.attachments?.length ? (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800",
                  forwardFilesBusy && "opacity-60"
                )}
              >
                <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    className="peer h-3.5 w-3.5 appearance-none rounded-[3px] border border-stone-300 bg-white outline-none checked:border-stone-400 focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-50"
                    checked={forwardFiles}
                    disabled={forwardFilesBusy}
                    onChange={(e) =>
                      void setForwardIncludeFiles(e.target.checked, forwardSource)
                    }
                  />
                  <Check
                    aria-hidden
                    className="pointer-events-none absolute h-3 w-3 text-stone-700 opacity-0 peer-checked:opacity-100"
                  />
                </span>
                {forwardFilesBusy
                  ? t("fetchingFiles")
                  : t("includeAttachmentsCount", { count: forwardSource.attachments.length })}
              </label>
            ) : null}
            {forwarding ? (
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800",
                  forwardWholeBusy && "opacity-60"
                )}
              >
                <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  <input
                    type="checkbox"
                    className="peer h-3.5 w-3.5 appearance-none rounded-[3px] border border-stone-300 bg-white outline-none checked:border-stone-400 focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-50"
                    checked={forwardWhole}
                    disabled={forwardWholeBusy}
                    onChange={(e) =>
                      void setForwardWholeConversation(e.target.checked)
                    }
                  />
                  <Check
                    aria-hidden
                    className="pointer-events-none absolute h-3 w-3 text-stone-700 opacity-0 peer-checked:opacity-100"
                  />
                </span>
                {forwardWholeBusy
                  ? t("fetchingConversation")
                  : forwardWhole && forwardConversation
                    ? t("forwardWholeConversationCount", { count: forwardConversation.length })
                    : t("forwardWholeConversation")}
              </label>
            ) : null}
            {/* Quiet, on the right: the draft is about the whole mail,
                the same kind of thing this row already holds. */}
            {mailUsesCrmPeople() &&
            !forwarding &&
            (mode === "reply" || mode === "replyAll") ? (
              <AiReplyMenu
                className="ml-auto"
                drafting={draftingReply}
                disabled={sending}
                onDraft={(hint) => void draftReplyWithAi(hint)}
                onStop={stopAiReply}
              />
            ) : null}
            {/* Providers refuse a mail past their limit. Said here, while
                there are chips to prune, rather than as an error after the
                send. Base64 makes files a third bigger on the wire, which
                is why this speaks up short of the stated number. */}
            {forwarding &&
            attachTotalBytes >
              (canSendLater ? 20 : 25) * 1024 * 1024 * 0.72 ? (
              <p className="w-full text-[11px] leading-snug text-amber-700">
                {`The files together are about ${Math.round(
                  attachTotalBytes / (1024 * 1024)
                )} MB. ${
                  canSendLater ? "Outlook" : "Gmail"
                } takes about ${canSendLater ? 20 : 25} MB in one mail, so it may refuse this. Remove some files.`}
              </p>
            ) : null}
            {!forwarding && mode === "reply" && chatStyle ? (
              <p className="text-[11px] text-stone-400">
                {t("rememberedForConversation")}
              </p>
            ) : null}
          </div>
          </div>
          {showPreview ? (
            <SentPreview
              fromName={senderName}
              from={fromAccount}
              to={emailsOfRecipients(toList)}
              cc={emailsOfRecipients(ccList)}
              subject={outgoingSubject}
              bodyHtml={bodyToEmailHtml(reply)}
              hasBody={Boolean(replyText.trim())}
              includeSignature={Boolean(
                includeSignature && sigSettings?.signature
              )}
              zoom={zoom}
              /* The preview is the mail as it will land, so a reply that
                 quotes nothing previews with nothing quoted. This used to
                 be handled by the preview not being reachable at all with
                 the history left out. */
              /* The preview is the mail as it will land. A forwarded
                 conversation and a rebuilt tail carry their attributions
                 inside themselves, so those pass no intro line; the one
                 remaining single-message case is a reply to a picked
                 message, which still introduces itself the old way. */
              quote={
                forwarding
                  ? forwardWholeAppendix
                    ? {
                        text: forwardWholeAppendix.text,
                        html: forwardWholeAppendix.html,
                      }
                    : quotePayload
                      ? {
                          intro: `Forwarded message — from ${
                            quotePayload.fromName
                              ? `${quotePayload.fromName} <${quotePayload.fromEmail}>`
                              : quotePayload.fromEmail
                          }, ${quotePayload.date}:`,
                          text: quotePayload.text,
                          html: quotePayload.html,
                        }
                      : undefined
                  : chatStyle
                    ? undefined
                    : quoteMessageId && quotePayload
                      ? {
                          intro: `On ${quotePayload.date}, ${
                            quotePayload.fromName
                              ? `${quotePayload.fromName} <${quotePayload.fromEmail}>`
                              : quotePayload.fromEmail
                          } wrote:`,
                          text: quotePayload.text,
                          html: quotePayload.html,
                        }
                      : historyAppendix
                        ? {
                            text: historyAppendix.text,
                            html: historyAppendix.html,
                          }
                        : undefined
              }
              recipientName={recipientName}
              sending={sending}
              canSend={Boolean(
                emailsOfRecipients(toList).length &&
                  attachmentsReady &&
                  (forwarding || replyText.trim() || attachItems.length)
              )}
              sendLabel={t(forwarding ? "actionForward" : "send")}
              onSend={() => void (forwarding ? sendForward() : send())}
              onBack={() => setShowPreview(false)}
            />
          ) : null}
          </div>
          </div>
        </div>
        </div>
      ) : null}
      </div>
      {/* Over the whole reader, because it is a question about the whole
          draft. In the corner of the footer row it read as one more
          control among the buttons that write the message, which is the
          opposite of what a last chance should look like. */}
      {forgottenAttachment ? (
        <SettingsDialog
          title={t("attachmentReminderAsk")}
          width="w-[400px]"
          bare
          onClose={clearForgottenAttachment}
          footer={
            <>
              <button
                type="button"
                className={settingsSecondaryButton}
                onClick={clearForgottenAttachment}
              >
                {t("attachmentReminderBack")}
              </button>
              {/* Focused, so Enter sends: somebody who meant it should not
                  have to reach for the mouse to say so. */}
              <button
                type="button"
                autoFocus
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-teal-800"
                onClick={() => {
                  const held = forgottenAttachment;
                  clearForgottenAttachment();
                  void send(held?.sendAt, held?.extras, true);
                }}
              >
                {t("attachmentReminderSend")}
              </button>
            </>
          }
        >
          <p className="text-sm text-stone-600">
            {t("attachmentReminderBody")}
          </p>
        </SettingsDialog>
      ) : null}
      {confirmDiscard ? (
        <SettingsDialog
          title={t(forwarding ? "discardForwardAsk" : "discardDraftAsk")}
          width="w-[400px]"
          bare
          onClose={() => setConfirmDiscard(false)}
          footer={
            <>
              <button
                type="button"
                className={settingsSecondaryButton}
                onClick={() => setConfirmDiscard(false)}
              >
                {t("keepDraft")}
              </button>
              {/* Focused on arrival, so Enter answers the question the way
                  it answers every other dialog — and so the keys go to the
                  dialog rather than into the draft behind it. Discarding
                  can be taken back for as long as the toast stands; the
                  half-written reply this interrupts cannot. */}
              <button
                type="button"
                autoFocus
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                onClick={() => {
                  setConfirmDiscard(false);
                  discardComposer();
                }}
              >
                {t("discard")}
              </button>
            </>
          }
        >
          <p className="text-sm text-stone-600">
            {t("unsentWillBeDeleted")}
          </p>
        </SettingsDialog>
      ) : null}
      <SignatureDialog
        open={sigDialogOpen}
        accounts={accounts}
        initialAccount={fromAccount}
        onClose={() => setSigDialogOpen(false)}
        onSaved={(savedAccount, settings) => {
          if (savedAccount === fromAccount) setSigSettings(settings);
        }}
      />
      {diaryProposal ? (
        <DiaryEntriesDialog
          proposal={diaryProposal}
          onClose={closeDiaryProposal}
        />
      ) : null}
    </div>
  );
}


