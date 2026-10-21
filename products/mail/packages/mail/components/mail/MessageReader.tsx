"use client";

/**
 * The Reader: one long message over the whole window.
 *
 * Opened from the Reader button in the rail beside a long bubble (see
 * MailBubble). Every other part of the window goes out of view: the list,
 * the toolbars, the folder rail, the composer. One column stays, on the
 * thread's cream (or navy, in the dark theme), with larger type. The whole
 * thread has a full-window view of its own (see thread-full-window).
 *
 * The thread stays mounted under the Reader, so its scroll position does not
 * change. Esc or "Back to thread" closes the Reader.
 *
 * Reply and Forward answer the message. They open the thread's own composer
 * at the foot of the column, and the Reader stays open (see
 * reader-composer). Esc then puts the composer away first and keeps the
 * draft. A second Esc closes the Reader. Where no pane gives the composer a
 * way in, Reply and Forward close the Reader and open the composer in the
 * thread, as before.
 *
 * The message shows as the bubble shows it: quoted history folded behind
 * the same dots, and a forward with its "Forwarded message" line and
 * header, as in the thread.
 */

import { TextSizePopover } from "@/components/mail/ZoomControls";
import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, CornerUpLeft, Forward, ReplyAll } from "lucide-react";

import { LinkifiedText } from "@/components/LinkifiedText";
import { EmailHtmlView } from "@/components/mail/EmailHtmlView";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import { shortDate } from "@/lib/mail/date-format";
import { PeopleAvatar } from "@/components/mail/PersonAvatar";
import { currentMailLocale, useMailT } from "@/lib/mail/i18n";
import { htmlHasOwnLayout } from "@/lib/mail/reader-parts";
import {
  READER_TEXT_SIZES,
  useReaderLineCutoff,
  useReaderTextSize,
  useReaderWidth,
} from "@/lib/mail/reader-settings";
import { useRenderedLines } from "@/components/mail/use-rendered-lines";
import { ReaderWidthHandles } from "@/components/mail/reader-width-handles";
import { paintSearchHits } from "@/lib/mail/search-highlight";
import { useMailColorMode } from "@/lib/mail/theme";
import { cn } from "@/lib/utils";
import {
  useReaderComposer,
  type ReaderComposerSlot,
} from "@/components/mail/reader-composer";
import { useReaderComposerPlace, useReaderKeys } from "@/components/mail/reader-keys";
import { useReaderReplyAll, type ReaderEntry } from "@/components/mail/reader-thread";

/** The serif the Reader sets text in, inside and outside a frame. */
/*
  The Reader looks like the thread, larger: the same sans-serif type and
  the same bubbles. With serif type and no bubbles, it reads as another
  app.
*/
const READER_LINE_HEIGHT = 1.6;

/** The message the Reader shows, and what the bubble already worked out. */
export type ReaderMessage = {
  /** Sent by the reader: the tinted bubble, as in the thread. */
  own?: boolean;
  fromName: string;
  fromEmail: string;
  sentAt: string | null;
  bodyHtml?: string;
  inlineImages?: Record<string, string>;
};

/** One message in the Reader, with what every message shares. */
type ReaderItem = ReaderEntry & {
  /** The thread subject. */
  subject?: string;
  /** Pane zoom: the Reader's column is drawn at the same zoom. */
  zoom: number;
};

export type MessageReaderProps = {
  /** The message the Reader shows. */
  opened: ReaderEntry;
  subject?: string;
  zoom: number;
  onClose: () => void;
  /** The thread's composer, when it can come into the Reader. */
  composer?: ReaderComposerSlot | null;
};

/** The frame's type for HTML with no layout of its own. */

function readerFrameCss(sizePx: number): string {
  return [
    `body{padding:0 0 4px;font-size:${sizePx}px;line-height:${READER_LINE_HEIGHT}}`,
    "p{margin:0 0 1em}",
    "p,div,span,font,li,td{font-family:inherit!important;font-size:inherit!important;line-height:inherit!important}",
  ].join("\n");
}

/** A sender with a layout of their own keeps it. Only the padding goes. */
const OWN_LAYOUT_FRAME_CSS = "body{padding:0 0 8px}";

