"use client";

/*
 * The composer band of ThreadPane's markup, moved out of ThreadPane.tsx.
 *
 * Each component takes the pane's model (`m`, from useThreadPane) and reads the
 * names it needs from it. Values the pane works out after its early
 * returns come in as props. The JSX is ThreadPane's own, word for word.
 */

import * as React from "react";
import { ChevronDown, Forward, Reply, SendHorizontal, ExternalLink, Trash2, X } from "lucide-react";

import { DraftAssistNotes } from "@/components/mail/team-layer";
import { COMPOSER_MAX_SHARE } from "@/components/mail/use-thread-pane-geometry";
import { ComposerSignature } from "@/components/mail/composer-preview";
import {
  AttachToolbarButton,
  ComposerDropOverlay,
  DraftAttachmentChips,
} from "@/components/mail/draft-attachments";
import { reactionQuoteText } from "@/lib/mail/reaction-message";
import { currentMailLocale } from "@/lib/mail/i18n";
import { formatShortcut } from "@/lib/mail/shortcuts";
import { SendLaterMenu } from "@/components/mail/SendLaterMenu";
import { ComposerToolbar } from "@/components/mail/ComposerToolbar";
import { EmailHtmlView } from "@/components/mail/EmailHtmlView";
import { readImageChoices, useLoadImagesByDefault } from "@/components/mail/MailBubble";
import { textStyleVars, useTextStyleDefault } from "@/components/mail/use-text-style";
import { DEFAULT_COMPOSER_HEIGHT } from "@/components/mail/use-mail-layout";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { Button } from "@/components/ui/button";
import {
  PANE_SLIDE_MS,
  PANE_SLIDE_EASE,
} from "@/lib/mail/pane-slide";
import { emailsOfRecipients } from "@/lib/mail/contact-list-types";
import { mailHasTeamRecords } from "@/lib/mail/product-flavor";
import { teamWord } from "@/lib/mail/i18n-team";
import { cn } from "@/lib/utils";
import type { ThreadPaneModel } from "@/components/mail/use-thread-pane";
import { ComposerPreview, ComposerFooter, ComposerAddressRow, ComposerCardButtons } from "@/components/mail/thread-composer-parts";
import { ComposerFieldRows } from "@/components/mail/thread-composer-rows";
import { useStickyComposerFoot } from "@/components/mail/use-sticky-composer-foot";


