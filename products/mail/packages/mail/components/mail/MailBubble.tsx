"use client";

/**
 * One message in a thread.
 *
 * Header, body, attachments, and the per-sender choice about remote images.
 * That choice is kept in localStorage and announced with an event, so every
 * message already on screen from the same sender follows it at once.
 */

import * as React from "react";
import {
  Clock,
  Copy,
  CornerUpLeft,
  Forward,
  Info,
  MoreHorizontal,
  Printer,
  Code,
  SquarePen,
  Users,
} from "lucide-react";
import { toast } from "@/lib/mail/toast";

import {
  Popover,
  
  PopoverTrigger,
} from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { EmojiReactionButton } from "@/components/ui/EmojiPicker";

import { LinkifiedText } from "@/components/LinkifiedText";
import {
  MessageCalendarInvite,
  nonCalendarAttachments,
} from "@/components/mail/CalendarInviteCard";
import {
  EmailHtmlView,
  htmlHasRemoteImages,
  stripQuotedHtml,
} from "@/components/mail/EmailHtmlView";
import { MessageAttachmentChips } from "@/components/mail/MailAttachments";
import { printMailMessages } from "@/components/mail/print-mail";
import {
  NO_MESSAGE_META,
  type MessageMeta,
} from "@/lib/mail/message-meta";
import { isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { afterMailPaneSlide } from "@/lib/mail/pane-slide";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import { formatEmailBody, stripQuotedReplies } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { messageStamp } from "@/lib/mail/date-format";
import { useMailColorMode } from "@/lib/mail/theme";
import type { MailAttachment } from "@/lib/mail/types";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

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
const MESSAGE_BODY_CLAMP_PX = 340;
export function messageSnippet(message: {
  bodyText: string;
  snippet?: string;
}): string {
  const full = decodeHtmlEntities(formatEmailBody(message.bodyText)).trim();
  const stripped = stripQuotedReplies(full);
  const text = (stripped || full).replace(/\s+/g, " ").trim();
  return text;
}
/**
 * The actions that appear beside a message while the pointer is on it.
 *
 * In the gutter, on the side away from the sender, the way a chat app puts
 * them — so they never sit on top of the words. Nothing is shown until the
 * pointer arrives, and nothing is shown at all for a message still on its way
 * out or one that failed to send: neither can be reacted to or quoted yet.
 */
function MessageHoverActions({
  own,
  bodyText,
  recipients,
  onReact,
  onReplyTo,
  onForward,
  onEditAsNew,
  onPrint,
  onShowOriginal,
  onToggleDetails,
  detailsOpen,
}: {
  own: boolean;
  bodyText: string;
  /** The message's To and Cc addresses, for the clipboard. */
  recipients: string[];
  onReact?: (emoji: string) => void;
  onReplyTo?: () => void;
  onForward?: () => void;
  onEditAsNew?: () => void;
  onPrint?: () => void;
  onShowOriginal?: () => void;
  onToggleDetails?: () => void;
  detailsOpen?: boolean;
}) {
  const t = useMailT();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const canCopy = Boolean(bodyText.trim());
  const canCopyRecipients = recipients.length > 0;
  const hasMenu =
    Boolean(onForward) ||
    Boolean(onEditAsNew) ||
    canCopy ||
    canCopyRecipients ||
    Boolean(onPrint) ||
    Boolean(onShowOriginal) ||
    Boolean(onToggleDetails);
  if (!onReact && !onReplyTo && !hasMenu) return null;

  const item =
    "inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 hover:text-stone-800";

  return (
    /*
      A track the height of the bubble, with the rail sticky inside it.

      The rail used to sit at the bubble's middle, and on a message three
      screens tall the middle is off the screen: nothing to react with,
      reply to or open until the reader had scrolled to it. The track runs
      the bubble's full height in the gutter; the rail is centred in it on
      a short bubble, and on a tall one sticks within the part of the
      bubble that is on screen, a hand's breadth from either edge.
    */
    <div
      className="pointer-events-none absolute inset-y-0 z-20 flex w-8 flex-col justify-center"
      /*
        Beside the bubble when there is room, over its edge when there is
        not. The pane clips what crosses its edge, and no z-index paints
        past a clip — so on a message that fills the pane, the rail used to
        lose its outer side. The row measures the room between the bubble
        and the pane's edge as the pointer arrives (see the row's
        onPointerEnter) and the rail comes in by the shortfall, sitting on
        the bubble with its z-index rather than under the pane's edge.
      */
      style={{
        [own ? "left" : "right"]:
          `max(-${RAIL_OUTSIDE_PX}px, calc(-1 * var(--mail-rail-room, ${RAIL_OUTSIDE_PX}px)))`,
      }}
    >
    <div
      className={cn(
        // Stacked rather than in a row, so the whole thing is one button
        // wide. A row of three needed ninety pixels and the gutter beside a
        // message is forty — in the chat window it ran off the edge.
        "sticky top-24 bottom-24 flex w-8 flex-col items-center gap-0.5 rounded-full border border-stone-200 bg-white p-0.5 opacity-0 shadow-sm transition-opacity",
        // Invisible and out of the way, not merely invisible. Faded out it
        // still took the clicks meant for whatever was underneath it —
        // which, at the bottom of a thread, is the button that goes back
        // to the latest message. Keyboard focus is unaffected, so tabbing
        // to it still brings it out.
        "pointer-events-none",
        "group-hover/bubble:pointer-events-auto group-hover/bubble:opacity-100",
        "focus-within:pointer-events-auto focus-within:opacity-100",
        // Held open while its menu is, or picking from it would dismiss it.
        menuOpen && "pointer-events-auto opacity-100"
      )}
    >
      {onReact ? (
        <EmojiReactionButton onPick={onReact} className={item} />
      ) : null}
      {onReplyTo ? (
        <button
          type="button"
          title={t("replyToThisMessage")}
          aria-label={t("replyToThisMessage")}
          className={item}
          onClick={onReplyTo}
        >
          <CornerUpLeft className="h-4 w-4" />
        </button>
      ) : null}
      {hasMenu ? (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={t("more")}
              aria-label={t("moreActionsForMessage")}
              className={item}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <MailPopoverContent
            side={own ? "left" : "right"}
            align="center"
            className="w-44 p-1"
            // Opened with a click, the menu used to hand focus to its first
            // item, which drew the keyboard ring round "Forward" as if it
            // had been chosen. Focus goes to the menu itself instead: no
            // item is marked, and Tab still walks the items from the top.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement | null)?.focus();
            }}
          >
            {onForward ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
                onClick={() => {
                  setMenuOpen(false);
                  onForward();
                }}
              >
                <Forward className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {t("actionForward")}
              </button>
            ) : null}
            {onEditAsNew ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
                onClick={() => {
                  setMenuOpen(false);
                  onEditAsNew();
                }}
              >
                <SquarePen className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {t("editAsNew")}
              </button>
            ) : null}
            {canCopy ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
                onClick={() => {
                  setMenuOpen(false);
                  void navigator.clipboard
                    .writeText(bodyText)
                    .then(() => toast.success(mailSay("copied")))
                    .catch(() => toast.error(mailSay("couldNotCopyThat")));
                }}
              >
                <Copy className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {t("copyText")}
              </button>
            ) : null}
            {canCopyRecipients ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
                onClick={() => {
                  setMenuOpen(false);
                  void navigator.clipboard
                    .writeText(recipients.join("; "))
                    .then(() => toast.success(mailSay("copied")))
                    .catch(() => toast.error(mailSay("couldNotCopyThat")));
                }}
              >
                <Users className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {t("copyRecipients")}
              </button>
            ) : null}
            {onToggleDetails ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
                onClick={() => {
                  setMenuOpen(false);
                  onToggleDetails();
                }}
              >
                <Info className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {detailsOpen ? t("hideDetails") : t("details")}
              </button>
            ) : null}
            {/* The message as a document — printed, or as it came — stands
                apart from what is done with its words. */}
            {(onPrint || onShowOriginal) &&
            (onForward || onEditAsNew || canCopy || canCopyRecipients || onToggleDetails) ? (
              <div aria-hidden className="my-1 h-px bg-stone-200" />
            ) : null}
            {onPrint ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
                onClick={() => {
                  setMenuOpen(false);
                  onPrint();
                }}
              >
                <Printer className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {t("print")}
              </button>
            ) : null}
            {onShowOriginal ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
                onClick={() => {
                  setMenuOpen(false);
                  onShowOriginal();
                }}
              >
                <Code className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
                {t("showOriginal")}
              </button>
            ) : null}
          </MailPopoverContent>
        </Popover>
      ) : null}
    </div>
    </div>
  );
}

