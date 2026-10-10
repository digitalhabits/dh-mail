"use client";

/**
 * One message in a thread.
 *
 * Header, body, attachments, and the per-sender choice about remote images.
 * That choice is kept in localStorage and announced with an event, so every
 * message already on screen from the same sender follows it at once.
 */

import * as React from "react";

import { paintSearchHits } from "@/lib/mail/search-highlight";
import { applyStoredBubbleWidth } from "@/lib/mail/bubble-width";
import { BubbleWidthHandle } from "@/components/mail/bubble-width-handle";

applyStoredBubbleWidth();
import { Clock } from "lucide-react";
import {
  MessageContextMenu,
  MessageHoverActions,
  type MessageMenuActions,
} from "@/components/mail/message-actions";

import { LinkifiedText } from "@/components/LinkifiedText";
import {
  MessageCalendarInvite,
  nonCalendarAttachments,
} from "@/components/mail/CalendarInviteCard";
import { EmailHtmlView } from "@/components/mail/EmailHtmlView";
import { useAddressMenu } from "@/components/mail/AddressMenu";
import { htmlHasRemoteImages, stripQuotedHtml } from "@/lib/mail/email-html";
import {
  htmlSegments,
  stripRepeatedSignatureHtml,
  stripRepeatedSignatureText,
  textSegments,
} from "@/lib/mail/repeat-signature";
import { MessageAttachmentChips } from "@/components/mail/MailAttachments";
import {
  savableAttachments,
  saveMessageAttachments,
} from "@/lib/mail/attachment-save";
import { printMailMessages } from "@/components/mail/print-mail";
import {
  NO_MESSAGE_META,
  type MessageMeta,
} from "@/lib/mail/message-meta";
import { doubleClickOnText, isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import { formatEmailBody, stripQuotedReplies } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { messageStamp } from "@/lib/mail/date-format";
import { useMailColorMode } from "@/lib/mail/theme";
import type { MailAttachment } from "@/lib/mail/types";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import type { MailT } from "@/lib/mail/i18n-strings";

const MAIL_IMAGES_SENDER_KEY = "redd-plan-mail-images-senders";
/** Bubbles in the open thread listen so "Load images" applies to every message from that sender. */
const MAIL_IMAGES_CHANGED_EVENT = "redd-plan-mail-images-changed";
/** Explicit per-sender image choices; senders not present use the tab default. */
export function readImageChoices(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(MAIL_IMAGES_SENDER_KEY) ?? "{}"
    );
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}
function rememberImageChoice(sender: string, allowed: boolean): void {
  try {
    const choices = readImageChoices();
    delete choices[sender];
    choices[sender] = allowed; // re-insert last, so the cap drops oldest first
    window.localStorage.setItem(
      MAIL_IMAGES_SENDER_KEY,
      JSON.stringify(Object.fromEntries(Object.entries(choices).slice(-500)))
    );
  } catch {
    // Quota/availability issues just mean the choice isn't remembered.
  }
  window.dispatchEvent(
    new CustomEvent(MAIL_IMAGES_CHANGED_EVENT, {
      detail: { sender, allowed },
    })
  );
}
export function messageSnippet(message: {
  bodyText: string;
  snippet?: string;
}): string {
  const full = decodeHtmlEntities(formatEmailBody(message.bodyText)).trim();
  const stripped = stripQuotedReplies(full);
  const text = (stripped || full).replace(/\s+/g, " ").trim();
  return text;
}
/** Who a bubble names as its sender, and how. */
function bubbleSender(
  message: BubbleMessage,
  account: string
): { displayName: string; fromEmail: string; fromLabel: string } {
  const displayName = message.own
    ? message.fromName || "You"
    : message.fromName || message.fromEmail;
  // Even own messages show the mailbox that actually sent them — mail from
  // another of our aliases must not masquerade as the connected account.
  const fromEmail = message.fromEmail || (message.own ? account : "");
  /**
   * The name only when it says something the address does not.
   *
   * Mail from an address with no name against it arrived named by its own
   * address, and the line read `someone@example.com (someone@example.com)`.
   */
  const fromLabel =
    message.fromName &&
    message.fromName.trim().toLowerCase() !== fromEmail.trim().toLowerCase()
      ? `${message.fromName} <${fromEmail}>`
      : fromEmail;
  return { displayName, fromEmail, fromLabel };
}

/**
 * The line over a message, and the details under its menu. See the notes
 * where MailBubble reads them.
 */