/** One part of the message: HTML in a frame, or reflowed text. */
function ReaderBody({
  content,
  html,
  sizePx,
  props,
}: {
  content: string;
  html: boolean;
  sizePx: number;
  props: ReaderItem;
}) {
  const textRef = React.useRef<HTMLDivElement>(null);
  const { highlight } = props;
  React.useEffect(() => {
    const el = textRef.current;
    if (html || !el || !highlight?.length) return;
    return paintSearchHits(el, highlight);
  }, [highlight, html, content]);
  if (!content.trim()) return null;
  if (html) {
    const ownLayout = htmlHasOwnLayout(content);
    return (
      <div className="mail-reader-html">
        <EmailHtmlView
          html={content}
          inlineImages={props.message.inlineImages}
          allowImages={props.allowImages}
          zoom={props.zoom}
          bodyColor={props.readInTheDark ? "#e2e9f0" : undefined}
          darkRecolor={props.readInTheDark}
          highlight={highlight}
          frameCss={ownLayout ? OWN_LAYOUT_FRAME_CSS : readerFrameCss(sizePx)}
        />
      </div>
    );
  }
  return (
    <div
      ref={textRef}
      data-reader-text
      className="whitespace-pre-wrap break-words text-[var(--mail-thread-fg)]"
      style={{ fontSize: sizePx, lineHeight: READER_LINE_HEIGHT }}
    >
      <LinkifiedText text={content} onEmailClick={requestMailComposeTo} />
    </div>
  );
}

/** The "Aa" button and its two steps, smaller and bigger: as the thread's, with the reader's own sizes. */
export function ReaderTextSize() {
  const t = useMailT();
  const [index, setIndex] = useReaderTextSize();
  return (
    <TextSizePopover
      label={t("readerTextSize")}
      size={`${READER_TEXT_SIZES[index]}px`}
      canSmaller={index > 0}
      canBigger={index < READER_TEXT_SIZES.length - 1}
      onSmaller={() => setIndex(index - 1)}
      onBigger={() => setIndex(index + 1)}
    />
  );
}

/**
 * The top bar: a real Back button on the left, clear of the window's
 * traffic lights (`.mail-reader-topbar` in mail.css), and the text size on
 * the right. Who sent each message and when is over its bubble.
 */