export function MailBubble({
  message,
  account,
  subject,
  defaultAllowImages,
  isLatest,
  sendStatus,
  zoom = 1,
  onRetrySend,
  onEditSend,
  onPreviewAttachment,
  showMeta = true,
  meta: metaNeeds = NO_MESSAGE_META,
  timeLabel,
  onReact,
  onReplyTo,
  onForward,
  onEditAsNew,
  onShowOriginal,
  showPrint = true,
}: {
  message: {
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
  account: string;
  /** Thread subject, used as the title when this message is printed. */
  subject?: string;
  /** Tab default: CRM contacts load images; unknown senders stay blocked. */
  defaultAllowImages: boolean;
  isLatest: boolean;
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
  const [bodyFullyExpanded, setBodyFullyExpanded] = React.useState(false);
  /** True when the natural body height exceeds the clamp (independent of expanded). */
  const [isTall, setIsTall] = React.useState(false);
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
  const bodyMeasureRef = React.useRef<HTMLDivElement>(null);
  /** Thread-pane scrollTop captured when expanding the quote. */
  const scrollBeforeExpand = React.useRef<number | null>(null);
  const allowImages = loadImagesByDefault || senderAllowImages;
  const toggleImages = () => {
    const next = !senderAllowImages;
    setSenderAllowImages(next);
    rememberImageChoice(senderKey, next);
  };
  const fullBody = decodeHtmlEntities(formatEmailBody(message.bodyText)).trim();
  const stripped = stripQuotedReplies(fullBody);
  const hasHidden = stripped.length < fullBody.length;

  // Same idea in the rich view: quoted history collapses behind the "…" pill.
  const htmlSplit = React.useMemo(
    () => (message.bodyHtml ? stripQuotedHtml(message.bodyHtml) : null),
    [message.bodyHtml]
  );

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

  // Measure whether an older body exceeds the clamp. Latest stays full.
  React.useLayoutEffect(() => {
    if (isLatest) {
      setIsTall(false);
      return;
    }
    const el = bodyMeasureRef.current;
    if (!el) return;
    const measure = () => {
      // When clamped, scrollHeight is the full content height; when expanded,
      // it's the same — either way we can tell if it would overflow 340px.
      setIsTall(el.scrollHeight > MESSAGE_BODY_CLAMP_PX + 8);
    };
    measure();
    // Not on every frame of a slide — see lib/mail/pane-slide.
    const ro = new ResizeObserver(() => {
      if (afterMailPaneSlide(measure)) return;
      measure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLatest, showHtml, showQuoted, message.bodyHtml, stripped]);

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
  /** Nothing to stamp until it has gone. */
  const stamp = sendingOut || failedOut ? "" : messageStamp(message.sentAt);

  const statusCaption = sendingOut ? (
    <div className="mt-1 flex items-center gap-1 px-1 text-[11px] text-stone-400">
      <Clock className="h-3 w-3 shrink-0" aria-hidden />
      <span>{t("sending")}</span>
    </div>
  ) : failedOut ? (
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[11px] text-red-600/90">
      <span>{t("notSent")}</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        className="font-medium underline-offset-2 hover:underline"
        onClick={onRetrySend}
      >
        {t("retry")}
      </button>
      <span aria-hidden>·</span>
      <button
        type="button"
        className="font-medium underline-offset-2 hover:underline"
        onClick={onEditSend}
      >
        {t("edit")}
      </button>
    </div>
  ) : null;

  const [failedCalendarIds, setFailedCalendarIds] = React.useState(
    () => new Set<string>()
  );
  const fileAttachments = nonCalendarAttachments(
    message.attachments,
    failedCalendarIds
  );
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
    toggleDetailsFromBody();
  };

  const clamped = isTall && !bodyFullyExpanded;
  const fadeFrom =
    sendingOut || failedOut
      ? failedOut
        ? "from-red-50"
        : "from-[var(--mail-bubble-other)]"
      : message.own
        ? "from-[var(--mail-bubble-own)]"
        : "from-[var(--mail-bubble-other)]";

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
          {detailsOpen ? metaDetails : metaHeadline}
        </p>
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
      <MessageHoverActions
        own={message.own}
        bodyText={message.bodyText}
        recipients={messageRecipients}
        onReact={sendingOut || failedOut ? undefined : onReact}
        onReplyTo={sendingOut || failedOut ? undefined : onReplyTo}
        onForward={sendingOut || failedOut ? undefined : onForward}
        onEditAsNew={sendingOut || failedOut ? undefined : onEditAsNew}
        onPrint={showPrint ? printThisMessage : undefined}
        onShowOriginal={sendingOut || failedOut ? undefined : onShowOriginal}
        // Who it was from and who it went to, for the message where the line
        // above says nothing because nothing about it changed.
        onToggleDetails={
          showMeta ? () => setDetailsOpen((open) => !open) : undefined
        }
        detailsOpen={detailsOpen}
      />
      <div
        onDoubleClick={onBubbleDoubleClick}
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
          <div className={cn(showHtml ? "px-3.5 pt-3" : "pb-1")}>
            <MessageCalendarInvite
              account={account}
              messageId={message.id}
              attachments={message.attachments}
              onUnavailable={noteCalendarUnavailable}
            />
          </div>
        ) : null}
        {/* Above the body, not under it. At the bottom of a long message the
            files are past the fold, and the reader has to scroll a message
            they may not want to read to find out one is attached. */}
        {fileAttachments.length ? (
          <div className={cn(showHtml ? "px-3.5 pt-3" : "pb-2")}>
            <MessageAttachmentChips
              account={account}
              messageId={message.id}
              attachments={fileAttachments}
              onPreview={onPreviewAttachment}
            />
          </div>
        ) : null}
        <div
          className={cn(
            "relative",
            showHtml && "overflow-hidden rounded-t-lg",

          )}
        >
          <div
            ref={bodyMeasureRef}
            className={cn(clamped && "max-h-[340px] overflow-hidden")}
          >
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
                  html={shownHtml}
                  inlineImages={message.inlineImages}
                  allowImages={allowImages}
                  zoom={zoom}
                  bodyColor={readInTheDark ? "#e2e9f0" : undefined}
                  darkRecolor={readInTheDark}
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
          {clamped ? (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t to-transparent",
                fadeFrom
              )}
            />
          ) : null}
        </div>
        {clamped ? (
          <div
            className={cn(
              "flex justify-center",
              showHtml ? "px-3.5 pb-2.5 pt-1" : "pt-2"
            )}
          >
            <button
              type="button"
              className="rounded-full bg-white px-3 py-1 text-xs font-medium text-teal-700 shadow-sm ring-1 ring-stone-200 hover:text-teal-800"
              onClick={() => setBodyFullyExpanded(true)}
            >
              {t("showFullMessage")}
            </button>
          </div>
        ) : bodyFullyExpanded && isTall ? (
          <div
            className={cn(
              "flex justify-center",
              showHtml ? "px-3.5 pb-2.5 pt-1" : "pt-2"
            )}
          >
            <button
              type="button"
              className="text-xs text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
              onClick={() => setBodyFullyExpanded(false)}
            >
              {t("showLess")}
            </button>
          </div>
        ) : null}
      </div>
      </div>
      {statusCaption}
    </div>
    </div>
  );
}
/**
 * How far outside the bubble the hover rail stands when nothing is in the
 * way: its own width (w-8, border included) and one pixel of air.
 */
const RAIL_OUTSIDE_PX = 33;

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

/** Optimistic send bubble (not yet replaced by a provider message id). */
export function isPendingLocalMessage(id: string): boolean {
  return id.startsWith("local-");
}