function bubbleMetaLines({
  message,
  account,
  displayName,
  fromLabel,
  stamp,
  metaNeeds,
  t,
}: {
  message: BubbleMessage;
  account: string;
  displayName: string;
  fromLabel: string;
  stamp: string;
  metaNeeds: MessageMeta;
  t: MailT;
}): { metaHeadline: string; metaDetails: string } {
  const changeNotes = [
    metaNeeds.added.length ? `Added ${metaNeeds.added.join(", ")}` : "",
    metaNeeds.removed.length ? `Removed ${metaNeeds.removed.join(", ")}` : "",
  ].filter(Boolean);
  /**
   * Our own messages are named by address, not by "You".
   *
   * The only reason to name ourselves is that the message went out from
   * another of our addresses, and "You" is the one answer that does not say
   * which. Somebody else is named the way they signed the message.
   */
  const senderLabel = message.own
    ? message.fromEmail || account
    : displayName;
  const metaHeadline = [metaNeeds.sender ? senderLabel : "", ...changeNotes]
    .filter(Boolean)
    .join(" · ");
  const metaDetails = [
    stamp,
    fromLabel ? `${t("fieldFromColon")} ${fromLabel}` : "",
    message.toEmails?.length
      ? `${t("fieldToColon")} ${message.toEmails.join(", ")}`
      : "",
    message.ccEmails?.length
      ? `${t("fieldCcColon")} ${message.ccEmails.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { metaHeadline, metaDetails };
}

/** Whether a message of ours is on its way, or failed to go. */
type BubbleSendStatus = OutboxStatus | undefined;

/** Under a message of ours on its way: "Sending", or "Not sent" with Retry and Edit. */
function SendStatusCaption({
  status,
  onRetry,
  onEdit,
}: {
  status: BubbleSendStatus;
  onRetry?: () => void;
  onEdit?: () => void;
}) {
  const t = useMailT();
  return status === "sending" ? (
    <div className="mt-1 flex items-center gap-1 px-1 text-[11px] text-stone-400">
      <Clock className="h-3 w-3 shrink-0" aria-hidden />
      <span>{t("sending")}</span>
    </div>
  ) : status === "failed" ? (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[11px] text-red-600/90">
      <span>{t("notSent")}</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        className="font-medium underline-offset-2 hover:underline"
        onClick={onRetry}
      >
        {t("retry")}
      </button>
      <span aria-hidden>·</span>
      <button
        type="button"
        className="font-medium underline-offset-2 hover:underline"
        onClick={onEdit}
      >
        {t("edit")}
      </button>
    </div>
  ) : null;
}

/** The message a bubble draws. */
type BubbleMessage = {
  id: string;
  fromName: string;
  fromEmail: string;
  toEmails?: string[];
  ccEmails?: string[];
  sentAt: string | null;
  bodyText: string;
  bodyHtml?: string;
  inlineImages?: Record<string, string>;
  attachments?: MailAttachment[];
  own: boolean;
};

export function MailBubble({
  message,
  account,
  subject,
  defaultAllowImages,
  sendStatus,
  zoom = 1,
  onRetrySend,
  onEditSend,
  onPreviewAttachment,
  showMeta = true,
  earlierFromSender,
  meta: metaNeeds = NO_MESSAGE_META,
  timeLabel,
  onReact,
  onReplyTo,
  onForward,
  onEditAsNew,
  onShowOriginal,
  showPrint = true,
  highlight,
}: {
  /** Search words to paint in the message: the one a search landed on. */
  highlight?: string[];
  message: BubbleMessage;
  account: string;
  /** Thread subject, used as the title when this message is printed. */
  subject?: string;
  /** Tab default: known contacts load images; unknown senders stay blocked. */
  defaultAllowImages: boolean;
  /** Optimistic send: in flight to the provider, or rejected. */
  sendStatus?: OutboxStatus;
  /** Pane zoom, forwarded into the email iframe (CSS zoom can't cross it). */
  zoom?: number;
  onRetrySend?: () => void;
  onEditSend?: () => void;
  onPreviewAttachment: (attachment: MailAttachment) => void;
  /**
   * The actions that appear beside a message on hover.
   *
   * Each is optional and each control only appears when its handler does.
   * The chat window and the reading pane can do different things with a
   * message, and offering an action that opens nothing is worse than not
   * offering it.
   */
  onReact?: (emoji: string) => void;
  onReplyTo?: () => void;
  onForward?: () => void;
  /**
   * Copy this message into a new compose, out of the thread.
   *
   * The list row does the same for the first own mail. This is how a
   * later one is picked.
   */
  onEditAsNew?: () => void;
  /**
   * The line above the bubble: who sent it, when, and the controls.
   *
   * Off in a chat window, where the window is one conversation with one
   * person and every message would repeat their address over itself. The
   * time moves inside the bubble instead — see `timeLabel`.
   */
  showMeta?: boolean;
  /**
   * The same sender's previous message in this thread, if any. Given, this
   * message's repeated signature goes behind the "…" fold.
   */
  earlierFromSender?: { bodyText: string; bodyHtml?: string | null };
  /**
   * What that line still has to say, worked out against the message before it.
   *
   * Left off, it says nothing and stays hidden: the sender is asked for under
   * the message's own menu instead. See `lib/mail/message-meta`.
   */
  meta?: MessageMeta;
  /** The clock time, shown in the corner of the bubble. */
  timeLabel?: string;
  /**
   * Pack pictures into a grid rather than listing them as cards.
   *
   * For the chat window, where three photographs listed as cards with their
   * file names under them read as a paragraph of file names.
   */
  /**
   * Whether to offer Print on the message.
   *
   * Off in the chat window: a floating panel is not where anybody reaches for
   * a printer, and the room beside the sender is better spent.
   */
  showPrint?: boolean;
  /** Open the message's source over the thread — Gmail's "Show original". */
  onShowOriginal?: () => void;
}) {
  const t = useMailT();
  const [showQuoted, setShowQuoted] = React.useState(false);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [loadImagesByDefault] = useLoadImagesByDefault();
  // Per-sender override used only when "Load images by default" is off.
  const senderKey = message.fromEmail.trim().toLowerCase();
  const [senderAllowImages, setSenderAllowImages] = React.useState(
    () => readImageChoices()[senderKey] ?? defaultAllowImages
  );
  // Sibling bubbles mount with their own state; keep them in sync when any
  // one of them toggles Load/Hide images for this sender.
  React.useEffect(() => {
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<{ sender: string; allowed: boolean }>)
        .detail;
      if (detail?.sender === senderKey) setSenderAllowImages(detail.allowed);
    };
    window.addEventListener(MAIL_IMAGES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(MAIL_IMAGES_CHANGED_EVENT, onChange);
  }, [senderKey]);
  React.useEffect(() => {
    setSenderAllowImages(readImageChoices()[senderKey] ?? defaultAllowImages);
  }, [senderKey, defaultAllowImages]);

  const bubbleRef = React.useRef<HTMLDivElement>(null);
  /** The bubble the hover rail hangs off; the row measures from it. */
  const railAnchorRef = React.useRef<HTMLDivElement>(null);
  /** Thread-pane scrollTop captured when expanding the quote. */
  const scrollBeforeExpand = React.useRef<number | null>(null);
  const allowImages = loadImagesByDefault || senderAllowImages;
  const toggleImages = () => {
    const next = !senderAllowImages;
    setSenderAllowImages(next);
    rememberImageChoice(senderKey, next);
  };
  const fullBody = decodeHtmlEntities(formatEmailBody(message.bodyText)).trim();
  /**
   * The same sender's earlier message in this thread, as what its own part
   * says (history taken off): a later message's signature is what it shares
   * with that, and goes behind the "…" with the history. See
   * lib/mail/repeat-signature.
   */
  const earlierSegments = React.useMemo(() => {
    if (!earlierFromSender) return null;
    if (earlierFromSender.bodyHtml) {
      return htmlSegments(stripQuotedHtml(earlierFromSender.bodyHtml, { keepForwarded: true }).html);
    }
    return textSegments(
      stripQuotedReplies(decodeHtmlEntities(formatEmailBody(earlierFromSender.bodyText)).trim())
    );
  }, [earlierFromSender]);
  const withoutHistory = stripQuotedReplies(fullBody);
  const stripped = earlierSegments ? stripRepeatedSignatureText(withoutHistory, earlierSegments) : withoutHistory;
  const hasHidden = stripped.length < fullBody.length;

  // Same idea in the rich view: quoted history (and a repeated signature)
  // collapse behind the "…" pill.
  const htmlSplit = React.useMemo(() => {
    if (!message.bodyHtml) return null;
    // A forward shows the forwarded mail; its own history is what folds.
    const history = stripQuotedHtml(message.bodyHtml, { keepForwarded: true });
    if (!earlierSegments) return history;
    const signature = stripRepeatedSignatureHtml(history.html, earlierSegments);
    return signature.changed ? { html: signature.html, hadQuote: true } : history;
  }, [message.bodyHtml, earlierSegments]);

  const showHtml = Boolean(message.bodyHtml);
  const hasImages = message.bodyHtml ? htmlHasRemoteImages(message.bodyHtml) : false;

  /** The HTML that is actually on screen — quoted history in or out. */
  const shownHtml = showHtml
    ? showQuoted || !htmlSplit?.hadQuote
      ? message.bodyHtml!
      : htmlSplit.html
    : "";

  /**
   * A message read in the dark.
   *
   * A sender's HTML is written for a white page. The first answer here was
   * to give it one — every message on a lit slab, and later only the ones
   * that painted a page of their own. But a page of one's own is what a
   * newsletter is, and it is what most mail from a company is, so the
   * reader turned the lights down and got a white rectangle for nearly
   * everything anyone sent them.
   *
   * What every other client does instead is re-light the message: dark
   * words come up light, light backgrounds go down dark, and the colours
   * that read either way are left. That is `recolorEmailForDark`, in the
   * frame, and it means every HTML message sits on the card. There is no
   * white sheet any more.
   */
  const colorMode = useMailColorMode();
  const readInTheDark = colorMode === "dark" && showHtml;

  /**
   * Print this message alone.
   *
   * It prints the body that is on screen: quoted history is included only
   * when the reader opened it, and remote images only when they loaded them.
   */
  function printThisMessage() {
    const bodyHtml = message.bodyHtml
      ? showQuoted || !htmlSplit?.hadQuote
        ? message.bodyHtml
        : htmlSplit.html
      : undefined;
    printMailMessages({
      subject: subject ?? "",
      messages: [
        {
          ...message,
          bodyHtml,
          bodyText: showQuoted || !hasHidden ? fullBody : stripped,
          allowRemoteImages: allowImages,
        },
      ],
    });
  }


  /** Expand/collapse quoted history, restoring scroll when collapsing. */
  const toggleQuoted = () => {
    const scroller = nearestScrollParent(bubbleRef.current);
    if (!showQuoted) {
      if (scroller) scrollBeforeExpand.current = scroller.scrollTop;
      setShowQuoted(true);
      return;
    }
    const saved = scrollBeforeExpand.current;
    scrollBeforeExpand.current = null;
    setShowQuoted(false);
    if (!scroller || saved == null) return;
    // HTML iframes resize async after the srcDoc swap — keep pinning until
    // the bubble's height settles so we don't land in empty space below.
    const restore = () => {
      scroller.scrollTop = saved;
    };
    requestAnimationFrame(() => {
      restore();
      const root = bubbleRef.current;
      if (!root) return;
      const ro = new ResizeObserver(restore);
      ro.observe(root);
      window.setTimeout(() => ro.disconnect(), 600);
    });
  };

  const sendingOut = sendStatus === "sending";
  const failedOut = sendStatus === "failed";
  const { displayName, fromLabel } = bubbleSender(message, account);
  /** Nothing to stamp until it has gone. */
  const stamp = sendingOut || failedOut ? "" : messageStamp(message.sentAt);

  const statusCaption = (
    <SendStatusCaption
      status={sendStatus}
      onRetry={onRetrySend}
      onEdit={onEditSend}
    />
  );

  const [failedCalendarIds, setFailedCalendarIds] = React.useState(
    () => new Set<string>()
  );
  const fileAttachments = nonCalendarAttachments(
    message.attachments,
    failedCalendarIds
  );
  /* What the menu can save: the tiles, less any file still on its way out.
     A calendar invite is not among them — it has its own "Download event". */
  const savableFiles = savableAttachments(fileAttachments);
  const noteCalendarUnavailable = React.useCallback((attachmentId: string) => {
    setFailedCalendarIds((prev) => {
      if (prev.has(attachmentId)) return prev;
      const next = new Set(prev);
      next.add(attachmentId);
      return next;
    });
  }, []);

  /**
   * The time, in the corner of the bubble.
   *
   * Floated and written after the words, so it settles on the right of the
   * last line — a short message keeps it beside the words instead of
   * spending a whole line on four digits. Declared before them it floated to
   * the top corner, which is not where a chat puts it.
   */
  const timeCornerClass = cn(
    "select-none text-[10px] leading-none tabular-nums",
    message.own ? "text-teal-800/60" : "text-stone-400"
  );
  const timeCorner = timeLabel ? (
    <span className={cn("float-right ml-2 mt-1", timeCornerClass)}>
      {timeLabel}
    </span>
  ) : null;


  /**
   * The line above the bubble, when there is one.
   *
   * `metaHeadline` is what the message before it did not already say: a
   * different person talking, or somebody added to or dropped from the
   * message. Most messages in most threads have neither, and then there is
   * no line at all.
   *
   * `metaDetails` is everything, one thing per line and each line labelled:
   * when it was sent, who from, who to. Shown only when the reader asks for
   * it under the message's own menu. It ran as one sentence before, which
   * put the sender twice at the front — once as a name, once in brackets as
   * the address it was named after — and left the reader to find the time
   * at the end of it.
   */
  const { metaHeadline, metaDetails } = bubbleMetaLines({
    message,
    account,
    displayName,
    fromLabel,
    stamp,
    metaNeeds,
    t,
  });
  const canLoadImages =
    !loadImagesByDefault && showHtml && hasImages && !sendingOut && !failedOut;
  const showMetaRow =
    showMeta && (detailsOpen ? true : Boolean(metaHeadline) || canLoadImages);

  /**
   * Double-clicking the message is the same answer as the menu's "Details".
   *
   * Only where there is something to tell: `showMeta` is what decides
   * whether the menu offers the item at all, and a bubble that cannot
   * answer must not swallow the double click either.
   *
   * Two clicks, not one. A single click lands on a message all the time:
   * to bring the pane forward, to put the cursor somewhere, to start a
   * drag across the words. When one click was the toggle, the line above
   * the message came and went with every one of them. A double click is
   * asked for on purpose. Anything that is its own control keeps its.
   */
  const toggleDetailsFromBody = React.useCallback(() => {
    if (!showMeta) return;
    setDetailsOpen((open) => !open);
  }, [showMeta]);

  const onBubbleDoubleClick = (event: React.MouseEvent) => {
    if (isInteractiveDoubleClickTarget(event.target)) return;
    if (doubleClickOnText(event)) return;
    // The word WebKit selected beside the click is not what was meant.
    window.getSelection()?.removeAllRanges();
    toggleDetailsFromBody();
  };


  /** To and Cc as written, each address once, for "Copy recipients". */
  const messageRecipients = React.useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of [...(message.toEmails ?? []), ...(message.ccEmails ?? [])]) {
      const email = raw.trim();
      const key = email.toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
    return out;
  }, [message.toEmails, message.ccEmails]);

  const outgoing = sendingOut || failedOut;
  const reactAction = outgoing ? undefined : onReact;
  const replyAction = outgoing ? undefined : onReplyTo;
  /** The "…" menu's rows, in the rail and on a right-click alike. */
  const menuActions: MessageMenuActions = {
    bodyText: message.bodyText,
    recipients: messageRecipients,
    onForward: outgoing ? undefined : onForward,
    onEditAsNew: outgoing ? undefined : onEditAsNew,
    onDownloadAttachments: savableFiles.length
      ? () =>
          void saveMessageAttachments({
            account,
            messageId: message.id,
            attachments: savableFiles,
          })
      : undefined,
    attachmentCount: savableFiles.length,
    onPrint: showPrint ? printThisMessage : undefined,
    onShowOriginal: outgoing ? undefined : onShowOriginal,
    // Who it was from and who it went to, for the message where the line
    // above says nothing because nothing about it changed.
    onToggleDetails: showMeta ? () => setDetailsOpen((open) => !open) : undefined,
    detailsOpen,
  };

  /*
    A right-click on the message: its own menu (react, reply, and the "…"
    rows) in place of WebKit's. A link, a field or a name with a menu of its
    own keeps that menu. The selection is read on mousedown: WebKit selects
    the word under a right-click before the menu event, and that word is
    not something the reader chose.
  */
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number; selectedText: string } | null>(null);
  const selectionBeforeMenu = React.useRef<Range[]>([]);
  const onBubbleMouseDown = (event: React.MouseEvent) => {
    if (!(event.button === 2 || (event.button === 0 && event.ctrlKey))) return;
    const sel = window.getSelection();
    selectionBeforeMenu.current = [];
    if (!sel || sel.isCollapsed) return;
    for (let i = 0; i < sel.rangeCount; i += 1) selectionBeforeMenu.current.push(sel.getRangeAt(i).cloneRange());
  };
  const onBubbleContextMenu = (event: React.MouseEvent) => {
    if (event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("a[href], input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    const before = selectionBeforeMenu.current;
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      for (const range of before) sel.addRange(range);
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      selectedText: before.map((range) => range.toString()).join(" ").trim(),
    });
  };

  return (
    // The row the message sits in, and what the pointer has to be on for
    // the actions beside it to show. It used to be the bubble itself, which
    // ends at the edge of the words: the gutter the actions stand in was
    // outside it, and so was the hair of space between the two, so crossing
    // to them dismissed them.
    <div
      className="group/bubble flex w-full min-w-0"
      onPointerEnter={(e) =>
        measureRailRoom(e.currentTarget, railAnchorRef.current, message.own, zoom)
      }
      onFocusCapture={(e) =>
        measureRailRoom(e.currentTarget, railAnchorRef.current, message.own, zoom)
      }
    >
    <div
      ref={bubbleRef}
      className={cn(
        // How wide the column may get, and the gutter that leaves beside
        // it, are one rule on `.mail-bubble-column` — see mail.css.
        "mail-bubble-column flex w-full min-w-0 flex-col",
        // Auto margins, not `self-end`. `self-*` needs a flex parent, and a
        // bubble is not always given one — in the chat window each sits in a
        // plain block, so an open message ignored it and hugged the left
        // while the folded ones around it sat right where they belonged.
        message.own ? "ml-auto items-end" : "mr-auto items-start"
      )}
    >
      {showMetaRow ? (
      <BubbleMetaRow
        message={message}
        detailsOpen={detailsOpen}
        metaHeadline={metaHeadline}
        metaDetails={metaDetails}
        canLoadImages={canLoadImages}
        toggleImages={toggleImages}
        allowImages={allowImages}
      />
      ) : null}
      {/* Anchored to the bubble rather than to the column, so it lines up
          with the middle of the words and not with the middle of the line of
          meta above them as well. */}
      <div
        ref={railAnchorRef}
        className={cn(
          "relative min-w-0",
          // A message sizes to its words, the way a messaging app does — a
          // three-word reply in a full-width bubble looks like a form. An
          // HTML message does it through its frame, which measures how
          // wide its content wants to be and says so — see EmailHtmlView.
          "w-fit max-w-full"
        )}
      >
      {/* Not in a chat window: there the window's own width is the measure. */}
      {showMeta ? <BubbleWidthHandle own={message.own} zoom={zoom} boxRef={bubbleRef} /> : null}
      <MessageHoverActions
        own={message.own}
        onReact={reactAction}
        onReplyTo={replyAction}
        {...menuActions}
      />
      {contextMenu ? (
        <MessageContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedText={contextMenu.selectedText}
          onReact={reactAction}
          onReplyTo={replyAction}
          actions={menuActions}
          onDismiss={() => setContextMenu(null)}
        />
      ) : null}
      <div
        onDoubleClick={onBubbleDoubleClick}
        onMouseDown={onBubbleMouseDown}
        onContextMenu={onBubbleContextMenu}
        className={cn(
          "rounded-2xl transition-[background-color,border-color,color] duration-200",
          // One corner tighter, on the speaker's own side. It is barely a
          // shape at all, and it is enough to say who is talking without a
          // tail or a name over every message.
          message.own ? "rounded-br-md" : "rounded-bl-md",
          "relative",
          "w-fit max-w-full",
          showHtml ? undefined : "px-3 py-2",
          sendingOut &&
            "border border-dashed border-stone-300 bg-white text-stone-500",
          failedOut &&
            "border border-red-300 bg-red-50/50 text-stone-800",
          !sendingOut &&
            !failedOut &&
            (message.own
              ? "border border-[var(--mail-bubble-own-border)] bg-[var(--mail-bubble-own)]"
              : "mail-bubble-card border border-[var(--mail-bubble-other-border)] bg-[var(--mail-bubble-other)] shadow-sm")
        )}
      >
        {message.attachments?.length ? (
          <BubbleInvites
            showHtml={showHtml}
            account={account}
            message={message}
            noteCalendarUnavailable={noteCalendarUnavailable}
          />
        ) : null}
        {/* Above the body, not under it. At the bottom of a long message the
            files are past the fold, and the reader has to scroll a message
            they may not want to read to find out one is attached. */}
        {fileAttachments.length ? (
          <BubbleFiles
            showHtml={showHtml}
            account={account}
            message={message}
            fileAttachments={fileAttachments}
            onPreviewAttachment={onPreviewAttachment}
          />
        ) : null}
        <BubbleBody
          showHtml={showHtml}
          sendingOut={sendingOut}
          timeCorner={timeCorner}
          toggleDetailsFromBody={toggleDetailsFromBody}
          onFrameContextMenu={(x, y, selectedText) => setContextMenu({ x, y, selectedText })}
          shownHtml={shownHtml}
          message={message}
          allowImages={allowImages}
          zoom={zoom}
          readInTheDark={readInTheDark}
          htmlSplit={htmlSplit}
          showQuoted={showQuoted}
          t={t}
          toggleQuoted={toggleQuoted}
          fullBody={fullBody}
          stripped={stripped}
          hasHidden={hasHidden}
          highlight={highlight}
        />
      </div>
      </div>
      {statusCaption}
    </div>
    </div>
  );
}

/** Closest ancestor that clips what crosses its edge, scrolling or not. */
function nearestClipParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX !== "visible" || overflowY !== "visible") return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Tell the row how much room the rail has on its side of the bubble, as a
 * CSS variable the rail positions itself from. Measured when the pointer
 * arrives rather than watched, because that is the only time it shows.
 * Rects come back in zoomed pixels and the variable is read inside the
 * zoom, so it is divided back out.
 */
function measureRailRoom(
  row: HTMLElement,
  anchor: HTMLElement | null,
  own: boolean,
  zoom: number
): void {
  const clip = anchor ? nearestClipParent(row) : null;
  if (!anchor || !clip) {
    row.style.removeProperty("--mail-rail-room");
    return;
  }
  const a = anchor.getBoundingClientRect();
  const c = clip.getBoundingClientRect();
  const room = own
    ? a.left - (c.left + clip.clientLeft)
    : c.right - clip.clientLeft - a.right;
  row.style.setProperty(
    "--mail-rail-room",
    `${Math.max(0, Math.floor(room / (zoom || 1)))}px`
  );
}

/** Closest ancestor that actually scrolls (the thread pane). */
export function nearestScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

/** In-flight or failed optimistic send — drives bubble chrome + captions. */
export type OutboxStatus = "sending" | "failed";
export function useLoadImagesByDefault(): [boolean, (next: boolean) => void] {
  const value = React.useSyncExternalStore(
    subscribeLoadImagesByDefault,
    readLoadImagesByDefault,
    () => true
  );
  const update = React.useCallback((next: boolean) => {
    try {
      localStorage.setItem(MAIL_LOAD_IMAGES_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
    window.dispatchEvent(new Event(MAIL_LOAD_IMAGES_EVENT));
  }, []);
  return [value, update];
}

const MAIL_LOAD_IMAGES_KEY = "redd-plan-mail-load-images";
const MAIL_LOAD_IMAGES_EVENT = "redd-plan-mail-load-images-changed";
/** Remote images load for every sender unless the user turns this off. */
function readLoadImagesByDefault(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = localStorage.getItem(MAIL_LOAD_IMAGES_KEY);
    if (stored === "0" || stored === "false") return false;
    if (stored === "1" || stored === "true") return true;
  } catch {
    /* private mode */
  }
  return true;
}
function subscribeLoadImagesByDefault(onChange: () => void): () => void {
  window.addEventListener(MAIL_LOAD_IMAGES_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(MAIL_LOAD_IMAGES_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Optimistic send bubble; in lib/mail/local-message, kept here for its importers. */
export { isPendingLocalMessage } from "@/lib/mail/local-message";

/**
 * The message's words: its html in a frame, or its text, with the quoted
 * history behind a toggle and the time in the corner. Always the whole
 * message: a long one used to be cut at 340px behind "Show full message",
 * which was one more click to read what had been opened to be read.
 */
function BubbleBody({
  showHtml,
  sendingOut,
  timeCorner,
  toggleDetailsFromBody,
  onFrameContextMenu,
  shownHtml,
  message,
  allowImages,
  zoom,
  readInTheDark,
  htmlSplit,
  showQuoted,
  t,
  toggleQuoted,
  fullBody,
  stripped,
  hasHidden,
  highlight,
}: {
  /** Search words to paint, in the frame or in the plain text. */
  highlight?: string[];
  showHtml: boolean;
  sendingOut: boolean;
  timeCorner: React.JSX.Element | null;
  toggleDetailsFromBody: () => void;
  /** A right-click in an HTML message's frame, at a point in the page. */
  onFrameContextMenu: (x: number, y: number, selectedText: string) => void;
  shownHtml: string;
  message: BubbleMessage;
  allowImages: boolean;
  zoom: number | undefined;
  readInTheDark: boolean;
  htmlSplit: { html: string; hadQuote: boolean; } | null;
  showQuoted: boolean;
  t: MailT;
  toggleQuoted: () => void;
  fullBody: string;
  stripped: string;
  hasHidden: boolean;
}) {
  /* The search words in a plain-text message, painted as in a frame. */
  const plainRef = React.useRef<HTMLParagraphElement>(null);
  React.useEffect(() => {
    const el = plainRef.current;
    if (showHtml || !el || !highlight?.length) return;
    return paintSearchHits(el, highlight);
  }, [highlight, showHtml, showQuoted, fullBody]);
  return (
    <div
      className={cn(
        "relative",
        showHtml && "overflow-hidden rounded-t-lg",

      )}
    >
      <div>
        {showHtml ? (
          <div
            className={cn(
              "relative",
              sendingOut && "opacity-60",
              /*
                No wrapper of ours around the sender's page.

                The mail is laid out exactly as it is in the light —
                same width, same left edge, same padding — and only its
                colours change, which the re-lighting does inside the
                frame. A sheet or an island here moved the words in from
                the edge and centred them, so switching theme moved the
                text about, and that is not what a theme is for.
              */
            )}
          >
            {/* A frame cannot be floated into, so the time sits over its
                bottom corner. The frame is the sender's own layout and
                ends in whitespace far more often than not. */}
            {timeCorner ? (
              <span className="pointer-events-none absolute bottom-1.5 right-3 z-10">
                {timeCorner}
              </span>
            ) : null}
            <EmailHtmlView
              onContentDoubleClick={toggleDetailsFromBody}
              onContentContextMenu={onFrameContextMenu}
              html={shownHtml}
              inlineImages={message.inlineImages}
              allowImages={allowImages}
              zoom={zoom}
              bodyColor={readInTheDark ? "#e2e9f0" : undefined}
              darkRecolor={readInTheDark}
              highlight={highlight}
            />
            {htmlSplit?.hadQuote ? (
              <button
                type="button"
                /* Up into the frame's own tail, which is empty by
                   construction: the frame carries 20pt of bottom padding
                   for the time to sit in, and the height it reports adds
                   a little more so a footer cannot clip. With the dots
                   here the time sits below the frame instead, so that
                   room is a hole, and this takes most of it back. */
                className="mx-3.5 -mt-4 mb-1.5 inline-flex h-3 items-center justify-center gap-[2.5px] rounded-full bg-stone-200/70 px-2 text-stone-600 hover:bg-stone-200"
                title={showQuoted ? t("hideQuotedText") : t("showQuotedText")}
                onClick={toggleQuoted}
              >
                <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
                <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
                <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <p
              ref={plainRef}
              className={cn(
                "whitespace-pre-wrap break-words text-sm",
                // The time is floated so that it settles beside the
                // last line rather than spending a line of its own.
                // A message with no words has no line for it to settle
                // on, and a box holding nothing but a float has no
                // height — so the time fell out of the bubble and sat
                // on its bottom edge. That happens on a message that
                // is only a picture, which is most of the pictures.
                // This gives the paragraph the float's height back.
                "after:block after:clear-both after:content-['']",
                sendingOut ? "text-stone-500" : "text-stone-800"
              )}
            >
              <LinkifiedText
                text={showQuoted ? fullBody : stripped}
                onEmailClick={requestMailComposeTo}
              />
              {timeCorner}
            </p>
            {hasHidden ? (
              <button
                type="button"
                className="mt-1 inline-flex h-3 items-center justify-center gap-[2.5px] rounded-full bg-stone-200/70 px-2 text-stone-600 hover:bg-stone-200"
                title={showQuoted ? t("hideQuotedText") : t("showQuotedText")}
                onClick={toggleQuoted}
              >
                <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
                <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
                <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The calendar invites a message carries, each as a card.
 */
function BubbleInvites({
  showHtml,
  account,
  message,
  noteCalendarUnavailable,
}: {
  showHtml: boolean;
  account: string;
  message: BubbleMessage;
  noteCalendarUnavailable: (attachmentId: string) => void;
}) {
  return (
    <div className={cn(showHtml ? "px-3.5 pt-3" : "pb-1")}>
      <MessageCalendarInvite
        account={account}
        messageId={message.id}
        attachments={message.attachments}
        onUnavailable={noteCalendarUnavailable}
      />
    </div>
  );
}

/**
 * The line over a message: who sent it or who was added and removed, the
 * details when asked for, and the offer to load its pictures.
 */
function BubbleMetaRow({
  message,
  detailsOpen,
  metaHeadline,
  metaDetails,
  canLoadImages,
  toggleImages,
  allowImages,
}: {
  message: BubbleMessage;
  detailsOpen: boolean;
  metaHeadline: string;
  metaDetails: string;
  canLoadImages: boolean;
  toggleImages: () => void;
  allowImages: boolean;
}) {
  // The addresses on the line answer a right-click as the thread's header
  // and the To field do: copy it, or write to it.
  const { openAddressMenu, addressMenu } = useAddressMenu();
  return (
    <div
      className={cn(
        "mb-1 flex w-full min-w-0 items-baseline gap-x-3 gap-y-1 px-1",
        message.own && "flex-row-reverse"
      )}
    >
      <p
        className={cn(
          "min-w-0 flex-1 text-[11px] text-stone-500",
          // Open on demand, the line is the answer to a question that was
          // just asked — so it wraps and shows all of it. Unasked for, it
          // is one short note beside a message and stays on its line.
          detailsOpen ? "whitespace-pre-line" : "truncate",
          message.own && "text-right"
        )}
        title={detailsOpen ? undefined : metaHeadline}
      >
        <WithAddressMenus
          text={detailsOpen ? metaDetails : metaHeadline}
          sender={message.own ? null : { name: message.fromName, email: message.fromEmail }}
          onAddressMenu={openAddressMenu}
        />
      </p>
      {addressMenu}
      {canLoadImages ? (
        <span className="flex shrink-0 items-baseline gap-2">
          <button
            type="button"
            className="text-[11px] text-stone-500 underline decoration-stone-400 underline-offset-2 hover:text-stone-700"
            onClick={toggleImages}
          >
            {allowImages ? "Hide images" : "Load images"}
          </button>
        </span>
      ) : null}
    </div>
  );
}

/** An address in a line of text, as the meta lines write them. */
const ADDRESS_IN_TEXT = /[^\s<>(),;:"']+@[^\s<>(),;:"']+\.[^\s<>(),;:"'.]+/g;

/**
 * A meta line, with each address in it a span that opens the address menu.
 * The sender's name, when the line starts with it rather than an address,
 * opens the menu for the sender's address.
 */
function WithAddressMenus({
  text,
  sender,
  onAddressMenu,
}: {
  text: string;
  sender: { name: string; email: string } | null;
  onAddressMenu: (e: React.MouseEvent, email: string, name?: string) => void;
}) {
  const parts: React.ReactNode[] = [];
  let rest = text;
  let key = 0;
  const name = sender?.name?.trim();
  if (name && sender?.email && !name.includes("@") && rest.startsWith(name)) {
    parts.push(
      <span key={key++} onContextMenu={(e) => onAddressMenu(e, sender.email, name)}>
        {name}
      </span>
    );
    rest = rest.slice(name.length);
  }
  let last = 0;
  for (const match of rest.matchAll(ADDRESS_IN_TEXT)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(rest.slice(last, at));
    const email = match[0];
    parts.push(
      <span key={key++} onContextMenu={(e) => onAddressMenu(e, email)}>
        {email}
      </span>
    );
    last = at + email.length;
  }
  if (last < rest.length) parts.push(rest.slice(last));
  return <>{parts}</>;
}

/**
 * The files on a message, as chips under the words.
 */
function BubbleFiles({
  showHtml,
  account,
  message,
  fileAttachments,
  onPreviewAttachment,
}: {
  showHtml: boolean;
  account: string;
  message: BubbleMessage;
  fileAttachments: MailAttachment[];
  onPreviewAttachment: (attachment: MailAttachment) => void;
}) {
  return (
    <div className={cn(showHtml ? "px-3.5 pt-3" : "pb-2")}>
      <MessageAttachmentChips
        account={account}
        messageId={message.id}
        attachments={fileAttachments}
        onPreview={onPreviewAttachment}
      />
    </div>
  );
}
