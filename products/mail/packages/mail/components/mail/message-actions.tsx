"use client";

/**
 * What can be done with one message in a thread: the rail beside it while
 * the pointer is on it (react, reply, "…"), the rows of its "…" menu, and
 * its right-click menu, which offers the same. Drawn by MailBubble.
 */

import * as React from "react";
import {
  Code,
  Copy,
  CornerUpLeft,
  Download,
  Forward,
  Info,
  MoreHorizontal,
  Printer,
  SquarePen,
  Users,
} from "lucide-react";

import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { PointerMenu } from "@/components/mail/PointerMenu";
import { EmojiReactionButton, QUICK_EMOJIS } from "@/components/ui/EmojiPicker";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";
import { cn } from "@/lib/utils";

/**
 * How far outside the bubble the hover rail stands when nothing is in the
 * way: its own width (w-8, border included) and one pixel of air.
 */
const RAIL_OUTSIDE_PX = 33;

/**
 * The actions that appear beside a message while the pointer is on it.
 *
 * In the gutter, on the side away from the sender, the way a chat app puts
 * them — so they never sit on top of the words. Nothing is shown until the
 * pointer arrives, and nothing is shown at all for a message still on its way
 * out or one that failed to send: neither can be reacted to or quoted yet.
 */
export function MessageHoverActions({
  own,
  bodyText,
  recipients,
  onReact,
  onReplyTo,
  onForward,
  onEditAsNew,
  onDownloadAttachments,
  attachmentCount = 0,
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
  /** Save this message's files, for a reader whose tiles are out of view. */
  onDownloadAttachments?: () => void;
  /** How many files that would save, which decides the wording. */
  attachmentCount?: number;
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
    Boolean(onDownloadAttachments) ||
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
            // Sized to the longest line rather than to a set width: "Download
            // attachments" is wider than the menu used to be, and a wrapped
            // menu item reads as two.
            className="w-auto min-w-[11rem] p-1"
            // Opened with a click, the menu used to hand focus to its first
            // item, which drew the keyboard ring round "Forward" as if it
            // had been chosen. Focus goes to the menu itself instead: no
            // item is marked, and Tab still walks the items from the top.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement | null)?.focus();
            }}
          >
            <MessageMenuItems
              {...{
                bodyText,
                recipients,
                onForward,
                onEditAsNew,
                onDownloadAttachments,
                attachmentCount,
                onPrint,
                onShowOriginal,
                onToggleDetails,
                detailsOpen,
              }}
              onDone={() => setMenuOpen(false)}
            />
          </MailPopoverContent>
        </Popover>
      ) : null}
    </div>
    </div>
  );
}

/**
 * A message's right-click menu, at the pointer: a reaction in one press,
 * Copy for what the reader selected, Reply, then the rows of its "…" menu.
 */
export function MessageContextMenu({
  x,
  y,
  selectedText,
  onReact,
  onReplyTo,
  actions,
  onDismiss,
}: {
  x: number;
  y: number;
  selectedText: string;
  onReact?: (emoji: string) => void;
  onReplyTo?: () => void;
  actions: MessageMenuActions;
  onDismiss: () => void;
}) {
  const t = useMailT();
  const row =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]";
  return (
    <PointerMenu x={x} y={y} onDismiss={onDismiss} className="min-w-[12rem] p-1">
      {onReact ? (
        <div className="flex items-center gap-0.5 px-1 pb-1">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={emoji}
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg hover:bg-[var(--mail-chrome-hover)]"
              onClick={() => {
                onDismiss();
                onReact(emoji);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      {selectedText ? (
        <button
          type="button"
          className={row}
          onClick={() => {
            onDismiss();
            void navigator.clipboard
              .writeText(selectedText)
              .then(() => toast.success(mailSay("copied")))
              .catch(() => toast.error(mailSay("couldNotCopyThat")));
          }}
        >
          <Copy className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
          {t("copySelection")}
        </button>
      ) : null}
      {onReplyTo ? (
        <button
          type="button"
          className={row}
          onClick={() => {
            onDismiss();
            onReplyTo();
          }}
        >
          <CornerUpLeft className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
          {t("actionReply")}
        </button>
      ) : null}
      {onReact || selectedText || onReplyTo ? <div aria-hidden className="my-1 h-px bg-stone-200" /> : null}
      <MessageMenuItems {...actions} onDone={onDismiss} />
    </PointerMenu>
  );
}

/** What a message offers beyond reacting and replying: its "…" menu. */
export type MessageMenuActions = {
  bodyText: string;
  recipients: string[];
  onForward?: () => void;
  onEditAsNew?: () => void;
  onDownloadAttachments?: () => void;
  attachmentCount?: number;
  onPrint?: () => void;
  onShowOriginal?: () => void;
  onToggleDetails?: () => void;
  detailsOpen?: boolean;
};

/**
 * The rows of a message's menu: in the rail's "…" popover and at the
 * pointer on a right-click, the same rows in the same order. `onDone` closes
 * whichever menu holds them, before the row's action runs.
 */
function MessageMenuItems({
  bodyText,
  recipients,
  onForward,
  onEditAsNew,
  onDownloadAttachments,
  attachmentCount = 0,
  onPrint,
  onShowOriginal,
  onToggleDetails,
  detailsOpen,
  onDone,
}: MessageMenuActions & { onDone: () => void }) {
  const t = useMailT();
  const canCopy = Boolean(bodyText.trim());
  const canCopyRecipients = recipients.length > 0;
  return (
    <>
      {onForward ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
          onClick={() => {
            onDone();
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
            onDone();
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
            onDone();
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
            onDone();
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
      {onDownloadAttachments ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
          onClick={() => {
            onDone();
            onDownloadAttachments();
          }}
        >
          <Download className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
          {attachmentCount > 1
            ? t("downloadAttachments")
            : t("downloadAttachment")}
        </button>
      ) : null}
      {onToggleDetails ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
          onClick={() => {
            onDone();
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
      (onForward ||
        onEditAsNew ||
        onDownloadAttachments ||
        canCopy ||
        canCopyRecipients ||
        onToggleDetails) ? (
        <div aria-hidden className="my-1 h-px bg-stone-200" />
      ) : null}
      {onPrint ? (
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-stone-800 hover:bg-[var(--mail-chrome-hover)]"
          onClick={() => {
            onDone();
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
            onDone();
            onShowOriginal();
          }}
        >
          <Code className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
          {t("showOriginal")}
        </button>
      ) : null}
    </>
  );
}