/** The composer band under the thread: the reply, reply-all or forward being written, with its recipients, subject, tools and send. */
export function ThreadComposerBand({
  m,
  chatStyle,
}: {
  m: ThreadPaneModel;
  chatStyle: boolean;
}) {
  const {
    draftNotes,
    draftWorking,
    attachDragging,
    attachDropHandlers,
    attachPasteHandlers,
    bandFills,
    card,
    compactComposer,
    composerColumnRef,
    composerHeight,
    composerHeightSet,
    composerWidthPct,
    dismissDraftNotes,
    editRecipients,
    editorKey,
    floating,
    forwardSource,
    forwarding,
    fullWidthComposer,
    includeSignature,
    mode,
    reply,
    replyBandRef,
    replyBandRestRef,
    replyBoxPlaceholder,
    replyEditorHandle,
    fromAccount,
    replyFocus,
    replyFocusSliding,
    replyGrown,
    replyRef,
    restoreDraftBrief,
    scrollComposerFromBand,
    setEditRecipients,
    setReply,
    showPreview,
    sigSettings,
    startComposerHeightResize,
    startComposerResize,
    stopDraft,
    t,
    toList,
    zoom,
  } = m;
  const textDefaults = useTextStyleDefault(fromAccount);
  const footRef = React.useRef<HTMLDivElement | null>(null);
  const sendBarRef = React.useRef<HTMLDivElement | null>(null);
  const moreBelow = useStickyComposerFoot(
    composerColumnRef,
    footRef,
    sendBarRef,
    `${mode}|${showPreview}|${bandFills}|${editorKey}`
  );
  return (
    <>
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
            "mail-composer-region relative flex min-h-0 flex-col border-t border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] pb-4 pt-3",
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
                compactComposer || fullWidthComposer || card.full || forwarding
                  ? "100%"
                  : `${composerWidthPct}%`,
              maxWidth: "100%",
            }}
          >
          {/* No edges to drag while the box is the whole pane: there is
              nowhere for either to go, and a handle that cannot move is a
              handle that reads as broken. */}
          {compactComposer || fullWidthComposer || card.full || forwarding ? null : (
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
          <ComposerHead m={m} />
            {draftNotes || draftWorking ? (
              <DraftAssistNotes
                result={draftNotes}
                working={draftWorking}
                onStop={stopDraft}
                onRestoreBrief={restoreDraftBrief}
                onDismiss={dismissDraftNotes}
              />
            ) : null}
            <div
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
              {editRecipients ? <ComposerFieldRows m={m} /> : null}
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
                /* Writing puts the opened recipients away again, down to
                   the one line, when there is somebody to send to. Not on
                   a forward, whose rows are its head. */
                onFocusCapture={() => {
                  if (editRecipients && !forwarding && toList.length) setEditRecipients(false);
                }}
                className={cn(
                  "mail-composer-scroll flex-1 rounded-t-xl",
                  // A floor of about three lines, so there is always a place
                  // to click and type, however much sits above the box.
                  bandFills ? "flex min-h-0 flex-col" : "min-h-[4.5rem]"
                )}
              >
              {/* The box writes in the account's default font and size,
                  which mail.css reads from these. */}
              <div className="contents" style={textStyleVars(textDefaults)}>
              <RichTextEditor
                /* New words from outside the editor make a new editor (its
                   words come from defaultValue), and the toolbar below is
                   made again with it. The key is on the editor itself: on
                   the card it threw away letters typed in To (the rows are
                   in the card), and on the box around the editor it left
                   old editors stacked in the box. */
                key={editorKey}
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
              </div>
              {includeSignature && sigSettings?.signature ? (
                <ComposerSignature signature={sigSettings.signature} />
              ) : null}
              {/* Under the note, where the recipient will see it. */}
              {forwarding && forwardSource ? <ForwardSourceQuote m={m} /> : null}
              </div>
            <ComposerSendBar key={editorKey} m={m} barRef={sendBarRef} overText={moreBelow} />
          </div>
          {/* Held at the bottom edge with Send above it, on the band's own
              colour so the reply scrolls out of sight under it. flow-root
              keeps the gap above the links inside it. */}
          <div
            ref={footRef}
            className="sticky bottom-0 z-10 flow-root shrink-0 bg-[var(--mail-thread-chrome)]"
          >
            <ComposerFooter m={m} chatStyle={chatStyle} />
          </div>
          </div>
          <ComposerPreview m={m} chatStyle={chatStyle} />
          </div>
          </div>
        </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * What stands above the card: the message a reply answers, and, while the
 * recipients are folded to one line, that line and a reply's own subject.
 * Opened, the recipients and the subject are rows in the card
 * (ComposerFieldRows).
 */
function ComposerHead({ m }: { m: ThreadPaneModel }) {
  const { editRecipients, forwarding, quotedForReply, subjectOpen, t } = m;
  return (
    <>
      {/* What this reply answers. Picking one message out of a thread used
          to do nothing you could see. */}
      {!forwarding && quotedForReply ? <QuotedReplyBanner m={m} /> : null}
      {!editRecipients && !forwarding && subjectOpen ? (
        <>
          {/* A reply's subject is the thread's; asked for, the row
              appears, and the reply keeps its place in the thread under a
              name that fits. Said where it is done. */}
          <ComposerSubjectRow m={m} />
          <p className="mb-1.5 px-1 text-xs text-stone-500">{t("newSubjectStartsConversation")}</p>
        </>
      ) : null}
      {editRecipients ? null : <ComposerAddressRow m={m} />}
    </>
  );
}

/**
 * The subject row: always on a forward, which often starts something of
 * its own, and on a reply only when asked for, when the thread's subject no
 * longer fits.
 */
function ComposerSubjectRow({
  m,
}: {
  m: ThreadPaneModel;
}) {
  const {
    forwardSubject,
    forwarding,
    replySubject,
    setSubjectDraft,
    subjectDraft,
    subjectOpen,
    t,
  } = m;
  return (
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
  );
}

/**
 * What this reply answers: the one message picked out of the thread, with
 * the way back to answering the whole thread.
 */
function QuotedReplyBanner({
  m,
}: {
  m: ThreadPaneModel;
}) {
  const {
    quotedForReply,
    setQuoteMessageId,
    t,
  } = m;
  // The caller shows this only with a message picked; said here too for the types.
  if (!quotedForReply) return null;
  return (
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
  );
}

/** Whether the forwarded message is shown whole. Kept across forwards. */
const FORWARD_OPEN_KEY = "dh-mail-forward-source-open";

function readForwardOpen(): boolean {
  try {
    return window.localStorage.getItem(FORWARD_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * What is going with a forward, under the note: which message (the
 * conversation before it goes too). It goes out under the note, so it is
 * shown there.
 *
 * One line at first, and the whole message on "Show more": a note is often
 * about the message it forwards, and the writer has to be able to read it
 * again while writing. The choice is kept, so somebody who opens it once
 * finds it open on the next forward. The message is drawn as it is in the
 * thread, with its pictures on the same terms.
 */
function ForwardSourceQuote({
  m,
}: {
  m: ThreadPaneModel;
}) {
  const {
    forwardSource,
    t,
    zoom,
  } = m;
  const [open, setOpenState] = React.useState(readForwardOpen);
  const [loadImagesByDefault] = useLoadImagesByDefault();
  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(FORWARD_OPEN_KEY, next ? "1" : "0");
    } catch {
      /* not kept: the choice holds for this forward */
    }
  };
  // The caller shows this only on a forward with its source; said here too for the types.
  if (!forwardSource) return null;
  const who = forwardSource.own ? t("yourself") : forwardSource.fromName || forwardSource.fromEmail;
  const day = forwardSource.sentAt
    ? new Date(forwardSource.sentAt).toLocaleDateString(currentMailLocale(), { day: "numeric", month: "short" })
    : "";
  const allowImages =
    loadImagesByDefault ||
    (readImageChoices()[forwardSource.fromEmail.trim().toLowerCase()] ?? false);
  const link = "whitespace-nowrap text-teal-700 underline-offset-2 hover:underline";
  return (
    <div data-forward-source="" className="mx-3 mb-3 border-l-2 border-stone-200 pl-3 text-[13px] text-stone-600">
      <span className="flex items-center gap-1.5 font-semibold">
        <Forward className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden />
        {day ? `${who}, ${day}` : who}
      </span>
      {open ? (
        <>
          <div className="mt-1">
            {forwardSource.bodyHtml ? (
              <EmailHtmlView
                html={forwardSource.bodyHtml}
                inlineImages={forwardSource.inlineImages}
                allowImages={allowImages}
                zoom={zoom}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-stone-700">
                {forwardSource.bodyText || "(no text)"}
              </p>
            )}
          </div>
          <button type="button" className={cn(link, "mt-1")} onClick={() => setOpen(false)}>
            {t("showLess")}
          </button>
        </>
      ) : (
        <span className="mt-0.5 flex items-baseline gap-2">
          <span className="min-w-0 truncate">
            {reactionQuoteText(forwardSource.bodyText) || "(no text)"}
          </span>
          <button type="button" className={link} onClick={() => setOpen(true)}>
            {t("showMore")}
          </button>
        </span>
      )}
    </div>
  );
}

/**
 * Under the box you type in: the files, docked above Send, then Send with
 * its section for when, the toolbar, and the rest of the row.
 */
function ComposerSendBar({
  m,
  barRef,
  overText,
}: {
  m: ThreadPaneModel;
  barRef: React.RefObject<HTMLDivElement | null>;
  /** The reply runs on under the row: a soft shadow says there is more. */
  overText: boolean;
}) {
  const {
    addAttachFiles,
    attachItems,
    attachmentsReady,
    canOpenInOutlook,
    canSendLater,
    discardComposer,
    forwarding,
    handingOver,
    mode,
    openInOutlook,
    outlookElsewhere,
    outlookTarget,
    removeAttach,
    replyEditorHandle,
    fromAccount,
    replyText,
    send,
    sendForward,
    sending,
    setDraftPreviewId,
    setShowPreview,
    shortcuts,
    t,
    toList,
  } = m;
  return (
    /* Sticks to the bottom of the band, standing on the links under the
       card — see useStickyComposerFoot. */
    <div
      ref={barRef}
      className={cn(
        "sticky bottom-[var(--composer-foot-h,0px)] z-10 flex shrink-0 flex-col gap-1.5 rounded-b-xl bg-white px-3 pb-2.5 pt-1",
        /* Stuck over the reply, the card's own foot is out of sight
           under the links, so the row draws it: the card's border, in
           the card's colour (which turns darker while you type). */
        overText &&
          "-mx-px border-x border-b border-inherit shadow-[0_-10px_12px_-10px_rgba(28,25,23,0.18)]"
      )}
    >
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
              ...(mailHasTeamRecords() &&
              !forwarding &&
              (mode === "reply" || mode === "replyAll")
                ? [
                    {
                      id: "updateRecords",
                      label: teamWord(t, "sendAndUpdateRecords") ?? "",
                      disabled:
                        sending ||
                        !emailsOfRecipients(toList).length ||
                        !attachmentsReady ||
                        (!replyText.trim() && !attachItems.length),
                      onSelect: () =>
                        void send(undefined, { updateRecords: true }),
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
        <ComposerToolbar id="mail-reply-toolbar" editorHandle={replyEditorHandle} account={fromAccount} />
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
        <span className="ml-auto flex items-center gap-1">
          {/* Pop out and grow, in the row with the tools: they were at the
              end of the recipient line, which is a row of rows now. */}
          <ComposerCardButtons m={m} />
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
  );
}