function ReaderTopBar({
  backRef,
  onClose,
}: {
  backRef: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const t = useMailT();
  return (
    <div className="mail-reader-topbar flex shrink-0 items-center justify-between gap-3 py-3 pr-5">
      <button
        ref={backRef}
        type="button"
        onClick={onClose}
        className="flex items-center gap-2 rounded-control border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-100"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        <span>{t("readerBack")}</span>
        <kbd className="rounded border border-stone-300 px-1 font-sans text-[10px] font-normal text-stone-500">Esc</kbd>
      </button>
      <ReaderTextSize />
    </div>
  );
}

/** "10 Oct, 13:59", in the reader's language. */
function sentAtLabel(sentAt: string | null): string {
  if (!sentAt) return "";
  const at = new Date(sentAt);
  if (Number.isNaN(at.getTime())) return shortDate(sentAt);
  return at.toLocaleString(currentMailLocale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Who wrote the message and when, over its bubble, as in the thread. */
function ReaderSender({ props }: { props: ReaderItem }) {
  const { message } = props;
  return (
    <div
      data-reader-sender
      className={cn("mb-1.5 flex items-center gap-2 px-1", message.own ? "flex-row-reverse text-right" : "")}
    >
      <PeopleAvatar people={[{ name: message.fromName || props.displayName, email: message.fromEmail }]} size={24} />
      <span className="truncate text-sm font-medium">{props.displayName}</span>
      <span className="shrink-0 text-xs text-[var(--mail-thread-muted)]" data-reader-meta>
        {sentAtLabel(message.sentAt)}
      </span>
    </div>
  );
}

/** Reply, Reply all and Forward, floating at the bottom right. */
function ReaderActions({
  onReply,
  onReplyAll,
  onForward,
}: {
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
}) {
  const t = useMailT();
  if (!onReply && !onReplyAll && !onForward) return null;
  const button =
    "flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-700 shadow-sm hover:bg-stone-100";
  return (
    <div className="absolute bottom-6 right-6 flex gap-2">
      {onReply ? (
        <button type="button" className={button} onClick={onReply}>
          <CornerUpLeft className="h-4 w-4" aria-hidden />
          {t("actionReply")}
        </button>
      ) : null}
      {onReplyAll ? (
        <button type="button" className={button} onClick={onReplyAll}>
          <ReplyAll className="h-4 w-4" aria-hidden />
          {t("actionReplyAll")}
        </button>
      ) : null}
      {onForward ? (
        <button type="button" className={button} onClick={onForward}>
          <Forward className="h-4 w-4" aria-hidden />
          {t("actionForward")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * One message in the column: the sender's line, then a bubble as the
 * thread draws it — white for others, tinted for one's own — holding the
 * words as the bubble shows them, a forward included.
 */
function ReaderEntryView({ item, sizePx }: { item: ReaderItem; sizePx: number }) {
  const t = useMailT();
  const fullHtml = item.message.bodyHtml ?? "";
  const html = Boolean(fullHtml);
  const own = Boolean(item.message.own);
  const [quoted, setQuoted] = React.useState(item.showQuoted);
  const folded = html ? item.shownHtml : item.shownText;
  const full = html ? fullHtml : item.fullText;
  const hasHidden = Boolean(folded.trim()) && folded !== full;
  return (
    <div data-reader-entry={item.id}>
      <ReaderSender props={item} />
      <div
        data-reader-bubble
        className={cn(
          "rounded-surface border px-5 py-4",
          own
            ? "rounded-br-md border-[var(--mail-bubble-own-border)] bg-[var(--mail-bubble-own)]"
            : "mail-bubble-card rounded-bl-md border-[var(--mail-bubble-other-border)] bg-[var(--mail-bubble-other)] shadow-sm"
        )}
      >
        <ReaderBody content={quoted || !hasHidden ? full : folded} html={html} sizePx={sizePx} props={item} />
        {hasHidden ? (
          <button
            type="button"
            data-reader-quoted
            className="mt-2 inline-flex h-3 items-center justify-center gap-[2.5px] rounded-full bg-stone-200/70 px-2 text-stone-600 hover:bg-stone-200"
            title={quoted ? t("hideQuotedText") : t("showQuotedText")}
            aria-label={quoted ? t("hideQuotedText") : t("showQuotedText")}
            onClick={() => setQuoted((on) => !on)}
          >
            <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
            <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
            <span className="h-[2.5px] w-[2.5px] rounded-full bg-current" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Reply, Reply all and Forward from the Reader.
 *
 * With a pane to give the composer, the composer comes into the Reader and
 * the Reader stays. Without one, the Reader closes and the composer opens
 * in the thread.
 */
function useReaderActions(props: MessageReaderProps) {
  const { composer, onClose, opened } = props;
  const replyAll = useReaderReplyAll();
  const setShown = composer?.setShown;
  const act = React.useCallback(
    (action: (() => void) | undefined) => {
      if (!action) return;
      if (setShown) setShown(true);
      else onClose();
      action();
    },
    [setShown, onClose]
  );
  return {
    onReply: opened.onReplyTo ? () => act(opened.onReplyTo) : undefined,
    onForward: opened.onForward ? () => act(opened.onForward) : undefined,
    onReplyAll: replyAll ? () => act(replyAll) : undefined,
  };
}

export function MessageReader(props: MessageReaderProps) {
  const t = useMailT();
  const colorMode = useMailColorMode();
  const [sizeIndex] = useReaderTextSize();
  const sizePx = READER_TEXT_SIZES[sizeIndex];
  const [readerWidth, setReaderWidth] = useReaderWidth();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const backRef = React.useRef<HTMLButtonElement>(null);
  const { composer, subject, zoom, opened } = props;
  const place = useReaderComposerPlace(composer, backRef);
  const hostRef = composer?.setHost;
  const coverMessage = place.here && Boolean(composer?.cover);
  useReaderKeys(rootRef, props.onClose, place);
  const actions = useReaderActions(props);
  React.useEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, []);
  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("readerTitle")}
      data-theme={colorMode}
      data-mail-reader
      className="mail-shell fixed inset-0 z-50 flex flex-col bg-[var(--mail-thread)] text-[var(--mail-thread-fg)]"
    >
      <ReaderTopBar backRef={backRef} onClose={props.onClose} />
      {/* The thread, and under it the composer when one is open. The
          thread stays readable and scrolls above it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div data-reader-scroller className="min-h-0 flex-1 overflow-y-auto">
        {/* One column for everything, so the note, the forward line and
            the mail share one left edge. */}
        <article
          className={cn("relative mx-auto w-full px-6 pt-6", place.here ? "pb-8" : "pb-32")}
          style={{ zoom, maxWidth: readerWidth }}
        >
          <ReaderWidthHandles width={readerWidth} zoom={zoom} onWidth={setReaderWidth} />
          <ReaderEntryView item={{ ...opened, subject, zoom }} sizePx={sizePx} />
        </article>
      </div>
      {composer ? (
        /* The thread's composer is drawn in here (see reader-composer).
           The column's width, and centred. When the composer fills the
           window, this stands over the thread. */
        <div
          ref={hostRef}
          data-reader-composer=""
          style={{ maxWidth: readerWidth * (zoom || 1) }}
          className={cn(
            "mx-auto flex min-h-0 w-full flex-col",
            place.here && "mail-reader-composer-in",
            coverMessage && "absolute inset-x-0 inset-y-0"
          )}
        />
      ) : null}
      </div>
      {place.here ? null : <ReaderActions {...actions} />}
    </div>,
    document.body
  );
}

/**
 * Open and close the Reader for one bubble. Closing puts the thread back at
 * the scroll position it had, and gives keyboard focus back to the bubble.
 */
function useReaderOpen(
  bubbleRef: React.RefObject<HTMLElement | null>,
  scroller: (el: HTMLElement | null) => HTMLElement | null
) {
  const [open, setOpen] = React.useState(false);
  const saved = React.useRef<{ scroller: HTMLElement; top: number } | null>(null);
  const openReader = React.useCallback(() => {
    const el = scroller(bubbleRef.current);
    saved.current = el ? { scroller: el, top: el.scrollTop } : null;
    setOpen(true);
  }, [bubbleRef, scroller]);
  const closeReader = React.useCallback(() => {
    setOpen(false);
    const place = saved.current;
    saved.current = null;
    if (place) place.scroller.scrollTop = place.top;
    bubbleRef.current?.focus({ preventScroll: true });
  }, [bubbleRef]);
  return { open, openReader, closeReader };
}

export type BubbleReaderInput = Omit<ReaderEntry, "id" | "shownText" | "shownHtml" | "showQuoted"> & {
  id: string;
  subject?: string;
  zoom: number;
  inChatWindow: boolean;
  outgoing: boolean;
  bubbleRef: React.RefObject<HTMLElement | null>;
  /** The body's box, measured in lines. See use-rendered-lines. */
  bodyBoxRef: React.RefObject<HTMLElement | null>;
  /** The element that scrolls the thread, so its place is kept. */
  findScroller: (el: HTMLElement | null) => HTMLElement | null;
  /** The plain text with quoted history folded away. */
  foldedText: string;
  /** The HTML with quoted history (and a repeated signature) taken off. */
  htmlSplit: { html: string; hadQuote: boolean } | null;
  /** Whether the bubble shows its quoted history now. */
  showQuoted: boolean;
  /** The HTML the bubble shows now. It is what is measured. */
  shownHtml: string;
};

/**
 * The Reader as one bubble uses it.
 *
 * - `onOpen`, for the button in the bubble's rail, when the body is longer
 *   than the cutoff in Settings > Reading.
 * - `reader`, the Reader while it is open.
 *
 * Every bubble puts its message in the thread's list for the Reader, long
 * or short. Off in a chat window and on a message of ours still on its way
 * out.
 */
export function useBubbleReader(input: BubbleReaderInput): {
  onOpen?: () => void;
  reader: React.ReactNode;
} {
  const { id, message, displayName, fullText, foldedText, allowImages, readInTheDark, highlight } = input;
  const { onReplyTo, inChatWindow, outgoing, subject, zoom, htmlSplit, showQuoted } = input;
  const off = inChatWindow || outgoing;
  const onForward = outgoing ? undefined : input.onForward;
  const foldedHtml = htmlSplit?.hadQuote ? htmlSplit.html : (message.bodyHtml ?? "");
  const html = Boolean(message.bodyHtml);
  const [cutoff] = useReaderLineCutoff();
  const shownText = showQuoted ? fullText : foldedText;
  const lines = useRenderedLines(input.bodyBoxRef, zoom, html, html ? input.shownHtml : shownText);
  const reader = useReaderOpen(input.bubbleRef, input.findScroller);
  const composer = useReaderComposer();
  const entry = React.useMemo<ReaderEntry>(
    () => ({
      id,
      message,
      displayName,
      fullText,
      shownText: foldedText,
      shownHtml: foldedHtml,
      showQuoted,
      allowImages,
      readInTheDark,
      highlight,
      onReplyTo,
      onForward,
    }),
    [id, message, displayName, fullText, foldedText, foldedHtml, showQuoted, allowImages, readInTheDark, highlight, onReplyTo, onForward]
  );
  if (off) return { reader: null };
  return {
    onOpen: lines > cutoff ? reader.openReader : undefined,
    reader: reader.open ? (
      <MessageReader
        opened={entry}
        subject={subject}
        zoom={zoom}
        onClose={reader.closeReader}
        composer={composer}
      />
    ) : null,
  };
}
