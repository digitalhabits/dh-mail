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
import { toast } from "@/lib/mail/toast";
import { promisesAnAttachment } from "@/lib/mail/attachment-hint";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import { isPublicMailProduct } from "@/lib/mail/product-flavor";
import { outlookDraftAccount } from "@/lib/mail/outlook-handover";
import {
  bodyTravels,
  ccBackToSelf,
  copyMessageToClipboard,
  saveAttachmentsForHandover,
  withoutTrailingSignature,
  openOutlookCompose,
  outlookComposeUrl,
} from "@/lib/mail/outlook-compose";

import { CrmProposeMenu } from "@/components/mail/CrmProposeMenu";
import {
  DiaryEntriesDialog,
  type DiaryProposal,
} from "@/components/mail/DiaryEntriesDialog";
import { AiReplyMenu } from "@/components/mail/AiReplyMenu";
import { AiReplyNotes, type AiReplyDraftResult } from "@/components/mail/AiReplyNotes";
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
  stripQuotedHtml,
} from "@/components/mail/EmailHtmlView";
import { ThreadFindBar } from "@/components/mail/ThreadFindBar";
import { useThreadFind } from "@/components/mail/use-thread-find";
import {
  AttachmentPreviewDialog,
  AttachToolbarButton,
  attachmentUrl,
  ComposerDropOverlay,
  DraftAttachmentChips,
  DraftAttachmentPreviewDialog,
  ThreadAttachmentsRollup,
  useComposerFileDrop,
  useComposerPaste,
  useDraftAttachments,
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
import {
  quotedReplyMessage,
  reactionMessage,
  reactionQuoteText,
} from "@/lib/mail/reaction-message";
import {
  draftBodyForComposer,
  shouldImportProviderDraft,
} from "@/lib/mail/import-provider-draft";
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
import { sendWithUndo } from "@/components/mail/undo-send";
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
  usePinchZoom,
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
import { bodyToEmailHtml, htmlToPlainText, plainTextToEditorHtml } from "@/lib/client-email-html";
import { formatEmailBody } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import {
  buildQuoteHistory,
  REPLY_HISTORY_CAP,
} from "@/lib/mail/quote-history";
import { replyHistoryEntry } from "@/lib/mail/reply-history";
import {
  afterMailPaneSlide,
  PANE_SLIDE_MS,
  PANE_SLIDE_EASE,
} from "@/lib/mail/pane-slide";
import { usePaneSweep } from "@/lib/mail/use-pane-sweep";
import { signsThisReply } from "@/lib/mail/signature-rules";
import { restoreAnchorsForEditing } from "@/lib/mail/soften-anchors";
import { mailApiFetch, mailApiJson as apiJson } from "@/lib/mail/api";
import {
  chatTitleFromCounterpart,
  partJumpLabel,
  type MailChatPartSummary,
  type MailChatRef,
} from "@/lib/mail/chat-types";
import {
  emailsOfRecipients,
  flattenRecipientsForSend,
  formatRecipientSummary,
  recipientsFromEmails,
  type MailRecipient,
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
import {
  deleteDraft,
  markDraftHandedOver,
  getDraft,
  readyAttachmentsForDraft,
  saveThreadDraft,
  threadDraftKey,
  type ThreadMailDraft,
} from "@/lib/mail/local-drafts";
import {
  cancelPendingDiscard,
  DISCARD_UNDO_MS,
  schedulePendingDiscard,
} from "@/lib/mail/pending-discard";
import { openMailChatPopout } from "@/lib/mail/popout";
import { type CrmProposeResult } from "@/components/mail/CrmProposalDialog";
import {
  proposeCrmFromThread,
  showCrmProposal,
  useCrmProposing,
} from "@/components/mail/CrmProposalHost";
import {
  canReadAttachmentText,
  isReadableAttachment,
} from "@/lib/mail/attachment-text";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import {
  focusChatPopout,
  handBackChatPopout,
  isChatPopoutOpen,
  notifyPlannerCrmChanged,
} from "@/lib/native-shell";
import {
  getCachedMailThread,
  isMailThreadCacheFresh,
  loadCachedMailThread,
  setCachedMailThread,
} from "@/lib/mail/thread-cache";
import type {
  MailAttachment,
  MailMessage,
  MailScheduledMessage,
  MailThreadAction,
  MailThreadDetail,
} from "@/lib/mail/types";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { useCardDrag } from "@/components/mail/use-card-drag";
import { ThreadParticipants, participantsWithAddresses, threadPeople } from "@/components/mail/ThreadParticipants";
import { OutboxEntry, mergeNewestThreadPage, messageKey, messageKeys, scheduleThreadRefetchAfterSend, loadWholeThread, type ComposerMode } from "@/components/mail/thread-messages";
import { toastCrmNotesResult } from "@/components/mail/thread-crm-notes";
import { PopoutStrip } from "@/components/mail/PopoutStrip";
import { ThreadToolbarOverflow } from "@/components/mail/ThreadToolbarOverflow";
import { ThreadAction } from "@/components/mail/ThreadAction";
import { DayHeading, PartSeam } from "@/components/mail/ThreadStreamMarks";

/**
 * Where the reply actions stop having room for their words.
 *
 * Reply, Reply all and Forward with their icons, the gaps between them and
 * the padding around them come to about this. Below it they wrapped.
 */
const THREAD_ACTIONS_MIN_WIDTH = 480;

const COMPOSER_MIN_WIDTH = 700;

/**
 * Where a composer narrower than the pane stops being worth the gutter.
 *
 * The box matches the width of your own bubbles and sits against the right,
 * which reads well with a thread beside it. On a narrow pane that gutter is
 * a third of the room, and the recipient field left in what remains is too
 * narrow to hold two addresses side by side — thirty of them became thirty
 * lines. Below this the box takes the whole width and the addresses get it.
 */
const COMPOSER_FULL_WIDTH = 900;

/** Close enough to the end of a thread to count as being at it. */
const NEAR_LATEST_PX = 120;

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

/**
 * How long to watch for the pop-out to go after asking it to hand back.
 *
 * The ask returns as soon as it has been made — the saving and the closing
 * happen in the other window a moment later. Three seconds is far longer
 * than that takes and short enough that a window which never goes (it was
 * closed by hand in the meantime) stops being waited for.
 */
const POPOUT_HAND_BACK_POLL_MS = 120;
const POPOUT_HAND_BACK_TRIES = 25;


/**
 * How large a pasted picture may be, written into the message.
 *
 * A screenshot from a modern display is several megabytes, and base64 adds a
 * third on top. Written into the body, that is what the recipient downloads
 * before they can read the first line — and nobody wants an email that
 * arrives at eight megabytes because a window was photographed.
 *
 * Above this it goes as a file instead, which is what an attachment is for.
 */
const MAX_INLINE_PASTE_BYTES = 2 * 1024 * 1024;

/** The same, measured on a data: URI — base64 is four bytes for every three. */
function dataUrlTooBig(dataUrl: string): boolean {
  const comma = dataUrl.indexOf(",");
  const base64 = comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.floor((base64.length * 3) / 4) > MAX_INLINE_PASTE_BYTES;
}

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
  const [thread, setThread] = React.useState<MailThreadDetail | null>(null);
  // Update CRM applied: the list moves the thread into In CRM, and the
  // planner window (when there is one) fetches fresh rows for an open tab.
  const crmChanged = React.useCallback(() => {
    onCrmChanged();
    void notifyPlannerCrmChanged();
  }, [onCrmChanged]);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [loadingNewer, setLoadingNewer] = React.useState(false);
  const [highlightMessageId, setHighlightMessageId] = React.useState<
    string | null
  >(null);
  const [error, setError] = React.useState<string | null>(null);
  const [chatStyleBusy, setChatStyleBusy] = React.useState(false);
  /** Per-send: ask Grok to update CRM Notes after this reply goes out. */
  const [updateCrmNotes, setUpdateCrmNotes] = React.useState(false);
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
    Up here with the rest, and not beside the function that uses them.

    A thread that has not arrived yet returns early — `if (!thread)` — so a
    hook declared below that line is called on the render after the thread
    lands and not on the one before it. React counts hooks, so the second
    render found more than the first and took the pane down with it. Every
    hook belongs above the first return; the handler can live where it reads
    best, because it is not one.
  */
  const [diaryBusy, setDiaryBusy] = React.useState(false);
  const [diaryProposal, setDiaryProposal] = React.useState<DiaryProposal | null>(
    null
  );
  /** An AI reply draft in flight, and the notes on the last one until dismissed. */
  const [draftingReply, setDraftingReply] = React.useState(false);
  const [aiReplyNotes, setAiReplyNotes] = React.useState<AiReplyDraftResult | null>(null);
  /** Which part of the draft is running, for the strip above the composer. */
  const [aiReplyWorking, setAiReplyWorking] = React.useState<"reading" | "writing" | null>(null);
  /** Print carries the reader's image choice, so a print matches the screen. */
  const [loadImagesByDefault] = useLoadImagesByDefault();
  const shortcuts = useMailShortcuts();
  // Bumping these opens a menu that owns its own open state.
  const [snoozeMenuSignal, setSnoozeMenuSignal] = React.useState(0);
  /** The provider draft this composer was opened from, if any. */
  const importedDraftRef = React.useRef<string | null>(null);
  /**
   * Null until the local draft has been looked for, then whether one was
   * found. State rather than a ref: the thread can paint from the RAM cache
   * before IndexedDB answers, and the import effect has to run again once it
   * does.
   */
  const [localDraftAt, setLocalDraftAt] = React.useState<number | null>(
    null
  );
  /** null = still looking, false = none, a number = written then. */
  const localDraftFound = localDraftAt === null ? null : localDraftAt >= 0;
  /** The thread whose provider draft has already been offered. */
  const importedForThreadRef = React.useRef<string | null>(null);
  const [moveMenuSignal, setMoveMenuSignal] = React.useState(0);
  const [partMenuOpen, setPartMenuOpen] = React.useState(false);
  const [chatParts, setChatParts] = React.useState<MailChatPartSummary[]>([]);
  /** Older chat parts prepended above the open root thread (asc by partIndex). */
  const [olderParts, setOlderParts] = React.useState<
    {
      partIndex: number;
      threadId: string;
      subject: string;
      openedAt: string | null;
      messages: MailMessage[];
      hasOlder: boolean;
    }[]
  >([]);
  const [reply, setReply] = React.useState("");
  // Remounts the editor (feeding Quill's HTML back as a controlled value
  // makes it re-parse on every keystroke and eat trailing spaces).
  const [editorKey, setEditorKey] = React.useState(0);
  const [sending, setSending] = React.useState(false);
  /** Optimistic sends keyed by local-* message id (pending / failed). */
  const [outbox, setOutbox] = React.useState<Record<string, OutboxEntry>>({});
  /** Brief color-in flash after the provider accepts a send. */
  const [confirmingIds, setConfirmingIds] = React.useState<Set<string>>(
    () => new Set()
  );
  const [includeSignature, setIncludeSignature] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  // Which mailbox the reply goes out from; defaults to the thread's account.
  const [fromAccount, setFromAccount] = React.useState(account);
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
    [account, threadId, loadScheduled]
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
  // Reply (sender only), reply-all, or forward; null while the composer is
  // closed. Recipients are always visible and editable once it opens, so no
  // mode can quietly widen the audience.
  const [mode, setMode] = React.useState<ComposerMode | null>(null);
  /**
   * A pop-out window is open for this thread.
   *
   * One message being written has one place. While the pop-out is that
   * place, the thread shows a strip where the reply box would be, rather
   * than a second box for the same reply.
   */
  const [popoutOpen, setPopoutOpen] = React.useState(false);
  const [toList, setToList] = React.useState<MailRecipient[]>([]);
  const [ccList, setCcList] = React.useState<MailRecipient[]>([]);
  /** A right-click on a name in the "Replying to" line. */
  const { openAddressMenu, addressMenu } = useAddressMenu();
  const [showCc, setShowCc] = React.useState(false);
  // Recipients show as a compact "Replying to …" line; clicking it expands
  // the full chip editors.
  const [editRecipients, setEditRecipients] = React.useState(false);
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
  /** Whole reading column — pinch hits header, gaps, and iframe chrome. */
  const pinchRef = React.useRef<HTMLDivElement | null>(null);
  /** Hide the thread and grow the reply/forward composer to fill the pane. */
  const [replyFocus, setReplyFocus] = React.useState(false);
  /*
    The growth moves at the pane slide's tempo — the same gesture as the
    list leaving the reader, so the same speed and the same mechanics.
    For the length of the change the composer band stands absolute over
    the pane below the toolbar, laid out once where it is going, and a
    clip-path edge sweeps between the band's resting strip and the whole
    of the pane. The thread stays mounted beneath until it is covered, so
    the edge covers and uncovers something real, and nothing is laid out
    while it moves.

    `replyGrown` is where the edge stands. `replyFocusSliding` is whether
    the sweep's frame exists at all — false at rest, where the band is an
    ordinary flex child and nothing about it changes. The movement itself
    is usePaneSweep's, the same machine every pane sweep runs on.
  */
  const { at: replyGrown, sliding: replyFocusSliding } =
    usePaneSweep(replyFocus);
  /** The band's height at rest — where the sweep starts and ends. */
  const replyBandRestRef = React.useRef(0);
  const replyBandRef = React.useRef<HTMLDivElement | null>(null);
  /** The part of the reply band that scrolls: the box, not the band. */
  const composerColumnRef = React.useRef<HTMLDivElement | null>(null);
  /*
    A scroll over the band beside the box scrolls the box.

    The box is right-aligned and as narrow as its dragged width, and only
    the box scrolls. A reply taller than the band showed its top, and a
    scroll over the empty band to its left did nothing at all, so the rest
    was reachable only with the pointer over the box.

    Two things scroll in there: the column, which holds the recipients and
    the box, and inside the box the letter itself. A scroll over the letter
    moves the letter first and the column after it. From beside the box the
    two are read as one page, top to bottom: down takes the column to its
    end and then the letter; up takes the letter back to its top and then
    the column. Moving the column alone left the end of a long letter out
    of reach, and its top too once the letter had been scrolled.
  */
  const scrollComposerFromBand = React.useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const column = composerColumnRef.current;
      if (!column || !(event.target instanceof Node)) return;
      if (column.contains(event.target)) return;
      const letter = column.querySelector<HTMLElement>(".mail-composer-scroll");
      const unit =
        event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? column.clientHeight : 1;
      let delta = event.deltaY * unit;
      const room = (el: HTMLElement) =>
        delta > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
      const order = delta > 0 ? [column, letter] : [letter, column];
      for (const el of order) {
        if (!el || !delta) continue;
        const step = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0, room(el)));
        if (!step) continue;
        el.scrollTop += step;
        delta -= step;
      }
    },
    []
  );
  const replyBandAtRestRef = React.useRef(true);
  replyBandAtRestRef.current = !replyFocus && !replyFocusSliding;
  /*
    The resting height, kept while the band is at rest. Read in the
    observer, where layout is already settled, so keeping it forces no
    layout of its own.
  */
  React.useEffect(() => {
    const el = replyBandRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (replyBandAtRestRef.current) {
        replyBandRestRef.current = el.offsetHeight;
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);
  /**
   * The files on the message being forwarded, and whether they go with it.
   *
   * A forward that leaves the attachments behind is not a forward — the
   * point of most of them is the file. They are fetched into the ordinary
   * attachment strip when the composer opens, so they show as chips with a
   * total and a remove each, like anything else attached. The box below
   * takes them all off again, and puts them back.
   */
  const [forwardFiles, setForwardFiles] = React.useState(true);
  const [forwardFilesBusy, setForwardFilesBusy] = React.useState(false);
  /**
   * What was in the strip before the forwarded message's files went in.
   *
   * The ids cannot be had from `addFiles` — it makes them inside a state
   * update and returns nothing — and the ref of items has not caught up by
   * the time the call returns. So the pair is remembered the way the
   * whole-conversation box remembers it: what was already there, and the
   * names of what this added. Anything matching both is ours to take out.
   */
  const preForwardAttachIdsRef = React.useRef<Set<string>>(new Set());
  /**
   * The subject of a forward, which the writer may change.
   *
   * A reply's subject is the thread's and is not a question. A forward is
   * often the start of something else — "the programme you asked for" —
   * and the subject was fixed at `Fwd:` with no way to touch it.
   */
  /**
   * The subject this composer will send, when it is not the thread's own.
   *
   * A forward always shows the row — it is usually the start of something
   * else. A reply shows it only when asked, because a reply's subject is
   * the thread's and changing it is the rare case; the row would otherwise
   * stand over every reply saying what the reader already knows.
   */
  const [subjectDraft, setSubjectDraft] = React.useState("");
  const [subjectOpen, setSubjectOpen] = React.useState(false);
  /** Forward the whole conversation, not only one message. */
  const [forwardWhole, setForwardWhole] = React.useState(false);
  const [forwardWholeBusy, setForwardWholeBusy] = React.useState(false);
  /** The full thread, fetched when the box above is ticked. */
  const [forwardConversation, setForwardConversation] = React.useState<
    MailMessage[] | null
  >(null);
  /** What was in the attachment strip before the conversation's files. */
  const preWholeAttachIdsRef = React.useRef<Set<string>>(new Set());
  /** The strip as of this render, for callbacks that outlive one. */
  const attachItemsRef = React.useRef<
    { id: string; filename: string }[]
  >([]);
  const {
    items: attachItems,
    totalBytes: attachTotalBytes,
    ready: attachmentsReady,
    addFiles: addAttachFiles,
    remove: removeAttach,
    clear: clearAttachments,
    replaceAll: replaceAttachments,
    payload: attachmentPayload,
  } = useDraftAttachments();
  attachItemsRef.current = attachItems;
  /**
   * A picture into the reply itself, at the caret.
   *
   * The same for a paste and for a drop on the words, so both land the
   * same way. Too big to write in, or no editor to write into: it is a
   * file, and the caller attaches it instead.
   */
  const insertInlineImage = React.useCallback((dataUrl: string) => {
    if (dataUrlTooBig(dataUrl) || !replyEditorHandle.current) return false;
    replyEditorHandle.current.insertImage(dataUrl);
  }, []);
  const { dragging: attachDragging, dropHandlers: attachDropHandlers } =
    useComposerFileDrop(addAttachFiles, {
      caretToPoint: (x, y) =>
        replyEditorHandle.current?.caretToPoint(x, y) ?? false,
      insert: insertInlineImage,
    });
  /*
    In a chat-shaped thread a pasted picture attaches, as the pop-out
    already does: written inline it rides invisibly in the bubble's HTML —
    a chat bubble is its words — and the reader watched their screenshot
    vanish. In a mail-shaped reply it still lands in the words, where a
    picture in a letter belongs.
  */
  const { pasteHandlers: attachPasteHandlers } = useComposerPaste(
    addAttachFiles,
    thread?.chat ? undefined : insertInlineImage
  );
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
  /**
   * The reading that zoom puts back, taken at the moment the gesture
   * arrives.
   *
   * It used to be taken when the reader last scrolled, and a reader who
   * opens a thread and zooms without scrolling first has not scrolled:
   * the only reading was the one from before the thread was pinned to its
   * newest message, so zooming threw them to the top of it. Reading it
   * here means there is always one, and always from where they are now.
   *
   * A ref because the reading is defined further down, with the rest of
   * the zoom anchoring, and the gesture is attached up here.
   */
  const takeZoomAnchorRef = React.useRef<
    ((atY: number | null) => void) | null
  >(null);
  /** The size the reader is at now, for effects that closed over an old one. */
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  usePinchZoom(
    pinchRef,
    onZoomAdjust,
    thread !== null && !replyFocus,
    (atY) => takeZoomAnchorRef.current?.(atY)
  );
  /** The buttons and the keys say nothing about where the pointer is. */
  const adjustZoomFromControls = React.useCallback(
    (delta: number) => {
      takeZoomAnchorRef.current?.(null);
      onZoomAdjust(delta);
    },
    [onZoomAdjust]
  );

  // Local draft: skip saves until hydrate finishes; discard suppresses flush.
  const draftReadyRef = React.useRef(false);
  const draftDiscardedRef = React.useRef(false);
  /** The draft key already thrown away, so it is not thrown away twice. */
  const discardedKeyRef = React.useRef<string | null>(null);
  /*
    A new reply is a new draft to discard.

    The guard stops one discard from running twice, when the bin and a key
    answer the same question. It was cleared only by Undo, so a reply written
    after a discard on the same thread could not be discarded: Discard closed
    the question and left the draft where it was. Opening the composer again
    clears the guard.
  */
  React.useEffect(() => {
    if (mode) discardedKeyRef.current = null;
  }, [mode]);
  const draftSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  /**
   * The message a reply or a forward quotes.
   *
   * The newest one, unless the reader picked one from its hover actions. A
   * reply to something said three messages back should quote that, not
   * whatever happens to be last.
   */
  const [quoteMessageId, setQuoteMessageId] = React.useState<string | null>(
    null
  );
  const composerSnapshotRef = React.useRef({
    mode,
    reply,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    attachItems,
    quoteMessageId,
  });
  composerSnapshotRef.current = {
    mode,
    reply,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    attachItems,
    quoteMessageId,
  };
  const threadDefaultsRef = React.useRef<{
    to: MailRecipient[];
    cc: MailRecipient[];
    allTo: MailRecipient[];
    allCc: MailRecipient[];
  }>({ to: [], cc: [], allTo: [], allCc: [] });
  if (thread) {
    threadDefaultsRef.current = {
      to: recipientsFromEmails(thread.reply.to),
      cc: recipientsFromEmails(thread.reply.cc),
      allTo: recipientsFromEmails(thread.reply.allTo ?? thread.reply.to),
      allCc: recipientsFromEmails(thread.reply.allCc ?? thread.reply.cc),
    };
  }

  const persistThreadDraft = React.useCallback(
    (snapshot = composerSnapshotRef.current, keepEmpty = false) => {
      if (!snapshot.mode || draftDiscardedRef.current) return;
      const defaults = threadDefaultsRef.current;
      const defaultTo =
        snapshot.mode === "forward"
          ? []
          : snapshot.mode === "replyAll"
            ? defaults.allTo
            : defaults.to;
      const defaultCc =
        snapshot.mode === "forward"
          ? []
          : snapshot.mode === "replyAll"
            ? defaults.allCc
            : defaults.cc;
      const draft: ThreadMailDraft = {
        key: threadDraftKey(account, threadId),
        kind: "thread",
        account,
        threadId,
        mode: snapshot.mode,
        body: snapshot.reply,
        toList: snapshot.toList,
        ccList: snapshot.ccList,
        showCc: snapshot.showCc,
        editRecipients: snapshot.editRecipients,
        includeSignature: snapshot.includeSignature,
        fromAccount: snapshot.fromAccount,
        replyFocus: snapshot.replyFocus,
        attachments: readyAttachmentsForDraft(snapshot.attachItems),
        quoteMessageId: snapshot.quoteMessageId,
        updatedAt: Date.now(),
      };
      void saveThreadDraft(draft, defaultTo, defaultCc, keepEmpty);
    },
    [account, threadId]
  );

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
  const focusReply = (caret: number | null = null) => {
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
  };

  const applyThreadChrome = React.useCallback(
    (detail: MailThreadDetail) => {
      // Don't wipe the composer — local drafts restore into it, and revalidation
      // must not clobber in-progress replies. Defaults are applied when Reply /
      // Forward is clicked (or when a draft is hydrated).
      if (
        focusMessageId &&
        detail.messages.some((m) => m.id === focusMessageId)
      ) {
        setHighlightMessageId(focusMessageId);
      } else {
        setHighlightMessageId(null);
      }
    },
    [focusMessageId]
  );

  // Hydrate local draft for this thread (if any), then enable saves.
  React.useEffect(() => {
    let cancelled = false;
    draftReadyRef.current = false;
    draftDiscardedRef.current = false;
    setLocalDraftAt(null);
    importedDraftRef.current = null;
    importedForThreadRef.current = null;
    // The floating card holds this thread's draft. Reading it here would
    // put a second composer on the same words; saving would write over
    // the card's edits. The pane waits — and when the reply comes home,
    // this effect runs again and picks the draft up.
    if (replyFloating) {
      draftDiscardedRef.current = true;
      return;
    }
    void getDraft(threadDraftKey(account, threadId)).then((raw) => {
      if (cancelled) return;
      if (raw?.kind === "thread") {
        setMode(raw.mode);
        setReply(raw.body);
        setToList(raw.toList);
        setCcList(raw.ccList);
        setShowCc(raw.showCc);
        setEditRecipients(raw.editRecipients);
        setIncludeSignature(raw.includeSignature);
        setFromAccount(raw.fromAccount);
        setReplyFocus(raw.replyFocus);
        setQuoteMessageId(raw.quoteMessageId ?? null);
        replaceAttachments(raw.attachments);
        setEditorKey((k) => k + 1);
        setShowPreview(false);
      }
      // -1 stands for "looked, found none" so null can keep meaning
      // "still looking" — the difference the whole import turns on.
      setLocalDraftAt(raw?.kind === "thread" ? (raw.updatedAt ?? 0) : -1);
      draftReadyRef.current = true;
    });
    return () => {
      cancelled = true;
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      // Flush latest keystrokes when switching threads.
      if (draftReadyRef.current && !draftDiscardedRef.current) {
        persistThreadDraft();
      }
    };
  }, [account, threadId, replaceAttachments, persistThreadDraft, replyFloating]);

  /**
   * A reply the reader started in Gmail or Outlook, opened in the composer.
   *
   * Ours wins when both exist: a local draft is what they were editing here,
   * and it was saved on a keystroke. This also runs once per thread, so
   * closing the composer does not reopen it on the next render.
   */
  React.useEffect(() => {
    const providerDraft = thread?.providerDraft;
    const go = shouldImportProviderDraft({
      hasProviderDraft: Boolean(providerDraft),
      localDraftFound,
      localDraftAt: localDraftAt != null && localDraftAt >= 0 ? localDraftAt : null,
      providerDraftAt: providerDraft?.updatedAt
        ? Date.parse(providerDraft.updatedAt)
        : null,
      importedForThread: importedForThreadRef.current,
      threadId,
      composerOpen: Boolean(mode),
    });
    if (!go || !providerDraft) return;
    importedForThreadRef.current = threadId;
    importedDraftRef.current = providerDraft.ref;
    setMode("reply");
    // Only what the reader wrote. The quoted thread under it comes off — this
    // composer adds its own quote when it sends.
    const htmlSplit = providerDraft.bodyHtml
      ? stripQuotedHtml(providerDraft.bodyHtml)
      : null;
    setReply(
      // Only trust the HTML when it actually had a quote block to cut. HTML
      // that is really flat text with ">" markers has no block to find, and
      // taking it whole is what put the entire conversation in the box.
      htmlSplit?.hadQuote
        ? htmlSplit.html
        : draftBodyForComposer(providerDraft)
    );
    setToList(recipientsFromEmails(providerDraft.to));
    setCcList(recipientsFromEmails(providerDraft.cc));
    setShowCc(providerDraft.cc.length > 0);
    setEditorKey((k) => k + 1);
    setShowPreview(false);
  }, [thread, threadId, mode, localDraftFound, localDraftAt]);

  // Debounced persist while the composer is open.
  React.useEffect(() => {
    if (!draftReadyRef.current || draftDiscardedRef.current || !mode) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      persistThreadDraft();
    }, 400);
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [
    mode,
    reply,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    attachItems,
    persistThreadDraft,
  ]);

  // Tracks list tip while this pane is open (also set on cache-fresh opens).
  const seenRefreshToken = React.useRef(refreshToken);

  React.useEffect(() => {
    let cancelled = false;
    setLoadingOlder(false);
    setLoadingNewer(false);
    setError(null);

    const entryCanPaint = (entry: {
      thread: MailThreadDetail;
    }) =>
      !focusMessageId ||
      entry.thread.messages.some((m) => m.id === focusMessageId);

    const paintEntry = (
      entry: NonNullable<ReturnType<typeof getCachedMailThread>>
    ): "fresh" | "stale" | "skip" => {
      if (!entryCanPaint(entry)) return "skip";
      setThread(entry.thread);
      applyThreadChrome(entry.thread);
      if (isMailThreadCacheFresh(entry, refreshToken, focusMessageId)) {
        seenRefreshToken.current = refreshToken;
        return "fresh";
      }
      return "stale";
    };

    const ram = getCachedMailThread(account, threadId);
    if (ram) {
      const status = paintEntry(ram);
      if (status === "fresh") {
        return () => {
          cancelled = true;
        };
      }
      if (status === "skip") {
        setThread(null);
        setHighlightMessageId(null);
      }
      // stale: keep showing cache while we revalidate below
    } else {
      setThread(null);
      setHighlightMessageId(null);
    }

    void (async () => {
      try {
        // Disk hydrate when RAM missed (or could not paint for focus).
        if (!ram || !entryCanPaint(ram)) {
          const disk = await loadCachedMailThread(account, threadId);
          if (cancelled) return;
          if (disk) {
            const status = paintEntry(disk);
            if (status === "fresh") return;
          }
        } else if (
          isMailThreadCacheFresh(ram, refreshToken, focusMessageId)
        ) {
          return;
        }

        const params = new URLSearchParams({ account, id: threadId });
        if (focusMessageId) params.set("around", focusMessageId);
        // Deep links open a window mid-thread, which still needs the id list.
        else if (messageCount) params.set("count", String(messageCount));
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        if (cancelled) return;
        setThread((current) => {
          if (current) {
            const currentLast = current.messages[current.messages.length - 1];
            const nextLast =
              json.thread.messages[json.thread.messages.length - 1];
            if (currentLast?.id === nextLast?.id) return current;
          }
          return json.thread;
        });
        setCachedMailThread(account, threadId, json.thread, refreshToken);
        applyThreadChrome(json.thread);
        seenRefreshToken.current = refreshToken;
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load thread");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // refreshToken read on open for freshness; live tip changes use the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, threadId, focusMessageId, applyThreadChrome]);

  // Keep the LRU in sync as the open pane grows (older pages, sends, merges).
  React.useEffect(() => {
    if (!thread) return;
    setCachedMailThread(account, threadId, thread, refreshToken);
  }, [account, threadId, thread, refreshToken]);

  React.useEffect(() => {
    setOlderParts([]);
  }, [threadId]);

  React.useEffect(() => {
    const chatId = thread?.chat?.chatId;
    if (!chatId) {
      setChatParts([]);
      return;
    }
    let cancelled = false;
    void apiJson<{ parts: MailChatPartSummary[] }>(
      `/api/mail/chat/parts?${new URLSearchParams({
        account,
        chatId,
      }).toString()}`
    )
      .then((json) => {
        if (!cancelled) setChatParts(json.parts);
      })
      .catch(() => {
        if (!cancelled) setChatParts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [account, thread?.chat?.chatId]);

  const loadOlderMessages = React.useCallback(async () => {
    if (loadingOlder || !thread) return;
    const head = olderParts[0];
    const headPartIndex = head?.partIndex ?? thread.chat?.partIndex ?? 1;
    const headThreadId = head?.threadId ?? threadId;
    const headMessages = head?.messages ?? thread.messages;
    const headHasOlder = head ? head.hasOlder : thread.hasOlder;
    const canCrossPart =
      Boolean(thread.chat) && !headHasOlder && headPartIndex > 1;
    if (!headHasOlder && !canCrossPart) return;
    if (headHasOlder && !headMessages.length) return;

    const scroller = scrollRef.current;
    const prevHeight = scroller?.scrollHeight ?? 0;
    const prevTop = scroller?.scrollTop ?? 0;
    setLoadingOlder(true);
    try {
      if (headHasOlder) {
        const oldestId = headMessages[0].id;
        const params = new URLSearchParams({
          account,
          id: headThreadId,
          before: oldestId,
        });
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        if (head) {
          setOlderParts((parts) => {
            if (!parts.length) return parts;
            const [first, ...rest] = parts;
            const seen = messageKeys(first.messages);
            const older = json.thread.messages.filter(
              (m) => !seen.has(messageKey(m))
            );
            if (!older.length) {
              return [{ ...first, hasOlder: false }, ...rest];
            }
            return [
              {
                ...first,
                messages: [...older, ...first.messages],
                hasOlder: json.thread.hasOlder,
              },
              ...rest,
            ];
          });
        } else {
          setThread((current) => {
            if (!current) return current;
            const seen = messageKeys(current.messages);
            const older = json.thread.messages.filter(
              (m) => !seen.has(messageKey(m))
            );
            if (!older.length) {
              return { ...current, hasOlder: false };
            }
            return {
              ...current,
              messages: [...older, ...current.messages],
              hasOlder: json.thread.hasOlder,
            };
          });
        }
      } else if (canCrossPart && thread.chat) {
        let partsList = chatParts;
        if (!partsList.length) {
          const listed = await apiJson<{ parts: MailChatPartSummary[] }>(
            `/api/mail/chat/parts?${new URLSearchParams({
              account,
              chatId: thread.chat.chatId,
            }).toString()}`
          );
          partsList = listed.parts;
          setChatParts(partsList);
        }
        const prev = partsList.find((p) => p.partIndex === headPartIndex - 1);
        if (!prev) return;
        const params = new URLSearchParams({
          account,
          id: prev.providerThreadId,
        });
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        setOlderParts((parts) => [
          {
            partIndex: prev.partIndex,
            threadId: prev.providerThreadId,
            subject: prev.subject,
            openedAt: prev.openedAt,
            messages: json.thread.messages,
            hasOlder: json.thread.hasOlder,
          },
          ...parts,
        ]);
      }
      // Keep the same messages under the viewport after prepending.
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = prevTop + (el.scrollHeight - prevHeight);
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't load earlier messages"
      );
    } finally {
      setLoadingOlder(false);
    }
  }, [
    account,
    loadingOlder,
    thread,
    threadId,
    olderParts,
    chatParts,
  ]);

  const loadNewerMessages = React.useCallback(async () => {
    if (!thread?.hasNewer || loadingNewer || !thread.messages.length) return;
    const newestId = thread.messages[thread.messages.length - 1].id;
    setLoadingNewer(true);
    try {
      const params = new URLSearchParams({
        account,
        id: threadId,
        after: newestId,
      });
      const json = await apiJson<{ thread: MailThreadDetail }>(
        `/api/mail/thread?${params.toString()}`
      );
      setThread((current) => {
        if (!current) return current;
        const seen = messageKeys(current.messages);
        const newer = json.thread.messages.filter(
          (m) => !seen.has(messageKey(m))
        );
        if (!newer.length) {
          return { ...current, hasNewer: false };
        }
        return {
          ...current,
          messages: [...current.messages, ...newer],
          hasNewer: json.thread.hasNewer,
        };
      });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't load newer messages"
      );
    } finally {
      setLoadingNewer(false);
    }
  }, [account, loadingNewer, thread, threadId]);

  // Avoid fetching older/newer pages while the open-thread pin is still settling.
  const canAutoloadPagesRef = React.useRef(false);
  React.useEffect(() => {
    canAutoloadPagesRef.current = false;
    const t = window.setTimeout(() => {
      canAutoloadPagesRef.current = true;
    }, 700);
    return () => window.clearTimeout(t);
  }, [threadId]);

  const headOlder = olderParts[0];
  const headHasOlderInPart = headOlder
    ? headOlder.hasOlder
    : Boolean(thread?.hasOlder);
  const headPartIndexForScroll =
    headOlder?.partIndex ?? thread?.chat?.partIndex ?? 1;
  const canLoadOlderAcrossParts =
    Boolean(thread?.chat) &&
    !headHasOlderInPart &&
    headPartIndexForScroll > 1;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (
      !el ||
      (!headHasOlderInPart &&
        !canLoadOlderAcrossParts &&
        !thread?.hasNewer)
    ) {
      return;
    }
    const onScroll = () => {
      if (!canAutoloadPagesRef.current) return;
      if (
        (headHasOlderInPart || canLoadOlderAcrossParts) &&
        el.scrollTop < 80
      ) {
        void loadOlderMessages();
      }
      if (
        thread?.hasNewer &&
        el.scrollHeight - el.scrollTop - el.clientHeight < 120
      ) {
        void loadNewerMessages();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [
    loadOlderMessages,
    loadNewerMessages,
    headHasOlderInPart,
    canLoadOlderAcrossParts,
    thread?.hasNewer,
  ]);

  /**
   * Scrolled up, with the newest message somewhere below.
   *
   * A long thread is read from the bottom, and reading back through it
   * leaves no way down but the same scrolling again. This is the button
   * every chat window has in that corner.
   *
   * "Near enough" rather than exactly at the end: a thread pinned to its
   * last message still sits a pixel or two off it after a resize, and a
   * button that appears for that is a button that flickers.
   */
  /**
   * Where the reader is in the thread, for zoom to hold on to.
   *
   * Zooming scales the whole stream, so a scroll position measured in
   * pixels means somewhere else afterwards — the further down a long
   * thread, the further it threw them.
   *
   * Two ways of remembering the place, and which one is used is decided
   * by measurement rather than by belief. See `rectsMoveWithScroll`.
   */
  type ZoomAnchor =
    /** A message, how far down it the held line cuts, and where that line is. */
    | { kind: "message"; id: string; into: number; line: number }
    /**
     * How far down the content the held line sits, how tall the content was,
     * and how far the line is below the top of the pane.
     */
    | { kind: "fraction"; top: number; content: number; hold: number };
  const zoomAnchorRef = React.useRef<ZoomAnchor | null>(null);

  /** The scroller's own padding, which does not scale with the stream. */
  const scrollerPadding = (el: HTMLElement) => {
    const style = window.getComputedStyle(el);
    return {
      top: Number.parseFloat(style.paddingTop) || 0,
      bottom: Number.parseFloat(style.paddingBottom) || 0,
    };
  };

  /**
   * Can a message's rectangle be compared with the scroller's numbers?
   *
   * The messages sit inside the zoomed element and the scroller sits
   * outside it, and whether a rectangle measured in there comes back in
   * the same pixels as `scrollTop` is up to the engine. Twice now this
   * has been assumed and twice it has been wrong, so it is measured:
   * while the reader scrolls, a message's rectangle has to move by
   * exactly what `scrollTop` moved by. Anything else and the two are in
   * different units and must not be mixed.
   *
   * Null until a scroll has been long enough to tell. Until then, and
   * whenever the answer is no, the fraction below is used instead: it
   * reads nothing but the scroller, so it cannot be caught out this way.
   */
  const rectsMoveWithScroll = React.useRef<boolean | null>(null);
  const rectProbeRef = React.useRef<{
    id: string;
    top: number;
    scrollTop: number;
  } | null>(null);
  const probeRectSpace = (el: HTMLElement) => {
    const node = el.querySelector<HTMLElement>("[data-message-id]");
    const id = node?.dataset.messageId;
    if (!node || !id) return;
    const top = node.getBoundingClientRect().top;
    const previous = rectProbeRef.current;
    // The reading to compare against is kept until it has been used, not
    // replaced on every scroll event. A trackpad delivers a dozen events
    // for one flick of a finger, so replacing it each time left every
    // comparison a few pixels wide — never enough to answer anything,
    // and the exact anchoring below therefore never once ran.
    if (!previous || previous.id !== id) {
      rectProbeRef.current = { id, top, scrollTop: el.scrollTop };
      return;
    }
    const scrolled = el.scrollTop - previous.scrollTop;
    // Far enough that rounding cannot account for the answer.
    if (Math.abs(scrolled) < 40) return;
    const moved = -(top - previous.top) / scrolled;
    rectsMoveWithScroll.current = Math.abs(moved - 1) < 0.05;
    rectProbeRef.current = { id, top, scrollTop: el.scrollTop };
  };

  /**
   * Take a reading, for zoom to put back.
   *
   * `atY` is a line across the window — the pointer, when a pinch says
   * where it is. Zooming then holds whatever sits on that line, so the
   * words under the fingers stay under the fingers. Without one the line
   * is the top edge of the pane, which is where the eye is when the
   * reader uses the buttons or the keys instead.
   */
  const captureZoomAnchor = React.useCallback((atY?: number | null) => {
    const el = scrollRef.current;
    if (!el) return;
    const paneTop = el.getBoundingClientRect().top;
    // A pinch that starts outside the pane still zooms it, and a line
    // above or below the pane has nothing on it to hold.
    const line =
      typeof atY === "number" && Number.isFinite(atY)
        ? Math.min(Math.max(atY, paneTop), paneTop + el.clientHeight)
        : paneTop;
    if (rectsMoveWithScroll.current) {
      // The message the line cuts, and how far down it the line falls.
      // This is the least forgiving place to be wrong, which makes it
      // the right one to be exact about.
      const nodes = el.querySelectorAll<HTMLElement>("[data-message-id]");
      for (const node of Array.from(nodes)) {
        const box = node.getBoundingClientRect();
        // The first message still on screen: the one the line cuts, or
        // the next one down when the line falls in the gap above it.
        if (box.bottom < line) continue;
        const id = node.dataset.messageId;
        if (!id) break;
        zoomAnchorRef.current = {
          kind: "message",
          id,
          into: box.height ? (line - box.top) / box.height : 0,
          line,
        };
        return;
      }
    }
    // Every number off the scroller, which is outside the zoom. Close
    // rather than exact — text rewraps, so the same fraction of the
    // stream is a slightly different place — but it cannot be wrong
    // about which units it is in.
    const pad = scrollerPadding(el);
    const content = el.scrollHeight - pad.top - pad.bottom;
    if (content <= 0) return;
    const hold = line - paneTop;
    zoomAnchorRef.current = {
      kind: "fraction",
      top: el.scrollTop - pad.top + hold,
      content,
      hold,
    };
  }, []);
  takeZoomAnchorRef.current = captureZoomAnchor;

  /**
   * Put that place back under the middle at the new size.
   *
   * A layout effect, so the correction lands in the same frame the new
   * size does and there is nothing to see.
   */
  const lastZoomRef = React.useRef(zoom);
  React.useLayoutEffect(() => {
    const previous = lastZoomRef.current;
    lastZoomRef.current = zoom;
    if (previous === zoom) return;
    const el = scrollRef.current;
    const anchor = zoomAnchorRef.current;
    if (!el || !anchor) return;
    // The probe compares one reading with the one before it and reads
    // the difference as scrolling. A size change between the two moves
    // the rectangle for a second reason, so the reading before this one
    // is no longer something to compare against.
    rectProbeRef.current = null;

    if (anchor.kind === "message") {
      const selector = `[data-message-id="${anchor.id
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')}"]`;
      const node = el.querySelector<HTMLElement>(selector);
      if (node) {
        const box = node.getBoundingClientRect();
        el.scrollTop += box.top + box.height * anchor.into - anchor.line;
        // The same line, for the next step of a pinch: a gesture holds
        // one place from beginning to end, not a place per step.
        captureZoomAnchor(anchor.line);
        return;
      }
      // The message went while the size changed. Nothing to hold on to.
      return;
    }

    if (anchor.content <= 0) return;
    const pad = scrollerPadding(el);
    const content = el.scrollHeight - pad.top - pad.bottom;
    if (content <= 0) return;
    // The scale is measured rather than worked out from the zoom values:
    // text rewraps, so the stream does not grow by exactly the ratio
    // between them, and what it actually grew by is there to be read.
    el.scrollTop =
      (anchor.top * content) / anchor.content + pad.top - anchor.hold;
    captureZoomAnchor(el.getBoundingClientRect().top + anchor.hold);
  }, [zoom, captureZoomAnchor]);

  const [awayFromLatest, setAwayFromLatest] = React.useState(false);
  React.useEffect(() => {
    const el = streamNode;
    if (!el) return;
    const check = () => {
      setAwayFromLatest(
        el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_LATEST_PX
      );
      // Scrolling is the only chance to find out what a rectangle
      // measured inside the zoom is worth, so it is taken every time.
      probeRectSpace(el);
      // The same moments tell zoom what to hold on to: wherever the
      // reader has come to rest is what zooming should keep in front of
      // them. Reading it now costs nothing and saves reading it later,
      // when the new size has already been applied and the old view is
      // gone.
      captureZoomAnchor();
    };
    check();
    /*
      Not while a pane is sliding, from either direction.

      The stream re-wraps on every frame of a slide, which both resizes it
      and moves the scroll under it — so this ran twice a frame, each time
      changing state and rendering this pane, over a movement whose whole
      job is to move one edge. One reading at the end says the same thing,
      and the reader is not scrolling during it anyway.
    */
    const guarded = () => {
      if (afterMailPaneSlide(check)) return;
      check();
    };
    el.addEventListener("scroll", guarded, { passive: true });
    // Messages arriving make the stream taller under a reader who has not
    // moved, which is the other way this becomes true.
    const observer = new ResizeObserver(guarded);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => {
      el.removeEventListener("scroll", guarded);
      observer.disconnect();
    };
    // streamNode: the element itself, so this runs the moment there is
    // one to listen to rather than once before there is.
  }, [streamNode, captureZoomAnchor]);

  /*
    The reply box pushes the thread up rather than covering its tail.

    The composer stands in the flow below the stream, so opening it makes
    the stream shorter — but the scroll held its number, and what the
    number now showed ended higher, so the end of the last message went
    under the box just as the reader turned to answer it. When the
    stream's own height changes, the scroll moves by the same amount: the
    bottom edge of what was being read stays put above whatever took the
    room, and gets the room back when it goes. Clamped at both ends by
    the scroller itself.
  */
  const streamHeightRef = React.useRef(-1);
  const keepStreamBottom = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const previous = streamHeightRef.current;
    const now = el.clientHeight;
    if (now === previous) return;
    streamHeightRef.current = now;
    if (previous < 0) return;
    el.scrollTop = Math.max(0, el.scrollTop + (previous - now));
  }, []);
  /*
    Two listeners, one ledger. The layout effect answers the app's own
    changes — the composer mounting, leaving, being dragged taller — in
    the same commit, before anything paints. The observer answers what
    commits never see, a window edge being dragged. Both settle against
    the same remembered height, so whichever heard first, the other
    finds nothing left to move.
  */
  React.useLayoutEffect(keepStreamBottom);
  React.useEffect(() => {
    const el = streamNode;
    if (!el) return;
    const observer = new ResizeObserver(keepStreamBottom);
    observer.observe(el);
    return () => observer.disconnect();
  }, [streamNode, keepStreamBottom]);

  /**
   * The newest window as it was, so coming back to it costs nothing.
   *
   * A thread is opened at its newest page, so by the time anybody can ask
   * to go back there, that page has been fetched already. Going to the
   * start replaces the window with the oldest page, and this is what was
   * put down. Kept per thread; the next thread opens its own.
   */
  const latestWindowRef = React.useRef<MailThreadDetail | null>(null);
  React.useEffect(() => {
    latestWindowRef.current = null;
  }, [threadId]);
  React.useEffect(() => {
    // A window with nothing newer beyond it is the newest window.
    if (thread && !thread.hasNewer) latestWindowRef.current = thread;
  }, [thread]);

  /**
   * Back to the newest message in the thread, not the newest one loaded.
   *
   * Scrolling to the bottom of the window is only the end of the thread
   * when the window reaches it. Read back to the start of a long thread
   * and the bottom of what is on screen is the middle of the conversation
   * — which is where this used to stop.
   *
   * A jump, not a walk, and the mirror of `goToFirstMessage`: the window
   * is replaced with the newest page outright. Paging forward through
   * everything in between would fetch the whole thread to reach a message
   * that has already been fetched once.
   */
  const goToLatestMessage = React.useCallback(async () => {
    const toEnd = (smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    };
    // The window already reaches the end. Only the scroll is between the
    // reader and the newest message.
    if (!thread?.hasNewer) {
      toEnd(true);
      return;
    }

    // The pin that opens a thread at its bottom wakes when the newest
    // message changes, which replacing the window does. Claimed before
    // the change, as the jump to the start claims it.
    skipOpenPinRef.current = true;
    const cached = latestWindowRef.current;
    if (cached) {
      setOlderParts([]);
      setThread(cached);
    } else {
      // Nothing put down to go back to — the pane was opened on a search
      // hit in the middle of the thread and has never been at the end.
      // One request for the newest page, the same one opening it makes.
      setLoadingNewer(true);
      try {
        const params = new URLSearchParams({ account, id: threadId });
        if (messageCount) params.set("count", String(messageCount));
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        setOlderParts([]);
        setThread(json.thread);
      } catch (err) {
        skipOpenPinRef.current = false;
        toast.error(
          err instanceof Error ? err.message : "Couldn't open the latest"
        );
        return;
      } finally {
        setLoadingNewer(false);
      }
    }

    // The new page has to be laid out before there is a bottom to go to.
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      const el = scrollRef.current;
      if (!el) continue;
      const wasAtEnd =
        el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_LATEST_PX;
      toEnd(false);
      // Settled: the last two goes landed in the same place, so the page
      // has stopped growing under it.
      if (wasAtEnd) return;
    }
  }, [account, messageCount, thread, threadId]);

  // A list refresh showing this thread gained mail refetches the newest page
  // and merges it — older prepended history is kept. Skip while mid-thread
  // (search deep-link) so we don't create a gap to the tip.
  React.useEffect(() => {
    if (!refreshToken || seenRefreshToken.current === refreshToken) return;
    seenRefreshToken.current = refreshToken;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ account, id: threadId });
        if (messageCount) params.set("count", String(messageCount));
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        if (cancelled) return;
        setThread((current) => {
          if (!current) return json.thread;
          if (current.hasNewer) return current;
          const currentLast = current.messages[current.messages.length - 1];
          const nextLast = json.thread.messages[json.thread.messages.length - 1];
          if (currentLast?.id === nextLast?.id) return current;
          return mergeNewestThreadPage(current, json.thread);
        });
      } catch {
        // Background refresh is best-effort; the pane keeps what it has.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshToken, account, threadId, messageCount]);

  const newestMessageId =
    thread?.messages[thread.messages.length - 1]?.id ?? null;
  /**
   * Set when the reader asked to go somewhere specific in this thread.
   *
   * Replacing the window changes the newest message, which is what wakes
   * the open-at-the-bottom pin below. Without this it would drag the view
   * back down — twice, because its observer re-pins as the new page lays
   * out. Cleared when the thread changes, which is the next time opening
   * at the bottom is the right thing to do.
   */
  const skipOpenPinRef = React.useRef(false);
  const scrolledToFocusRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    scrolledToFocusRef.current = null;
  }, [threadId, focusMessageId]);

  /**
   * A search hit that is not the newest message: land on it.
   *
   * Only then. The newest message is where a thread opens anyway (below),
   * and a hit the loaded window does not hold has nowhere to land, so both
   * fall through to that rule rather than leaving the pane where it started
   * — which was the top, and read as the thread opening on its oldest
   * message.
   */
  const deepLinkTarget =
    focusMessageId &&
    focusMessageId !== newestMessageId &&
    thread?.messages.some((m) => m.id === focusMessageId)
      ? focusMessageId
      : null;

  React.useEffect(() => {
    // Search deep-link: pin the hit in view (once), then stop.
    const el = scrollRef.current;
    if (!thread || !el || !deepLinkTarget) return;
    if (scrolledToFocusRef.current === deepLinkTarget) return;

    const pin = () => {
      const target = el.querySelector<HTMLElement>(
        `[data-message-id="${deepLinkTarget.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`
      );
      if (!target) return false;
      const paneTop = el.getBoundingClientRect().top;
      const targetTop = target.getBoundingClientRect().top;
      el.scrollTop = Math.max(
        0,
        el.scrollTop + (targetTop - paneTop) - el.clientHeight * 0.25
      );
      scrolledToFocusRef.current = deepLinkTarget;
      return true;
    };
    if (pin()) return;

    const observer = new ResizeObserver(() => {
      if (pin()) observer.disconnect();
    });
    observer.observe(el.firstElementChild ?? el);
    const timer = setTimeout(() => observer.disconnect(), 2000);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [thread, deepLinkTarget]);

  React.useEffect(() => {
    if (!highlightMessageId) return;
    const t = window.setTimeout(() => setHighlightMessageId(null), 2200);
    return () => window.clearTimeout(t);
  }, [highlightMessageId]);

  /**
   * Where a thread opens.
   *
   * One message: the very top. There is nothing above it to hint at.
   *
   * More than one: twenty pixels above the head of the newest message. Not
   * the bottom — the bottom of a long message is its tail, and a reader put
   * there has to scroll up to find out what the message says and then come
   * back down. The top of the newest message is where reading it starts,
   * and the twenty pixels show the tail of the one before, which is the
   * sign, without scrolling, that the conversation goes on above the fold.
   * A short newest message near the end works out the same — the scroll
   * clamps and the pane sits at the bottom.
   *
   * Skipped only when a search hit older than the newest message is being
   * landed on, which has its own place to be. A hit that is the newest
   * message, or one the loaded window does not hold, opens by this rule.
   */
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!thread || !el || !newestMessageId || deepLinkTarget) return;
    if (skipOpenPinRef.current) return;

    /*
      The pin follows the stream while it settles: pictures and email
      frames arrive over the first second or two and make it taller under
      a reader who has not moved yet, and the newest message has to stay
      where it was put.

      Two things end it, and both used to be missed.

      A resize the reader asked for is not the thread settling. Changing
      the text size resizes the whole stream, and this read that as more
      mail arriving and put them back at the newest message — which on a
      one-message thread is `scrollTop = 0`, the very top. Zoom holds its
      own place; this must not take it back.

      And the reader moving ends it however they move. `wheel` alone
      missed the keyboard, the scrollbar, and a trackpad that reports
      scrolling any other way.
    */
    const zoomAtOpen = zoomRef.current;
    let placed = -1;

    const pin = () => {
      if (zoomRef.current !== zoomAtOpen) {
        stop();
        return;
      }
      const bubbles = el.querySelectorAll<HTMLElement>(
        '[data-mail-bubble="1"]'
      );
      const newest = bubbles[bubbles.length - 1];
      if (!newest) {
        /*
          No bubbles yet — the stream is still putting them up. Guessing
          meant jumping to the bottom of everything: the guess was made
          against a stream tens of thousands of pixels tall that had not
          measured itself, the clamp as it shrank read as the reader
          moving, and the follower stopped before it ever saw a bubble —
          which is how a long thread opened at the very end of its last
          message. The observer calls again when there is something to
          stand on.
        */
        return;
      }
      if (bubbles.length === 1) {
        el.scrollTop = 0;
      } else {
        const paneTop = el.getBoundingClientRect().top;
        const bubbleTop = newest.getBoundingClientRect().top;
        const air = 20;
        el.scrollTop = Math.max(0, el.scrollTop + (bubbleTop - paneTop) - air);
      }
      placed = Math.round(el.scrollTop);
    };

    const onScroll = () => {
      // Before anything was placed, any movement is the reader's.
      if (placed < 0) {
        stop();
        return;
      }
      // Where the pin last put them is not the reader moving — and nor is
      // the browser clamping that place down because the settling stream
      // got shorter under it.
      const clampedPlace = Math.min(
        placed,
        Math.max(0, el.scrollHeight - el.clientHeight)
      );
      if (Math.round(el.scrollTop) !== clampedPlace) stop();
    };
    const stop = () => {
      window.clearInterval(interval);
      el.removeEventListener("scroll", onScroll);
    };
    /*
      A short heartbeat, not a ResizeObserver. The observer watched the
      stream's first child, and React replaces that element while the
      messages measure themselves in — a detached node reports nothing,
      so the pin ran once against the unmeasured stream and never again.
      The heartbeat asks the live document each time, and two seconds of
      it at this pace costs a handful of rect reads.
    */
    const interval = window.setInterval(pin, 150);

    pin();
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("touchstart", stop, { passive: true, once: true });
    const timer = setTimeout(stop, 2000);

    return () => {
      clearTimeout(timer);
      stop();
      el.removeEventListener("touchstart", stop);
    };
  }, [threadId, newestMessageId, deepLinkTarget]);

  /**
   * How much room the reply actions have, measured rather than guessed.
   *
   * The pane is resizable and sits beside two other resizable things, so
   * nothing about the window says how wide this row is.
   */
  const [paneWidth, setPaneWidth] = React.useState(0);
  /**
   * Measured through the ref itself, not from an effect.
   *
   * This pane returns early while a thread is loading, so on the render an
   * effect would have run against there was no element to observe — and an
   * effect that runs once, finds nothing and never looks again leaves the
   * width at nought for the life of the pane. Everything that asks how wide
   * it is then gets the same answer: wide enough. Which is why none of this
   * appeared to work at any size.
   *
   * A callback ref is told each time the node arrives or goes, which is
   * exactly when there is something to measure or stop measuring.
   */
  /*
    The floating card is carried by its heading, the same way the CRM
    proposals are: both are read against what they cover, and both are
    in the way of it until they are moved.
  */
  const {
    cardRef,
    startDrag,
    cardStyle,
    size: cardSize,
    startResize: startCardResize,
  } = useCardDrag(Boolean(floating), "dh-mail-floating-reply-size");
  /**
   * The card has a height the reader gave it, so the reply fills the card:
   * the same layout as focus mode, where the reply fills the pane. Without
   * this the band keeps its own ceiling and the card grows empty.
   */
  const bandFills = replyFocus || (Boolean(floating) && Boolean(cardSize.height));

  const paneObserverRef = React.useRef<ResizeObserver | null>(null);
  const setPaneNode = React.useCallback((node: HTMLDivElement | null) => {
    pinchRef.current = node;
    // What the carry moves, when this pane is the floating card. Harmless
    // when it is not: the carry is switched off, and nothing reads this.
    cardRef.current = node;
    paneObserverRef.current?.disconnect();
    paneObserverRef.current = null;
    if (!node) return;
    const measurePane = () => {
      const box = cardRef.current?.getBoundingClientRect();
      if (box) setPaneWidth(box.width);
    };
    // A width on its way somewhere is not worth a render — see pane-slide.
    const observer = new ResizeObserver(() => {
      if (afterMailPaneSlide(measurePane)) return;
      measurePane();
    });
    observer.observe(node);
    paneObserverRef.current = observer;
    // The first answer now, rather than a frame later.
    setPaneWidth(node.getBoundingClientRect().width);
  }, []);
  const compactThreadActions =
    paneWidth > 0 && paneWidth < THREAD_ACTIONS_MIN_WIDTH;
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
  /**
   * The reply box takes the whole pane, edge to edge.
   *
   * At its ordinary width the composer is a card: inset from the pane and
   * narrower than it, so a reply looks like the message it will become.
   * Below this width there is no room to be a card in — the inset and the
   * percentage together were leaving a box a few words wide, with its
   * toolbar wrapped into four rows underneath.
   */
  const compactComposer = paneWidth > 0 && paneWidth < COMPOSER_MIN_WIDTH;
  /** Narrow enough that the composer should take the pane, gutter and all. */
  const fullWidthComposer =
    paneWidth > 0 && paneWidth < COMPOSER_FULL_WIDTH;

  // Parsed once per change of the reply, not once per render: the pane
  // renders on every keystroke, and this parses HTML.
  const replyText = React.useMemo(() => htmlToPlainText(reply), [reply]);

  /**
   * Hand the reply to the floating card.
   *
   * The draft is written now — through the per-key queue, so the card's
   * first read lands after it — and the composer closes without deleting
   * it, which is the whole difference from closing: the words survive the
   * handover, and opening this thread again picks the same draft up.
   */
  const floatReply = React.useCallback(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    // Kept even when it says nothing yet: the card opens from this draft,
    // and an empty composer must arrive there as a composer.
    persistThreadDraft(undefined, true);
    // No saves after the handover: the card owns the draft now, and a
    // stale timer here must not write yesterday's words over its edits.
    draftDiscardedRef.current = true;
    setMode(null);
    setReplyFocus(false);
    setReply("");
    setEditorKey((k) => k + 1);
    setShowPreview(false);
    setEditRecipients(false);
    setShowCc(false);
    setConfirmDiscard(false);
    clearAttachments();
    onFloatReply?.();
  }, [persistThreadDraft, clearAttachments, onFloatReply]);

  /** Held in a ref: `closeComposer` is defined just below this. */
  const closeComposerRef = React.useRef<(() => void) | null>(null);

  const closeComposer = React.useCallback(() => {
    draftDiscardedRef.current = true;
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    void deleteDraft(threadDraftKey(account, threadId));
    setMode(null);
    setReplyFocus(false);
    setToList(recipientsFromEmails(thread?.reply.to ?? []));
    setCcList(recipientsFromEmails(thread?.reply.cc ?? []));
    setReply("");
    setEditorKey((k) => k + 1);
    setShowPreview(false);
    setEditRecipients(false);
    setShowCc(false);
    setUpdateCrmNotes(false);
    // Along with everything else the closed composer leaves behind. A
    // question about a reply that has gone would otherwise be waiting,
    // still true, over the next reply written here.
    setConfirmDiscard(false);
    // A subject belongs to the message it was typed over. Left standing, it
    // would sit on the next reply written in this pane — under the name of
    // a conversation that has gone.
    setSubjectDraft("");
    setSubjectOpen(false);
    setForwardWhole(false);
    setForwardConversation(null);
    preWholeAttachIdsRef.current = new Set();
    clearAttachments();
  }, [thread, clearAttachments, account, threadId]);
  closeComposerRef.current = closeComposer;

  /**
   * Throw the reply away, here and at the provider.
   *
   * The provider's copy is not deleted yet. A Gmail draft cannot be
   * un-deleted, so Undo has to mean the request was never sent — it is held
   * for the length of the toast, outside this component, because this
   * component is gone the moment the composer closes.
   *
   * Everything needed to put the composer back is taken before it is cleared.
   * Undo restores it and takes the request back; letting the toast run out
   * sends it.
   */
  const discardComposer = React.useCallback(() => {
    /*
      Once for one draft.

      Two controls reach this — the bin in the composer and the bin in the
      toolbar above it — and the question the second one asks can be
      answered by a key as well as by its button. Whichever gets here
      first, the draft is gone; a second run would delete nothing and say
      "Draft discarded" over again.
    */
    if (discardedKeyRef.current === threadDraftKey(account, threadId)) return;
    discardedKeyRef.current = threadDraftKey(account, threadId);
    const snapshot = composerSnapshotRef.current;
    /**
     * The draft at the provider, if this thread has one.
     *
     * Not only the one this mount imported. A draft imported from Gmail
     * saves a copy here, and once that copy exists the composer opens from
     * it instead — so a discard after any remount deleted our copy and left
     * the provider's, which the next poll imported again, which saved a new
     * copy, which put the Draft badge back on a thread the reader had just
     * cleared. Discarding a reply means the reply is gone, on both sides.
     */
    const providerRef =
      importedDraftRef.current ?? thread?.providerDraft?.ref ?? null;
    const restoreAttachments = readyAttachmentsForDraft(snapshot.attachItems);
    const hadSomething =
      Boolean(htmlToPlainText(snapshot.reply).trim()) ||
      restoreAttachments.length > 0;
    const key = threadDraftKey(account, threadId);

    closeComposer();
    /**
     * And this thread's provider draft has now been dealt with.
     *
     * The loaded thread still carries it until the next fetch, and the
     * import runs off what is loaded — so without this the discard was
     * followed straight away by the same draft opening again, from a copy
     * that no longer exists anywhere.
     */
    importedForThreadRef.current = threadId;

    if (providerRef) {
      schedulePendingDiscard(key, () => {
        void apiJson("/api/mail/drafts/discard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, ref: providerRef, threadId }),
        }).catch((err) => {
          console.warn("[mail] could not discard the provider's draft:", err);
        });
      });
    }

    // Whoever opened this pane to look at the draft has nothing to look
    // at now. Said before the early return below: a draft with nothing in
    // it is still a draft that has gone from the list.
    onDraftDiscarded?.();

    // An empty composer being closed is not a discard worth offering back.
    if (!hadSomething && !providerRef) return;

    toast(mailSay("draftDiscarded"), {
      duration: DISCARD_UNDO_MS,
      action: {
        label: "Undo",
        onClick: () => {
          cancelPendingDiscard(key);
          discardedKeyRef.current = null;
          draftDiscardedRef.current = false;
          importedDraftRef.current = providerRef;
          setMode(snapshot.mode);
          setReply(snapshot.reply);
          setToList(snapshot.toList);
          setCcList(snapshot.ccList);
          setShowCc(snapshot.showCc);
          setEditRecipients(snapshot.editRecipients);
          setIncludeSignature(snapshot.includeSignature);
          setFromAccount(snapshot.fromAccount);
          setReplyFocus(snapshot.replyFocus);
          replaceAttachments(restoreAttachments);
          setEditorKey((k) => k + 1);
          setShowPreview(false);
        },
      },
    });
  }, [
    account,
    threadId,
    closeComposer,
    replaceAttachments,
    thread?.providerDraft?.ref,
    onDraftDiscarded,
  ]);

  /**
   * Ask before throwing away something that was written — on Escape only.
   *
   * The bin does it on the spot. Nothing else on the card throws the reply
   * away, so reaching for it is already the whole of the decision, and a
   * question after it only asks whether you meant the thing you just took
   * aim at.
   *
   * Escape is the other case. It is pressed to get out of a menu, a field,
   * a mode — and if none of those is open it lands here, on the message
   * instead. That one is worth asking about.
   */
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  /** A send held back because the words promise a file and none is on it. */
  const [forgottenAttachment, setForgottenAttachment] = React.useState<{
    sendAt?: string;
    extras?: { proposeCrm?: boolean };
  } | null>(null);
  const composerHasWords =
    Boolean(replyText.trim()) || attachItems.length > 0;

  const requestDiscard = React.useCallback(() => {
    if (!composerHasWords) {
      discardComposer();
      return;
    }
    setConfirmDiscard(true);
  }, [composerHasWords, discardComposer]);

  /**
   * Escape closes the composer.
   *
   * It asks first when there is something written — see above for why this
   * one asks and the bin does not. A second Escape then answers the
   * asking, which is what Escape means the rest of the time.
   *
   * While the asking stands, Enter answers it the other way. The button is
   * focused and would take Enter by itself; this is for the rest of the
   * dialog, where a click on the words leaves focus on nothing a key can
   * reach. `preventDefault` is what keeps the two from both firing.
   */
  React.useEffect(() => {
    if (!mode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter") {
        if (!confirmDiscard) return;
        event.preventDefault();
        setConfirmDiscard(false);
        discardComposer();
        return;
      }
      if (event.key !== "Escape") return;
      if (confirmDiscard) {
        event.preventDefault();
        setConfirmDiscard(false);
        return;
      }
      event.preventDefault();
      requestDiscard();
    };
    if (floating) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, confirmDiscard, requestDiscard, discardComposer, floating]);

  /**
   * Is there a pop-out for this thread? Ask the shell, every time.
   *
   * Asked rather than remembered: the pop-out can be closed from its own
   * title bar or by Escape in it, and neither says anything to this window.
   * The shell answers from the live window list, so it cannot go stale.
   * Outside the desktop app the answer is always no, and the composer
   * behaves as it always did.
   */
  const popoutKeyRef = React.useRef("");
  popoutKeyRef.current = `${account}|${threadId}`;

  const refreshPopoutOpen = React.useCallback(async () => {
    const key = `${account}|${threadId}`;
    const open = await isChatPopoutOpen({ account, threadId });
    // The reader may have moved to another thread while this was in flight.
    if (popoutKeyRef.current === key) setPopoutOpen(open);
    return open;
  }, [account, threadId]);

  /**
   * Ask on arrival, and again whenever this window comes to the front.
   *
   * Focus is the signal: closing the pop-out hands focus back here, which
   * is also how a draft written in it finds its way home.
   */
  React.useEffect(() => {
    // Another thread's answer is not this one's.
    setPopoutOpen(false);
    void refreshPopoutOpen();
    const onFocus = () => void refreshPopoutOpen();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshPopoutOpen]);

  /**
   * The pop-out is where this thread is answered while it is open.
   *
   * So everything that would otherwise open the reply box brings that
   * window forward instead. A second box behind the strip is a box nobody
   * can see, and the key or the button that opened it would look broken.
   *
   * @returns true when the pop-out took the job.
   */
  const answerInPopout = React.useCallback(() => {
    if (!popoutOpen) return false;
    void focusChatPopout({ account, threadId });
    return true;
  }, [popoutOpen, account, threadId]);

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
    draftDiscardedRef.current = false;
    setMode(next);
    setToList(
      recipientsFromEmails(
        all ? (thread?.reply.allTo ?? []) : (thread?.reply.to ?? [])
      )
    );
    setCcList(
      recipientsFromEmails(
        all ? (thread?.reply.allCc ?? []) : (thread?.reply.cc ?? [])
      )
    );
    setEditRecipients(false);
    setIncludeSignature(signsReply());
    setUpdateCrmNotes(false);
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
  /**
   * Held in a ref: bringing the window back is defined further down, and
   * the key that opens the window is bound up here.
   */
  const bringBackRef = React.useRef<(() => void) | null>(null);

  const popOutThread = React.useCallback(() => {
    if (!thread) return;
    /*
      The same key both ways.

      A key that shows a window should put it away again — otherwise it is
      one key to remember and another to guess at. Closing goes through the
      hand-back, so whatever was written over there comes home rather than
      being shut in a window that has gone.
    */
    if (popoutOpen) {
      bringBackRef.current?.();
      return;
    }
    const counterpart = thread.messages.find((m) => !m.own && m.fromEmail);
    const email = counterpart?.fromEmail ?? thread.reply.to[0] ?? "";
    // What is being written travels with the conversation, formatting and
    // all: both boxes hold rich text now, so bold stays bold across the
    // move. It used to go as words only, because the pop-out's box was a
    // plain one.
    //
    // A reply travels. A forward does not: it goes to somebody the pop-out
    // has no picker to name, so it stays in the box that can send it.
    const answering = mode === "reply" || mode === "replyAll";
    // Whether anything has been written is still a question about words:
    // an empty editor is not an empty string, it is an empty paragraph.
    const carried = answering && replyText.trim() ? reply : "";
    // Where in it the writing had got to. Read before the composer closes,
    // because a box that has gone has no caret to ask about.
    const carriedCaret = carried ? replyEditorHandle.current?.getCaret() : null;
    void openMailChatPopout({
      account,
      threadId,
      name: counterpart?.fromName || email,
      email,
      subject: thread.subject,
      seedThread: thread,
      seedDraft: carried || undefined,
      seedCaret: carriedCaret,
    })
      .then(() => {
        // Handed over, not copied. The same words waiting in two boxes is an
        // invitation to send them twice, and Bring back returns them here.
        //
        // An empty box goes with them: the strip stands where it was, and a
        // box behind a strip that says the answer is elsewhere is the very
        // confusion the strip is there to end. A box holding files stays —
        // they were picked here, and the pop-out cannot take them. So does a
        // forward, which was never going to the pop-out in the first place.
        if (answering && (carried || !composerHasWords)) closeComposer();
        void refreshPopoutOpen();
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Couldn't pop out")
      );
  }, [
    thread,
    account,
    threadId,
    reply,
    mode,
    composerHasWords,
    closeComposer,
    refreshPopoutOpen,
    // Which way the key goes this time.
    popoutOpen,
  ]);

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
      setQuoteMessageId(messageId);
      draftDiscardedRef.current = false;
      if (!mode) {
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
        setToList(recipientsFromEmails(to));
        setCcList(recipientsFromEmails(thread?.reply.cc ?? []));
        setEditRecipients(false);
        setIncludeSignature(signsReply());
        setUpdateCrmNotes(false);
        setMode("reply");
      }
      focusReply();
    },
    [mode, olderParts, thread, sigSettings, signsReply, answerInPopout]
  );

  const forwardMessage = React.useCallback((messageId: string) => {
    setQuoteMessageId(messageId);
    draftDiscardedRef.current = false;
    setMode("forward");
    setToList([]);
    setCcList([]);
    setShowPreview(false);
    setReply("");
    setEditorKey((k) => k + 1);
    setUpdateCrmNotes(false);
    setEditRecipients(true);
    requestAnimationFrame(() => recipientInputRef.current?.focus());
  }, []);

  const startForward = () => {
    if (mode === "forward") {
      closeComposer();
      return;
    }
    draftDiscardedRef.current = false;
    setMode("forward");
    setToList([]);
    setCcList([]);
    setShowPreview(false);
    setReply("");
    setEditorKey((k) => k + 1);
    setIncludeSignature(signsReply());
    setUpdateCrmNotes(false);
    setSubjectDraft(forwardSubject);
    setSubjectOpen(false);
    // The files on the message go with it, which is what a forward is
    // usually for. The box under the composer takes them off again.
    preForwardAttachIdsRef.current = new Set(
      attachItemsRef.current.map((i) => i.id)
    );
    setForwardFiles(true);
    void setForwardIncludeFiles(true);
    // Forwards start without recipients, so open the chip editor right away.
    setEditRecipients(true);
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
          onArchive();
          break;
        case "delete":
          // Nothing to delete when it is already deleted, and the key must
          // not quietly mean something else in this one view.
          if (inTrash) break;
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
   * The message's own words, shaped for the rebuilt history.
   *
   * Each entry goes in stripped of its own quoted tail: quoting bodies
   * whole would nest every mail's tail inside the new one and send the
   * thread many times over. A message that is nothing but a quote falls
   * back to its full text rather than vanishing.
   */
  const historyEntryOf = React.useCallback((m: MailMessage) => {
    let html: string | undefined;
    if (m.bodyHtml) {
      const safe = sanitizeEmailHtml(m.bodyHtml);
      const split = stripQuotedHtml(safe);
      // The same put-back as a copied message needs. This tail is quoted
      // into a mail that goes out, where a span carrying an address is a
      // dead link at the other end — nobody there has our click bridge.
      html = restoreAnchorsForEditing(
        split.hadQuote && split.html.trim() ? split.html : safe
      );
    }
    return replyHistoryEntry(m, html);
  }, []);

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
  }, [thread, olderParts, historyEntryOf]);

  /**
   * Tick: fetch the full thread and put its files into the ordinary
   * attachment strip — chips, a running total, and a remove each, all
   * already there. Untick: take back the conversation's files and leave
   * what the writer added themselves; matching name as well as newness so
   * a file of their own added since ticking is not swept up with ours.
   */
  /**
   * The files on some messages, as real files in the attachment strip.
   *
   * Through the mail transport, not the window's fetch: in the desktop app
   * nothing answers /api/mail/attachment over HTTP. Returns the ids added,
   * so taking them off again is exact rather than by filename.
   */
  const attachFilesFromMessages = React.useCallback(
    async (messages: MailMessage[]): Promise<{ failed: number }> => {
      const refs = messages.flatMap((m) =>
        (m.attachments ?? []).map((attachment) => ({
          messageId: m.id,
          attachment,
        }))
      );
      const files: File[] = [];
      let failed = 0;
      for (const ref of refs) {
        try {
          const res = await mailApiFetch(
            attachmentUrl({
              account,
              messageId: ref.messageId,
              attachment: ref.attachment,
            })
          );
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          files.push(
            new File([blob], ref.attachment.filename, {
              type: ref.attachment.mimeType || blob.type,
            })
          );
        } catch {
          failed += 1;
        }
      }
      if (files.length) addAttachFiles(files);
      return { failed };
    },
    [account, addAttachFiles]
  );

  /**
   * Put the forwarded message's files in the strip, or take them out.
   *
   * The ids are remembered on the way in, so taking them out removes what
   * this added and never a file the writer attached themselves.
   */
  const setForwardIncludeFiles = React.useCallback(
    async (on: boolean) => {
      const names = new Set(
        (forwardSource?.attachments ?? []).map((a) => a.filename)
      );
      /** The chips this put in: not there before, and named by the source. */
      const ours = () =>
        attachItemsRef.current.filter(
          (item) =>
            !preForwardAttachIdsRef.current.has(item.id) &&
            names.has(item.filename)
        );
      if (!on) {
        for (const item of ours()) removeAttach(item.id);
        setForwardFiles(false);
        return;
      }
      setForwardFiles(true);
      if (!forwardSource?.attachments?.length) return;
      // Already in. Ticking a box that is on must not fetch them twice.
      if (ours().length) return;
      setForwardFilesBusy(true);
      try {
        const { failed } = await attachFilesFromMessages([forwardSource]);
        if (failed) {
          toast.warning(
            `${failed} file${failed === 1 ? "" : "s"} could not be fetched`
          );
        }
      } finally {
        setForwardFilesBusy(false);
      }
    },
    [forwardSource, attachFilesFromMessages, removeAttach]
  );

  const setForwardWholeConversation = React.useCallback(
    async (on: boolean) => {
      if (!on) {
        const names = new Set(
          (forwardConversation ?? []).flatMap((m) =>
            (m.attachments ?? []).map((a) => a.filename)
          )
        );
        for (const item of attachItemsRef.current) {
          if (
            !preWholeAttachIdsRef.current.has(item.id) &&
            names.has(item.filename)
          ) {
            removeAttach(item.id);
          }
        }
        setForwardWhole(false);
        setForwardConversation(null);
        return;
      }
      if (!thread) return;
      setForwardWholeBusy(true);
      try {
        // The whole thread, fresh, from its first message. The window on
        // screen may be the middle of it, and one request answers at most
        // a page — asking for "the thread" got the newest fifty and no
        // more — so this walks the pages from the oldest until there is no
        // newer one. A conversation that has rotated through parts is
        // walked part by part, oldest part first.
        const currentPart = chatParts.find(
          (p) => p.providerThreadId === threadId
        );
        const partIds = [
          ...chatParts
            .filter(
              (p) =>
                currentPart && p.partIndex < currentPart.partIndex
            )
            .sort((a, b) => a.partIndex - b.partIndex)
            .map((p) => p.providerThreadId),
          threadId,
        ];
        const messages: MailMessage[] = [];
        for (const partThreadId of partIds) {
          messages.push(...(await loadWholeThread(account, partThreadId)));
        }
        preWholeAttachIdsRef.current = new Set(
          attachItemsRef.current.map((i) => i.id)
        );
        const refs = messages.flatMap((m) =>
          (m.attachments ?? []).map((attachment) => ({
            messageId: m.id,
            attachment,
          }))
        );
        const files: File[] = [];
        let failed = 0;
        for (const ref of refs) {
          try {
            // Through the mail transport, not the window's fetch: in the
            // desktop app nothing answers /api/mail/attachment over HTTP,
            // and the dev server's fallback page came back as the "file" —
            // 578 bytes of HTML with every attachment's name.
            const res = await mailApiFetch(
              attachmentUrl({
                account,
                messageId: ref.messageId,
                attachment: ref.attachment,
              })
            );
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            files.push(
              new File([blob], ref.attachment.filename, {
                type: ref.attachment.mimeType || blob.type,
              })
            );
          } catch {
            failed += 1;
          }
        }
        if (files.length) addAttachFiles(files);
        if (failed) {
          toast.warning(
            `${failed} file${failed === 1 ? "" : "s"} from the conversation could not be fetched`
          );
        }
        setForwardConversation(messages);
        setForwardWhole(true);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Couldn't load the conversation"
        );
      } finally {
        setForwardWholeBusy(false);
      }
    },
    [
      thread,
      chatParts,
      account,
      threadId,
      forwardConversation,
      removeAttach,
      addAttachFiles,
    ]
  );

  /** The forwarded conversation, oldest first — a story, not a chain. */
  const forwardWholeAppendix = React.useMemo(() => {
    if (!forwardWhole || !forwardConversation?.length || !thread) return null;
    return buildQuoteHistory(forwardConversation.map(historyEntryOf), {
      order: "oldest-first",
      heading: `Forwarded conversation — ${thread.subject} (${forwardConversation.length} messages)`,
    });
  }, [forwardWhole, forwardConversation, thread, historyEntryOf]);

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

  const sendForward = React.useCallback(async () => {
    const flatTo = flattenRecipientsForSend(toList);
    const flatCc = flattenRecipientsForSend(ccList);
    if (!thread || !forwardSource || !flatTo.emails.length || sending) return;
    if (!attachmentsReady) {
      toast.error(mailSay("stillPreparingAttachments"));
      return;
    }
    const attachments = attachmentPayload();
    const bcc = [...flatTo.bccEmails, ...flatCc.bccEmails];
    setSending(true);
    try {
      await apiJson("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: fromAccount,
          to: flatTo.emails,
          cc: flatCc.emails.length ? flatCc.emails : undefined,
          bcc: bcc.length ? bcc : undefined,
          subject: outgoingSubject,
          body: replyText,
          html: replyText.trim() ? bodyToEmailHtml(reply) : undefined,
          includeSignature,
          attachments: attachments.length ? attachments : undefined,
          // One message, or the whole story. The conversation goes as a
          // rebuilt transcript — its files are already in `attachments`,
          // put there when the box was ticked.
          forward: forwardWholeAppendix
            ? undefined
            : {
                fromName: forwardSource.fromName,
                fromEmail: forwardSource.fromEmail,
                date: messageStamp(forwardSource.sentAt),
                subject: thread.subject,
                to: forwardSource.toEmails,
                text: decodeHtmlEntities(
                  formatEmailBody(forwardSource.bodyText)
                ).trim(),
                // Sanitized so we never relay scripts/embeds from the original.
                html: forwardSource.bodyHtml
                  ? sanitizeEmailHtml(forwardSource.bodyHtml)
                  : undefined,
              },
          appendix: forwardWholeAppendix
            ? {
                text: forwardWholeAppendix.text,
                html: forwardWholeAppendix.html,
              }
            : undefined,
        }),
      });
      toast.success(
        mailSay("forwardedTo", { who: formatRecipientSummary(toList) })
      );
      closeComposer();
      onSent?.(fromAccount);
      scheduleThreadRefetchAfterSend(account, threadId, setThread);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't forward");
    } finally {
      setSending(false);
    }
  }, [
    thread,
    forwardSource,
    forwardWholeAppendix,
    toList,
    ccList,
    forwardSubject,
    sending,
    fromAccount,
    account,
    threadId,
    reply,
    replyText,
    includeSignature,
    closeComposer,
    attachmentsReady,
    attachmentPayload,
    onSent,
  ]);

  const markOutboxConfirmed = React.useCallback((localId: string) => {
    setOutbox((prev) => {
      if (!(localId in prev)) return prev;
      const next = { ...prev };
      delete next[localId];
      return next;
    });
    setConfirmingIds((cur) => new Set(cur).add(localId));
    window.setTimeout(() => {
      setConfirmingIds((cur) => {
        if (!cur.has(localId)) return cur;
        const next = new Set(cur);
        next.delete(localId);
        return next;
      });
    }, 220);
  }, []);

  const dispatchOutboxSendRef = React.useRef<
    ((localId: string, entry: OutboxEntry) => Promise<void>) | null
  >(null);
  const dispatchOutboxSend = React.useCallback(
    async (localId: string, entry: OutboxEntry) => {
      setOutbox((prev) => ({
        ...prev,
        [localId]: { ...entry, status: "sending" },
      }));
      setSending(true);
      try {
        const json = await apiJson<{
          chat?: MailChatRef;
          threadId?: string;
          rotated?: boolean;
          crmNotes?: {
            updated: string[];
            skipped?: string;
            errors: string[];
          };
          crmProposal?: CrmProposeResult;
        }>("/api/mail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry.request),
        });
        if (entry.request.updateCrmNotes && json.crmNotes) {
          toastCrmNotesResult(json.crmNotes, { onApplied: crmChanged });
        }
        if (entry.request.updateCrmNotes && json.crmProposal) {
          showCrmProposal({ account, threadId }, json.crmProposal, readableAttachments);
        }
        if (
          json.rotated &&
          json.threadId &&
          json.threadId !== threadId &&
          json.chat
        ) {
          setOutbox((prev) => {
            const next = { ...prev };
            delete next[localId];
            return next;
          });
          setThread((current) =>
            current
              ? {
                  ...current,
                  messages: current.messages.filter((m) => m.id !== localId),
                }
              : current
          );
          onChatThreadChanged(json.threadId, json.chat);
          return;
        }
        if (json.chat) {
          setThread((current) =>
            current ? { ...current, chat: json.chat } : current
          );
          onChatPromoted(json.chat);
        }
        // Provider accepted the send — color the bubble in. Thread refetch
        // still replaces local-* with the real message id when it appears.
        markOutboxConfirmed(localId);
        onSent?.(entry.request.account);
        scheduleThreadRefetchAfterSend(account, threadId, setThread);
      } catch (err) {
        setOutbox((prev) => ({
          ...prev,
          [localId]: { ...entry, status: "failed" },
        }));
        /**
         * Said out loud, not only shown. The red bubble with its retry is
         * in this pane — and the count between Send and the send means the
         * reader may have archived the thread and be somewhere else by the
         * time it fails. A failure nobody is looking at is a reply that
         * silently never went.
         *
         * The toast's own retry works from anywhere: the request was
         * captured whole when Send was pressed, so posting it again needs
         * nothing from a pane that may be gone.
         */
        const firstTo = entry.request.to[0] ?? "the thread";
        toast.error(`Your reply to ${firstTo} did not send`, {
          description:
            err instanceof Error ? err.message : undefined,
          duration: 15_000,
          action: {
            label: "Retry",
            onClick: () => void dispatchOutboxSendRef.current?.(localId, entry),
          },
        });
      } finally {
        setSending(false);
      }
    },
    [
      account,
      threadId,
      onChatPromoted,
      onChatThreadChanged,
      crmChanged,
      readableAttachments,
      markOutboxConfirmed,
      onSent,
    ]
  );
  /* Through a ref so the failure toast's Retry reaches the newest version
     of the dispatch rather than the one closed over when it was shown. */
  dispatchOutboxSendRef.current = dispatchOutboxSend;

  /**
   * Finish this one in Outlook.
   *
   * Not a file handed to Outlook: it previews such a file read-only, which
   * is a message to look at rather than one to write. The draft is made in
   * the mailbox instead, where Outlook is already looking — it appears in
   * Drafts, formatted, editable, in the conversation it answers.
   *
   * Nothing here is sent and nothing is thrown away: the reply stays in this
   * composer, so the reader who changes their mind has lost nothing.
   */
  const [handingOver, setHandingOver] = React.useState(false);
  /**
   * The copy this app is keeping, once the message has gone to Outlook.
   *
   * A handover is not a send: the message is in Outlook, or on the
   * pasteboard, and whether it ever leaves is decided over there. So the
   * draft stays here — and then stays, and stays, because nothing in this
   * app will ever see it sent. That is how a Drafts list fills with mail
   * that went out weeks ago.
   *
   * The reader is the only one who knows, and they know it now, with the
   * message in front of them in Outlook. So the toast asks. One press, and
   * the composer closes the way discarding closes it.
   */
  const handoverDiscard = React.useCallback(
    () => ({
      action: {
        label: mailSay("discardTheCopyHere"),
        onClick: () => closeComposerRef.current?.(),
      },
      duration: 12_000,
    }),
    []
  );

  const openInOutlook = React.useCallback(async () => {
    const attachments = attachmentPayload();
    const flatTo = flattenRecipientsForSend(toList);
    const flatCc = flattenRecipientsForSend(ccList);
    if (!thread || !flatTo.emails.length || handingOver) return;
    if (!attachmentsReady) {
      toast.error(mailSay("stillPreparingAttachments"));
      return;
    }
    const chatNoQuote = Boolean(thread.chat && thread.chat.noQuote !== false);
/**
     * A forward hands over as a forward.
     *
     * This built a reply whatever the composer was doing: the subject went
     * over as "Re:" and the message being forwarded was left behind
     * entirely, so what opened in Outlook was an empty reply to the wrong
     * subject. The forward carries its own subject — the writer's, if they
     * changed it — and the message underneath.
     */
    const forwardHandover = forwarding && forwardSource
      ? {
          fromName: forwardSource.fromName,
          fromEmail: forwardSource.fromEmail,
          date: messageStamp(forwardSource.sentAt),
          subject: thread.subject,
          to: forwardSource.toEmails,
          text: decodeHtmlEntities(
            formatEmailBody(forwardSource.bodyText)
          ).trim(),
          html: forwardSource.bodyHtml
            ? sanitizeEmailHtml(forwardSource.bodyHtml)
            : undefined,
        }
      : undefined;
    const handoverSubject = outgoingSubject;
        const pickedQuote = quoteMessageId ? quotePayload : undefined;
    const noQuote = chatNoQuote || Boolean(pickedQuote);
    const composed = quotedReplyMessage(
      replyText,
      pickedQuote,
      replyText.trim() ? bodyToEmailHtml(reply) : undefined
    );
    setHandingOver(true);
    try {
      /*
        No mailbox of ours: a new Outlook message, and the body pasted in.

        The mailbox the reader wants is often one this app can never hold a
        token for — a university that will not approve a third-party client
        cannot be handed a draft over Graph either. Outlook opens on the
        recipients and the subject, and the message waits on the pasteboard
        with its formatting intact.
      */
      if (!outlookTarget) {
        const html = replyText.trim() || pickedQuote ? composed.html : "";
        // Outlook adds its own signature to what it opens; ours stays here.
        const carrying = withoutTrailingSignature(
          { html: html || composed.text, text: composed.text },
          htmlToPlainText(sigSettings?.signature ?? "")
        );
        // Plain and short: the message rides in the URL and the reader has
        // nothing left to do. Otherwise the pasteboard, which keeps the
        // formatting a mailto: cannot.
        const carried = bodyTravels(carrying.html, carrying.text);
        if (!carried) {
          await copyMessageToClipboard(carrying);
        }
        await openOutlookCompose(
          outlookComposeUrl({
            to: flatTo.emails,
            // A copy back to the mailbox it was written from, so what goes
            // out from Outlook lands in this app's mail too.
            cc: ccBackToSelf({
              from: fromAccount,
              to: flatTo.emails,
              cc: flatCc.emails,
            }),
            subject: handoverSubject,
            body: carried ? carrying.text : undefined,
          })
        );
        /*
          The files, which a mailto: cannot carry.

          They were dropped without a word before this: the message opened
          in Outlook and the attachments simply were not on it. Now they go
          to the downloads folder with the file manager pointed at them, and
          the toast says where they are — or says they did not travel, when
          there is nowhere to put them.
        */
        // What did happen here, recorded: the words went to Outlook. See
        // markDraftHandedOver, and the list, which says so rather than
        // showing the copy as an unfinished letter.
        void markDraftHandedOver(threadDraftKey(account, threadId), fromAccount);
        const savedFiles = await saveAttachmentsForHandover(attachments);
        toast.success(
          carried ? mailSay("outlookIsOpen") : mailSay("outlookIsOpenPaste"),
          {
            ...(attachments.length
              ? {
                  description: savedFiles
                    ? mailSay("outlookFilesInDownloads", {
                        count: `${savedFiles} file${savedFiles === 1 ? "" : "s"}`,
                      })
                    : mailSay("outlookFilesLeftBehind", {
                        count: `${attachments.length} file${attachments.length === 1 ? "" : "s"}`,
                      }),
                  duration: 12_000,
                }
              : null),
            ...handoverDiscard(),
          }
        );
        return;
      }
      await apiJson("/api/mail/outlook-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: outlookTarget,
          to: flatTo.emails,
          cc: flatCc.emails.length ? flatCc.emails : undefined,
          bcc: [...flatTo.bccEmails, ...flatCc.bccEmails].length
            ? [...flatTo.bccEmails, ...flatCc.bccEmails]
            : undefined,
          subject: handoverSubject,
          body: composed.text,
          html:
            replyText.trim() || pickedQuote ? composed.html : undefined,
          // The signature belongs to the mailbox the draft is made in, and
          // the reader picks it up there — asking for this one's would put
          // a Digital Habits sign-off on a university address.
          includeSignature: outlookElsewhere ? false : includeSignature,
          /*
            Threaded only where the conversation exists.

            Graph finds the message to reply to by this id, in this mailbox.
            A thread that arrived somewhere else — forwarded in from the
            university, most of the time — has no such id here, so the draft
            is a new message: right recipients, right subject, no place in
            the conversation on this side. Nothing is lost that this end
            ever had.
          */
          threadId:
            !outlookElsewhere && fromAccount === account && !forwarding
              ? threadId
              : undefined,
          // The message being forwarded, under whatever was typed above it.
          forward: forwardHandover,
          appendix:
            noQuote || !historyAppendix
              ? undefined
              : { text: historyAppendix.text, html: historyAppendix.html },
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      // The draft is in the mailbox whether or not Outlook can be raised, so
      // a Mac without it still gets the good news and where to look.
      /*
        The draft is made either way, so a window that will not come
        forward is worth saying out loud rather than logging: the reader is
        looking at this toast, not at a console, and "it did nothing" is
        what a silent failure looks like from there.
      */
      const invoke = tauriInvoke();
      const refused = invoke
        ? await invoke("activate_outlook").then(
            () => "",
            (err: unknown) => {
              console.warn("[mail] couldn't bring Outlook forward:", err);
              // What Rust said, which is what `open` said. A reason on the
              // screen is the difference between a bug report and a shrug.
              return err instanceof Error
                ? err.message
                : String(err) || mailSay("outlookDidNotOpen");
            }
          )
        : mailSay("outlookDidNotOpen");
      const landed = outlookElsewhere
        ? mailSay("draftIsInOutlookFrom", { account: outlookTarget })
        : mailSay("draftIsInOutlook");
      void markDraftHandedOver(threadDraftKey(account, threadId), fromAccount);
      toast.success(landed, {
        ...(refused ? { description: refused } : null),
        ...handoverDiscard(),
      });
    } catch (err) {
      const fallback = outlookTarget
        ? mailSay("couldNotDraftInOutlook")
        : mailSay("couldNotOpenOutlook");
      /*
        Tauri refuses with a string, not an Error.

        Reading `.message` off it and falling back to a sentence of our own
        threw away the only line that said what was wrong — "command not
        found", when the window is older than the command it is calling.
      */
      const said =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "";
      toast.error(said.trim() || fallback);
    } finally {
      setHandingOver(false);
    }
  }, [
    account,
    attachmentPayload,
    attachmentsReady,
    ccList,
    fromAccount,
    outlookTarget,
    outlookElsewhere,
    handingOver,
    historyAppendix,
    includeSignature,
    quoteMessageId,
    quotePayload,
    reply,
    replyText,
    thread,
    threadId,
    toList,
    // A forward hands over as a forward — without these the callback keeps
    // the first render's answer and sends a reply's subject either way.
    forwarding,
    forwardSource,
    forwardSubject,
    outgoingSubject,
  ]);

  const send = React.useCallback(async (
    sendAt?: string,
    extras?: { proposeCrm?: boolean },
    /* Set by the reminder's own Send, so the question is asked once. */
    pastAttachmentCheck?: boolean
  ) => {
    const attachments = attachmentPayload();
    const flatTo = flattenRecipientsForSend(toList);
    const flatCc = flattenRecipientsForSend(ccList);
    if (
      !thread ||
      !flatTo.emails.length ||
      sending ||
      (!replyText.trim() && !attachments.length) ||
      !mode ||
      mode === "forward"
    ) {
      return;
    }
    if (!attachmentsReady) {
      toast.error(mailSay("stillPreparingAttachments"));
      return;
    }
    /*
      Somebody who wrote "attached" and attached nothing.

      Asked before the message goes, because afterwards the only remedy is
      a second message saying sorry. Only when the words promise a file and
      there is none: a prompt that cries wolf is one people learn to click
      through, and then it is worth nothing on the day it is right.
    */
    if (
      !pastAttachmentCheck &&
      !attachments.length &&
      promisesAnAttachment({
        subject: subjectDraft.trim() || thread.subject,
        bodyText: replyText,
      })
    ) {
      setForgottenAttachment({ sendAt, extras });
      return;
    }
    // Sending from another account: its Gmail doesn't know this threadId, so
    // we drop it and bcc the receiving account instead — the copy lands back
    // in the original thread there (threaded via the References header).
    const crossAccount = fromAccount !== account;
    const bcc = [
      ...flatTo.bccEmails,
      ...flatCc.bccEmails,
      ...(crossAccount ? [account] : []),
    ];
    // Missing noQuote on older rows = former chat-mode (treat as on).
    const chatNoQuote = Boolean(
      thread.chat && thread.chat.noQuote !== false
    );
    /**
     * A reply to one message the reader picked, rather than to the thread.
     *
     * It carries that message in its body, in the card a reaction uses. Sent
     * as the quoted history it was folded away behind a "…" by the reader,
     * and a chat-style thread drops the history altogether — so the message
     * that was picked never showed up at either end.
     */
    const pickedQuote = quoteMessageId ? quotePayload : undefined;
    const noQuote = chatNoQuote || Boolean(pickedQuote);
    const localId = `local-${Date.now()}`;
    const localQuote =
      !noQuote && historyAppendix
        ? { text: historyAppendix.text, html: historyAppendix.html }
        : null;
    const composed = quotedReplyMessage(
      replyText,
      pickedQuote,
      replyText.trim() ? bodyToEmailHtml(reply) : undefined
    );
    const replyHtml = replyText.trim() || pickedQuote
      ? composed.html
      : undefined;
    const entry: OutboxEntry = {
      status: "sending",
      mode,
      reply,
      toList,
      ccList,
      showCc,
      editRecipients,
      includeSignature,
      fromAccount,
      request: {
        account: fromAccount,
        to: flatTo.emails,
        cc: flatCc.emails.length ? flatCc.emails : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject: outgoingSubject,
        body: composed.text,
        html: replyHtml,
        // Whatever was asked for. Not quoting the history used to turn the
        // signature off with it, which made one answer out of two
        // questions: a reply can leave the history out and still be signed.
        includeSignature,
        threadId: crossAccount ? undefined : threadId,
        inReplyTo: thread.reply.inReplyTo,
        references: thread.reply.references,
        // The tail is rebuilt from the thread, not inherited from the
        // mail being answered — so it survives a chat-style mail in the
        // middle, and ticking the box back on really brings it back.
        appendix:
          noQuote || !historyAppendix
            ? undefined
            : { text: historyAppendix.text, html: historyAppendix.html },
        noQuote: noQuote || undefined,
        // Sent from a draft the provider was holding — let it go once the
        // mail is away, or Outlook/Gmail keeps an unsent copy of it.
        discardProviderDraft: importedDraftRef.current ?? undefined,
        messageCount:
          olderParts.reduce((n, p) => n + p.messages.length, 0) +
          thread.messages.length,
        updateCrmNotes:
          (extras?.proposeCrm || updateCrmNotes) &&
          (mode === "reply" || mode === "replyAll")
            ? true
            : undefined,
        attachments: attachments.length ? attachments : undefined,
        sendAt,
      },
    };

    /**
     * A message that has not gone yet does not belong in the conversation.
     *
     * The ordinary path paints the bubble straight away, because the send is
     * on its way and the bubble is only ahead of the provider's copy. This
     * one is not on its way — Exchange is holding it until the time — so the
     * thread would be showing the reader something they have not said.
     */
    if (sendAt) {
      setSending(true);
      try {
        await apiJson("/api/mail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry.request),
        });
        // See the composer: say where it waits, not only when it goes.
        toast.success(
          mailSay("sendsWhen", { when: formatSnoozeWakeLabel(sendAt) }),
          { description: mailSay("outlookHoldsIt") }
        );
        closeComposer();
        // Twice: the message is held as a draft, and Exchange takes a moment
        // to have it. The first look usually finds it; the second is for
        // when it does not.
        void loadScheduled();
        notifyScheduledChanged();
        window.setTimeout(() => {
          void loadScheduled();
          notifyScheduledChanged();
        }, 1500);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't schedule the message"
        );
      } finally {
        setSending(false);
      }
      return;
    }

    setOutbox((prev) => ({ ...prev, [localId]: entry }));
    setThread((current) =>
      current
        ? {
            ...current,
            messages: [
              ...current.messages,
              {
                id: localId,
                fromName: "You",
                fromEmail: fromAccount,
                toEmails: flatTo.emails,
                ccEmails: flatCc.emails,
                sentAt: new Date().toISOString(),
                // The bubble before the provider's copy lands shows what
                // actually went, quote card and all.
                bodyText: localQuote
                  ? `${composed.text.trimEnd()}\n\n${localQuote.text}`
                  : composed.text,
                bodyHtml: localQuote
                  ? `${composed.html}${localQuote.html}`
                  : composed.html,
                attachments: attachments.length
                  ? attachments.map((a, i) => ({
                      attachmentId: `local-${i}`,
                      filename: a.filename,
                      mimeType: a.mimeType,
                      size: Math.floor(
                        (a.contentBase64.replace(/\s+/g, "").length * 3) / 4
                      ),
                    }))
                  : undefined,
                own: true,
              },
            ],
          }
        : current
    );
    closeComposer();
    /**
     * A few seconds before it leaves.
     *
     * The bubble is already in the thread and the composer is already shut,
     * which is what the reader wanted; what has not happened is the send.
     * Undo is the edit that was always there — it takes the bubble back out
     * and puts the words back in the box.
     */
    sendWithUndo({
      onSend: () => void dispatchOutboxSend(localId, entry),
      onUndo: () => editOutboxSendRef.current?.(localId),
    });
  }, [
    thread,
    reply,
    replyText,
    toList,
    ccList,
    sending,
    account,
    fromAccount,
    threadId,
    includeSignature,
    quotePayload,
    historyAppendix,
    closeComposer,
    attachmentsReady,
    attachmentPayload,
    olderParts,
    mode,
    showCc,
    editRecipients,
    inCrm,
    updateCrmNotes,
    dispatchOutboxSend,
    loadScheduled,
    // The subject the writer set. Without it the callback keeps the first
    // render's answer and sends the thread's own name over a changed one.
    outgoingSubject,
  ]);

  const retryOutboxSend = React.useCallback(
    (localId: string) => {
      const entry = outbox[localId];
      if (!entry || entry.status !== "failed" || sending) return;
      void dispatchOutboxSend(localId, entry);
    },
    [outbox, sending, dispatchOutboxSend]
  );

  /**
   * Held in a ref because `send` is defined above this and needs it: naming
   * it in that callback's dependencies would read it before it exists.
   */
  const editOutboxSendRef = React.useRef<((localId: string) => void) | null>(
    null
  );

  const editOutboxSend = React.useCallback(
    (localId: string) => {
      const entry = outbox[localId];
      if (!entry) return;
      draftDiscardedRef.current = false;
      setOutbox((prev) => {
        const next = { ...prev };
        delete next[localId];
        return next;
      });
      setThread((current) =>
        current
          ? {
              ...current,
              messages: current.messages.filter((m) => m.id !== localId),
            }
          : current
      );
      setMode(entry.mode);
      setReply(entry.reply);
      setToList(entry.toList);
      setCcList(entry.ccList);
      setShowCc(entry.showCc);
      setEditRecipients(entry.editRecipients);
      setIncludeSignature(entry.includeSignature);
      setFromAccount(entry.fromAccount);
      setUpdateCrmNotes(Boolean(entry.request.updateCrmNotes));
      setEditorKey((k) => k + 1);
      focusReply();
    },
    [outbox, focusReply]
  );
  editOutboxSendRef.current = editOutboxSend;

  /**
   * A draft written in the pop-out, once that window has gone.
   *
   * The pop-out saves what was typed as this thread's reply draft and closes,
   * which hands focus back here — and the thread is already open, so nothing
   * would otherwise look at the store again until it was reopened.
   *
   * Focus is the signal rather than a message between the windows: the stored
   * pages already showed what a Tauri window can be trusted to tell another
   * one, and this needs no channel at all. Bring back is the one caller that
   * cannot use it, and says why where it asks.
   *
   * Only when there is nothing here to lose. A reply half-written in this
   * window is not something to overwrite with one written somewhere else.
   */
  const adoptStoredDraft = React.useCallback(() => {
    if (replyText.trim()) return;
    void getDraft(threadDraftKey(account, threadId)).then((raw) => {
      if (raw?.kind !== "thread" || !raw.body.trim()) return;
      draftDiscardedRef.current = false;
      setMode(raw.mode);
      setReply(raw.body);
      setToList(raw.toList);
      setCcList(raw.ccList);
      setShowCc(raw.showCc);
      setEditRecipients(raw.editRecipients);
      setIncludeSignature(raw.includeSignature);
      setFromAccount(raw.fromAccount);
      setQuoteMessageId(raw.quoteMessageId ?? null);
      setEditorKey((k) => k + 1);
      focusReply(raw.caret ?? null);
    });
  }, [account, threadId, replyText]);

  React.useEffect(() => {
    window.addEventListener("focus", adoptStoredDraft);
    return () => window.removeEventListener("focus", adoptStoredDraft);
  }, [adoptStoredDraft]);

  /**
   * Bring the answer back here: the pop-out hands its draft over and goes.
   *
   * Then wait for the window to actually be gone. Focus cannot be the
   * signal this once — the click that asks for it happens in this window,
   * which therefore never loses focus and never regains it — so this is the
   * one place that watches for itself. The draft is taken up the moment the
   * pop-out is no longer there.
   */
  const handingBackRef = React.useRef(false);

  const bringBackPopout = React.useCallback(async () => {
    // Asking twice is one click too many: the second watch would still be
    // running when the draft lands in the box, and would put it there again
    // over whatever had been typed on top of it.
    if (handingBackRef.current) return;
    handingBackRef.current = true;
    const key = `${account}|${threadId}`;
    try {
      await handBackChatPopout({ account, threadId });
      for (let i = 0; i < POPOUT_HAND_BACK_TRIES; i++) {
        await new Promise((resolve) =>
          setTimeout(resolve, POPOUT_HAND_BACK_POLL_MS)
        );
        // The reader has moved on. Whatever came back belongs to a thread
        // this pane is no longer showing.
        if (popoutKeyRef.current !== key) return;
        if (await refreshPopoutOpen()) continue;
        adoptStoredDraft();
        return;
      }
    } finally {
      handingBackRef.current = false;
    }
  }, [account, threadId, refreshPopoutOpen, adoptStoredDraft]);
  bringBackRef.current = () => void bringBackPopout();

  /** Take it back into the composer: it stops being held, and it is a draft. */
  const editScheduled = React.useCallback(
    (message: MailScheduledMessage) => {
      draftDiscardedRef.current = false;
      setMode("reply");
      setReply(message.bodyHtml || message.bodyText);
      setEditorKey((k) => k + 1);
      void actOnScheduled(message.id, "cancel");
      focusReply();
    },
    [actOnScheduled, focusReply]
  );

  /** Gmail-style quick reaction: replies with just the emoji (+ quoted history). */
  const sendQuickReply = React.useCallback(
    async (emoji: string, quoteOverride?: ReturnType<typeof quoteFromMessage>) => {
      if (!thread || sending) return;
      const quoted = quoteOverride ?? quotePayload;
      /**
       * The emoji, and a line of what it answers.
       *
       * Mail cannot attach a reaction to a message the way a messaging app
       * does, so it goes as another message — and the emoji on its own
       * arrives with nothing to say which message it was for. The context
       * travels inside the body instead of as the quoted history below it:
       * one line is the point, and a chat-style thread leaves the history off
       * anyway. See `lib/mail/reaction-message`.
       */
      const reaction = reactionMessage(emoji, quoted);
      const emojiHtml = reaction.html;
      // A reaction never carries the whole conversation under it. It carries
      // the one line it is about.
      const noQuote = true;
      const localId = `local-${Date.now()}`;
      const entry: OutboxEntry = {
        status: "sending",
        mode: "reply",
        reply: emojiHtml,
        toList: recipientsFromEmails(thread.reply.to),
        ccList: [],
        showCc: false,
        editRecipients: false,
        includeSignature: false,
        fromAccount: account,
        request: {
          account,
          to: thread.reply.to,
          subject: replySubject,
          body: reaction.text,
          html: emojiHtml,
          includeSignature: false,
          threadId,
          inReplyTo: thread.reply.inReplyTo,
          references: thread.reply.references,
          noQuote: noQuote || undefined,
          messageCount:
            olderParts.reduce((n, p) => n + p.messages.length, 0) +
            thread.messages.length,
        },
      };
      setOutbox((prev) => ({ ...prev, [localId]: entry }));
      setThread((current) =>
        current
          ? {
              ...current,
              messages: [
                ...current.messages,
                {
                  id: localId,
                  fromName: "You",
                  fromEmail: account,
                  toEmails: thread.reply.to,
                  ccEmails: [],
                  sentAt: new Date().toISOString(),
                  // The bubble that appears before the provider's copy
                  // lands shows exactly what went out.
                  bodyText: reaction.text,
                  bodyHtml: reaction.html,
                  own: true,
                },
              ],
            }
          : current
      );
      await dispatchOutboxSend(localId, entry);
    },
    [
      thread,
      sending,
      account,
      threadId,
      quotePayload,
      olderParts,
      dispatchOutboxSend,
    ]
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
    setOutbox({});
    setConfirmingIds(new Set());
    setQuoteMessageId(null);
  }, [threadId]);

  // Drop outbox rows once the provider message replaced the local-* bubble.
  React.useEffect(() => {
    if (!thread) return;
    const ids = new Set(thread.messages.map((m) => m.id));
    setOutbox((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!ids.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [thread]);

  const latestId = thread?.messages[thread.messages.length - 1]?.id;

  /**
   * True when the thread is taller than the pane it sits in.
   *
   * The chip in the header exists to reach a beginning that has scrolled out
   * of sight. On a thread that fits, it would point at something already on
   * screen, so it is not offered.
   */
  const [threadOverflows, setThreadOverflows] = React.useState(false);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A few pixels of slack: a thread one line over is not one you lose your
    // place in, and a chip that flickers on a resize is worse than no chip.
    const measure = () =>
      setThreadOverflows(el.scrollHeight > el.clientHeight + 24);
    measure();
    const observer = new ResizeObserver(() => {
      if (afterMailPaneSlide(measure)) return;
      measure();
    });
    observer.observe(el);
    const content = el.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [thread, olderParts]);

  const [firstPeekOpen, setFirstPeekOpen] = React.useState(false);
  React.useEffect(() => {
    setFirstPeekOpen(false);
  }, [threadId]);

  /**
   * Put a message in view, the same way the search deep-link does.
   *
   * A message that has just been prepended is not in the document yet, so
   * this waits a few frames for it rather than doing nothing.
   */
  const scrollToMessage = React.useCallback(async (id: string) => {
    const selector = `[data-message-id="${id
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')}"]`;
    for (let attempt = 0; attempt < 20; attempt++) {
      const el = scrollRef.current;
      const target = el?.querySelector<HTMLElement>(selector);
      if (el && target) {
        const paneTop = el.getBoundingClientRect().top;
        const targetTop = target.getBoundingClientRect().top;
        el.scrollTo({
          top: Math.max(0, el.scrollTop + (targetTop - paneTop) - 16),
          behavior: "auto",
        });
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
  }, []);

  /**
   * The message the thread opened with, fetched on its own.
   *
   * One request, whatever the thread's size: the provider's id list already
   * says where a thread begins, so the oldest page is directly addressable and
   * `limit: 1` asks for that one message. Reading back to it a window at a
   * time would fetch the whole thread to show its first line.
   */
  const [firstMessage, setFirstMessage] = React.useState<MailMessage | null>(
    null
  );

  /**
   * The provider thread holding this conversation's beginning.
   *
   * A rotated conversation keeps its first message in part one, which is a
   * different provider thread from the one on screen. Asking the open thread
   * for its oldest message names the day that part started — on a long chat,
   * days or years after the conversation did.
   *
   * Null while a chat's parts are still arriving. No chip is better than a
   * chip that names the wrong day and corrects itself a moment later.
   */
  const firstPartThreadId = React.useMemo(() => {
    if (!thread?.chat) return threadId;
    if (!chatParts.length) return null;
    return (
      chatParts.find((p) => p.partIndex === 1)?.providerThreadId ?? threadId
    );
  }, [thread?.chat, chatParts, threadId]);

  React.useEffect(() => {
    setFirstMessage(null);
    if (!firstPartThreadId || !account) return;
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({
          account,
          id: firstPartThreadId,
          oldest: "1",
          limit: "1",
          // Reading the first line of a thread is not reading the thread.
          markRead: "0",
        });
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        if (!cancelled) setFirstMessage(json.thread.messages[0] ?? null);
      } catch {
        // The chip simply does not appear. Nothing else depends on it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firstPartThreadId, account]);

  /**
   * The first message as the thread shows it, not as a stripped-down line.
   *
   * The peek held a plain-text snippet, and a plain-text snippet is a
   * different message from the one below it: a sender who writes in HTML
   * puts links, headings and pictures in tags, and the text alternative
   * beside it — where there is one at all — carries that markup as words.
   * A GitHub notification opened this peek with `<img width="393"
   * height="924" src="…">` sitting in the middle of a sentence.
   *
   * Quoted history is dropped, the same as the bubble's own first view of a
   * message: a peek is the last place to spend six lines on a reply's
   * quotation of what came before it.
   */
  const firstPeekHtml = React.useMemo(() => {
    if (!firstMessage?.bodyHtml) return null;
    const split = stripQuotedHtml(firstMessage.bodyHtml);
    return split.hadQuote ? split.html : firstMessage.bodyHtml;
  }, [firstMessage?.bodyHtml]);

  /**
   * Whether this sender's pictures may load here.
   *
   * The same question the bubble asks, answered from the same two places,
   * so the peek cannot fetch anything the thread would have refused.
   */
  const firstPeekAllowImages = React.useMemo(() => {
    if (!firstMessage) return false;
    const sender = firstMessage.fromEmail.trim().toLowerCase();
    return loadImagesByDefault || (readImageChoices()[sender] ?? inCrm);
  }, [firstMessage, loadImagesByDefault, inCrm]);

  const [loadingToStart, setLoadingToStart] = React.useState(false);

  /**
   * Move the window to the beginning of the thread.
   *
   * A jump, not a walk. The pane already renders a window that has newer
   * messages beyond it — that is what a search deep-link leaves it in — so the
   * oldest page is one request, and scrolling back down pages forward from
   * there.
   */
  const goToFirstMessage = React.useCallback(async () => {
    if (!firstMessage || !account || !firstPartThreadId) return;

    // The beginning sits in an earlier part, so this is a move between
    // provider threads rather than a wider window on this one. It goes the
    // way a search hit goes: the pane reopens on that part, centred on that
    // message. Widening this thread could never reach it.
    const chatRef = thread?.chat;
    if (firstPartThreadId !== threadId && chatRef) {
      const part = chatParts.find((p) => p.partIndex === 1);
      setFirstPeekOpen(false);
      onChatThreadChanged(
        firstPartThreadId,
        {
          ...chatRef,
          partIndex: 1,
          subject: part?.subject ?? chatRef.subject,
          isOpenPart: part?.status === "open",
        },
        firstMessage.id
      );
      return;
    }

    setLoadingToStart(true);
    // Claimed before the fetch, so the pin cannot win a race with it.
    skipOpenPinRef.current = true;
    try {
      const params = new URLSearchParams({
        account,
        id: threadId,
        oldest: "1",
        markRead: "0",
      });
      const json = await apiJson<{ thread: MailThreadDetail }>(
        `/api/mail/thread?${params.toString()}`
      );
      setOlderParts([]);
      setThread(json.thread);
      await scrollToMessage(firstMessage.id);
      setFirstPeekOpen(false);
    } catch (err) {
      skipOpenPinRef.current = false;
      toast.error(
        err instanceof Error ? err.message : "Couldn't open the start"
      );
    } finally {
      setLoadingToStart(false);
    }
  }, [
    firstMessage,
    account,
    threadId,
    firstPartThreadId,
    thread?.chat,
    chatParts,
    onChatThreadChanged,
    scrollToMessage,
  ]);


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
    if (!mode) return;
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
  }, [shortcuts, floating]);

  /**
   * The draft in flight, and the way to call it off.
   *
   * A model writing a reply takes tens of seconds, and a reader who pressed
   * the button by mistake — or read the thread again and changed their mind
   * — had nothing to press: the button that started it went grey and the
   * strip only spun. So the run is held, and stopping it puts the composer
   * back the way it was.
   *
   * Stopping is not failing. The reader asked for this one, so no error is
   * raised for it and nothing is said in red.
   */
  const aiReplyRun = React.useRef<AbortController | null>(null);

  const stopAiReply = React.useCallback(() => {
    aiReplyRun.current?.abort();
    aiReplyRun.current = null;
    // Said here rather than waited for: a transport that does not carry the
    // signal answers in its own time, and the reader who pressed Stop is
    // owed the box back now.
    setDraftingReply(false);
    setAiReplyWorking(null);
    setAiReplyNotes(null);
  }, []);

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

  const setChatStyle = async (noQuote: boolean) => {
    setChatStyleBusy(true);
    try {
      const json = await apiJson<{ chat: MailChatRef }>(
        "/api/mail/chat-style",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account,
            threadId,
            noQuote,
            title: counterpartName || chatTitleFromCounterpart(
              counterpartName,
              counterpartEmail
            ),
            subject: thread.subject,
            counterpartName,
            counterpartEmail: counterpartEmail || undefined,
            participantEmails: [
              ...new Set(
                [
                  counterpartEmail,
                  ...thread.reply.to,
                  ...thread.reply.allTo,
                ].filter(Boolean)
              ),
            ],
            messageCount: thread.messages.length,
          }),
        }
      );
      setThread((current) =>
        current ? { ...current, chat: json.chat } : current
      );
      onChatPromoted(json.chat);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't update chat style"
      );
    } finally {
      setChatStyleBusy(false);
    }
  };

  /**
   * ✨: ask the planner what this thread changes, and show the proposals.
   * Nothing is written until the reader applies. The thread's participants,
   * the addresses in its text and, failing those, the AI's guess decide
   * which records it is about — so a forward from yourself works too.
   */
  /*
    The thread, read for the reader's own diary.

    Nothing to do with the CRM: no record is touched and no invitation is
    sent. The entries come back and the dialog is where they are approved,
    which is the same bargain the CRM proposal makes — the AI says what it
    found, the reader says which of it is true.
  */
  const proposeDiaryFromThread = async (hint?: string) => {
    if (diaryBusy) return;
    setDiaryBusy(true);
    const reading = toast.loading(t("diaryReading"));
    try {
      const res = await mailApiFetch("/api/mail/diary-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account, threadId: thread.threadId, hint }),
      });
      const json = (await res.json()) as DiaryProposal & { error?: string };
      if (!res.ok) throw new Error(json.error || t("couldNotReadDiary"));
      toast.dismiss(reading);
      setDiaryProposal({ entries: json.entries ?? [], target: json.target ?? null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("couldNotReadDiary"), {
        id: reading,
      });
    } finally {
      setDiaryBusy(false);
    }
  };

  const updateCrmFromThread = (hint?: string) => {
    if (updatingCrm) return;
    proposeCrmFromThread({
      account,
      threadId,
      hint,
      attachments: readableAttachments,
    });
  };

  /**
   * Draft this reply with the AI: the planner reads the thread, the CRM
   * records it matches and past mail with them, and answers a draft. The
   * draft replaces the box — after asking, if the reader had written
   * something — and the notes on it (what it drew on, what it did not know)
   * sit above the composer until dismissed. Nothing is stored or sent.
   */
  const draftReplyWithAi = async (hint: string) => {
    if (draftingReply || !threadId) return;
    /*
      What is already in the box is the brief.

      A reader who puts three bullets in and presses the button is saying
      what the reply has to say — so the notes go with the request and the
      draft writes them out. They used to be an obstacle: the button asked
      whether to throw them away, and then threw them away.

      Nothing is lost either way. The notes come back from the strip above
      the composer, which now holds them.
    */
    const notes = replyText.trim();
    const run = new AbortController();
    aiReplyRun.current?.abort();
    aiReplyRun.current = run;
    setDraftingReply(true);
    setAiReplyNotes(null);
    setAiReplyWorking("reading");
    try {
      // Two calls, as the CRM proposal does: the match is a second, the
      // model is the wait. The strip names the records it is drafting from
      // as soon as the first answers, so the spinner has something to say.
      // A match that fails costs only the label — the draft still runs.
      try {
        const matched = await apiJson<Partial<AiReplyDraftResult>>("/api/mail/reply-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, threadId, phase: "match" }),
          signal: run.signal,
        });
        if (run.signal.aborted) return;
        if (matched.scenario) {
          setAiReplyNotes({
            body: "",
            scenario: matched.scenario,
            usedRecords: matched.usedRecords ?? [],
            gaps: [],
          });
        }
      } catch {
        // Keep the plain "reading" line and go on to the draft.
      }
      if (run.signal.aborted) return;
      setAiReplyWorking("writing");
      const result = await apiJson<Partial<AiReplyDraftResult>>("/api/mail/reply-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account,
          threadId,
          hint: hint || undefined,
          notes: notes || undefined,
        }),
        signal: run.signal,
      });
      // Called off while the model was writing: the draft that arrives now
      // belongs to nobody, and must not land in the box.
      if (run.signal.aborted) return;
      // A transport that does not know the path answers something empty
      // rather than failing; say so instead of crashing on the shape.
      if (typeof result.body !== "string" || !result.body.trim()) {
        throw new Error(t("aiReplyEmpty"));
      }
      setReply(plainTextToEditorHtml(result.body));
      // The editor takes its words from defaultValue when it mounts, so a
      // new draft means a new editor — the same way an imported provider
      // draft arrives.
      setEditorKey((k) => k + 1);
      setAiReplyNotes({
        body: result.body,
        ...(result.subject ? { subject: result.subject } : {}),
        scenario: result.scenario ?? "ongoing",
        usedRecords: result.usedRecords ?? [],
        gaps: result.gaps ?? [],
        // What the reader had written, so the strip can hand it back. A
        // draft written from notes is still a draft somebody may not want.
        ...(notes ? { brief: notes } : {}),
      });
    } catch (err) {
      // Stopped, not failed: the reader called it off, and has nothing to
      // read about a thing they asked to end.
      if (run.signal.aborted) return;
      // No half-written strip left over a composer that never got a draft.
      setAiReplyNotes(null);
      toast.error(
        `${t("aiReplyFailed")}: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      // Only the run that is still the current one clears the spinner. A
      // stopped run's own ending must not take down the one after it.
      if (aiReplyRun.current === run) {
        aiReplyRun.current = null;
        setDraftingReply(false);
        setAiReplyWorking(null);
      }
    }
  };

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
      style={floating ? cardStyle : undefined}
      className={cn(
        "mail-thread-surface relative flex flex-col bg-[var(--mail-thread)]",
        floating
          ? // The card. It has a width of its own, so the composer inside
            // measures a pane that width and lays itself out to it — the
            // same rules it follows when a pane is this narrow.
            "mail-floating-reply fixed bottom-4 right-6 z-40 max-h-[calc(100vh-2rem)] w-[34rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-stone-300 shadow-2xl"
          : "min-h-0 flex-1"
      )}
    >
      {floating ? (
        /*
          The card is made larger from the edges that can move. It stands in
          the bottom right corner, so those are the left edge, the top edge
          and the corner between them. Thin strips over the border, above
          the heading: the heading carries the card, and a press on its top
          few pixels must size it, not move it.
        */
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("dragToResize")}
            title={t("dragToResize")}
            onPointerDown={startCardResize("left")}
            className="absolute inset-y-0 left-0 z-20 w-1.5 cursor-ew-resize touch-none"
          />
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={t("dragToResize")}
            title={t("dragToResize")}
            onPointerDown={startCardResize("top")}
            className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-ns-resize touch-none"
          />
          {/* Large enough to reach past the rounded corner, which cuts the
              first few pixels of it away. */}
          <div
            aria-hidden
            onPointerDown={startCardResize("top-left")}
            className="absolute left-0 top-0 z-30 h-5 w-5 cursor-nwse-resize touch-none"
          />
        </>
      ) : null}
      {floating ? (
        <div
          className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] px-3 py-2 active:cursor-grabbing"
          onPointerDown={startDrag}
        >
          {/*
            The subject is a name, not a button. It was one, and a press took
            the reply back to the thread — so a click on the heading, which is
            also what carries the card, put the card away. The button beside it
            is the way back.
          */}
          <span
            className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800"
            title={thread?.subject || undefined}
          >
            {thread?.subject || "…"}
          </span>
          <button
            type="button"
            title={`${t("backToThread")} (${formatShortcut(shortcuts.floatMessage)})`}
            aria-label={`${t("backToThread")} (${formatShortcut(shortcuts.floatMessage)})`}
            className="shrink-0 rounded-md p-1 text-stone-500 hover:bg-stone-200/70 hover:text-stone-800"
            onClick={onUnfloatReply}
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t("close")}
            aria-label={t("close")}
            className="shrink-0 rounded-md p-1 text-stone-500 hover:bg-stone-200/70 hover:text-stone-800"
            onClick={onFloatReply}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
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
          <ThreadAction
            label={`${t("actionArchive")} (${formatShortcut(
              shortcuts.archive
            )})`}
            icon={Archive}
            onClick={onArchive}
          />
          {/* Already in the bin: the useful action is getting it out again.
              There is no permanent delete here on purpose — it is the one
              action with nothing behind it. */}
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
               is what the box needed and all the room there is to give. */
            compactComposer ? "pl-0 pr-2" : fullWidthComposer ? "px-3" : "px-8",
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
                compactComposer || fullWidthComposer
                  ? "100%"
                  : `${composerWidthPct}%`,
              maxWidth: "100%",
            }}
          >
          {/* No edges to drag while the box is the whole pane: there is
              nowhere for either to go, and a handle that cannot move is a
              handle that reads as broken. */}
          {compactComposer || fullWidthComposer ? null : (
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
                onClick={floatReply}
              >
                <PictureInPicture2 className="h-4 w-4" />
              </button>
            ) : null}
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
          </div>
            {aiReplyNotes || aiReplyWorking ? (
              <AiReplyNotes
                result={aiReplyNotes}
                working={aiReplyWorking}
                onStop={stopAiReply}
                onRestoreBrief={(brief) => {
                  setReply(plainTextToEditorHtml(brief));
                  setEditorKey((k) => k + 1);
                  setAiReplyNotes(null);
                }}
                onDismiss={() => setAiReplyNotes(null)}
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
                      void setForwardIncludeFiles(e.target.checked)
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
          onClose={() => setForgottenAttachment(null)}
          footer={
            <>
              <button
                type="button"
                className={settingsSecondaryButton}
                onClick={() => setForgottenAttachment(null)}
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
                  setForgottenAttachment(null);
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
          onClose={() => setDiaryProposal(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * How much of the reading pane the reply box may take before it scrolls
 * inside itself, as a percentage. The rest is the thread, and the send row.
 */
const COMPOSER_MAX_SHARE = 45;

