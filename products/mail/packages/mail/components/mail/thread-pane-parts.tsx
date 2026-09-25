"use client";

/*
 * Part of ThreadPane's markup, moved out of ThreadPane.tsx.
 *
 * Each component takes the pane's model (`m`, from useThreadPane) and reads the
 * names it needs from it. Values the pane works out after its early
 * returns come in as props. The JSX is ThreadPane's own, word for word.
 */

import * as React from "react";
import { Archive, ArchiveRestore, ArrowUpRight, ChevronDown, Clock, Forward, Loader2, Maximize2, Minimize2, MessagesSquare, Pin, Printer, Reply, ReplyAll, ShieldCheck, Trash2, X } from "lucide-react";
import { TrashForeverIcon } from "@/components/mail/TrashForeverIcon";

import { CrmProposeMenu } from "@/components/mail/CrmProposeMenu";
import { DiaryEntriesDialog } from "@/components/mail/DiaryEntriesDialog";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import {
  SettingsDialog,
  settingsSecondaryButton,
} from "@/components/mail/settings-ui";
import { EmailHtmlView } from "@/components/mail/EmailHtmlView";
import { ThreadAttachmentsRollup } from "@/components/mail/MailAttachments";
import { MailBubble, messageSnippet } from "@/components/mail/MailBubble";
import { formatShortcut } from "@/lib/mail/shortcuts";
import { MoveToFolderMenu } from "@/components/mail/MailFolders";
import { oneInvitePerMessage } from "@/lib/mail/ics";
import { SignatureDialog } from "@/components/mail/SignatureDialog";
import {
  formatSnoozeWakeLabel,
  SnoozeMenu,
} from "@/components/mail/SnoozeMenu";
import {
  THREAD_ACTION_ACTIVE_CLASS,
} from "@/components/mail/thread-actions";
import { isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { ZoomControls } from "@/components/mail/ZoomControls";
import { EmojiReactionButton } from "@/components/ui/EmojiPicker";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { partJumpLabel, type MailChatPartSummary } from "@/lib/mail/chat-types";
import { messageStamp, shortDate, timeOfDay } from "@/lib/mail/date-format";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { cn } from "@/lib/utils";
import { ThreadParticipants, participantsWithAddresses } from "@/components/mail/ThreadParticipants";
import { ThreadToolbarOverflow } from "@/components/mail/ThreadToolbarOverflow";
import { ThreadAction } from "@/components/mail/ThreadAction";
import { DayHeading, PartSeam } from "@/components/mail/ThreadStreamMarks";
import { circleActionClass, threadActionClass, threadActionIconClass, threadActionSecondaryClass } from "@/components/mail/thread-pane-classes";
import type { MailChatRef } from "@/lib/mail/chat-types";
import type { MailThreadDetail } from "@/lib/mail/types";
import type { ThreadPaneModel } from "@/components/mail/use-thread-pane";

/** Questions over the whole reader: a file that was mentioned and not attached, discarding a draft, the signature, and a diary entry. */
export function ThreadPaneDialogs({
  m,

}: {
  m: ThreadPaneModel;

}) {
  const {
    accounts,
    clearForgottenAttachment,
    closeDiaryProposal,
    confirmDiscard,
    diaryProposal,
    discardComposer,
    forgottenAttachment,
    forwarding,
    fromAccount,
    send,
    setConfirmDiscard,
    setSigDialogOpen,
    setSigSettings,
    sigDialogOpen,
    t,
  } = m;
  return (
    <>
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
    </>
  );
}

/** Reply, Reply all and Forward, under the thread while nothing is being written. */
export function ReplyButtons({
  m,
  showReplyAll,
}: {
  m: ThreadPaneModel;
  showReplyAll: boolean;
}) {
  const {
    compactThreadActions,
    mode,
    popoutOpen,
    sendQuickReply,
    sending,
    shortcuts,
    startForward,
    startReply,
    t,
  } = m;
  return (
    <>
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

    </>
  );
}

/** The thread's messages, as bubbles or as mail, with the marks between them. */
export function ThreadMessages({
  m,
  chat,
  jumpToPart,
  thread,
}: {
  m: ThreadPaneModel;
  chat: MailChatRef | undefined;
  jumpToPart: (p: MailChatPartSummary) => void;
  /** The thread, which the pane has made sure is there. */
  thread: MailThreadDetail;
}) {
  const {
    account,
    actOnScheduled,
    awayFromLatest,
    bubbleActions,
    canLoadOlderAcrossParts,
    chatParts,
    confirmingIds,
    editOutboxSend,
    editScheduled,
    floating,
    goToLatestMessage,
    headHasOlderInPart,
    highlightMessageId,
    inCrm,
    latestId,
    loadNewerMessages,
    loadOlderMessages,
    loadingNewer,
    loadingOlder,
    metaById,
    newDayIds,
    olderParts,
    outbox,
    replyFocus,
    replyFocusSliding,
    retryOutboxSend,
    scheduled,
    setAttachmentPreview,
    setScrollNode,
    t,
    zoom,
  } = m;
  return (
    <>
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
    </>
  );
}

/** The thread's header: its subject and people, and the toolbar of actions. */
export function ThreadHeader({
  m,
  chat,
  dateRange,
  headerTitle,
  jumpToPart,
  showReplyAll,
  threadOthers,
  totalMessageCount,
  thread,
}: {
  m: ThreadPaneModel;
  chat: MailChatRef | undefined;
  dateRange: string;
  headerTitle: string;
  jumpToPart: (p: MailChatPartSummary) => void;
  showReplyAll: boolean;
  threadOthers: { email: string; name?: string; }[];
  totalMessageCount: number;
  /** The thread, which the pane has made sure is there. */
  thread: MailThreadDetail;
}) {
  const {
    floating,
    onToggleFocus,
  } = m;
  return (
    <>
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
        <ThreadActionStrip m={m} showReplyAll={showReplyAll} thread={thread} />
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
        <ThreadTitleBlock
          m={m}
          chat={chat}
          dateRange={dateRange}
          headerTitle={headerTitle}
          jumpToPart={jumpToPart}
          threadOthers={threadOthers}
          totalMessageCount={totalMessageCount}
          thread={thread}
        />
      </div>
      ) : null}
    </>
  );
}

/**
 * The thread's heading under the action strip: the subject, the people and
 * dates, and a chat's parts.
 */
function ThreadTitleBlock({
  m,
  chat,
  dateRange,
  headerTitle,
  jumpToPart,
  threadOthers,
  totalMessageCount,
  thread,
}: {
  m: ThreadPaneModel;
  chat: MailChatRef | undefined;
  dateRange: string;
  headerTitle: string;
  jumpToPart: (p: MailChatPartSummary) => void;
  threadOthers: { email: string; name?: string; }[];
  totalMessageCount: number;
  thread: MailThreadDetail;
}) {
  const {
    account,
    accounts,
    chatParts,
    firstMessage,
    firstPeekAllowImages,
    firstPeekHtml,
    firstPeekOpen,
    goToFirstMessage,
    latestId,
    loadingToStart,
    partMenuOpen,
    setFirstPeekOpen,
    setPartMenuOpen,
    t,
    threadOverflows,
  } = m;
  return (
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
  );
}

/**
 * The strip of actions above an open thread: Reply, Reply all, Forward,
 * Archive, Delete and the rest, with the ones that do not fit behind the
 * ellipsis.
 */
function ThreadActionStrip({
  m,
  showReplyAll,
  thread,
}: {
  m: ThreadPaneModel;
  showReplyAll: boolean;
  thread: MailThreadDetail;
}) {
  const {
    account,
    diaryBusy,
    focusMode,
    folders,
    fromDrafts,
    here,
    hidden,
    inJunk,
    inTrash,
    mode,
    moveMenuSignal,
    onArchive,
    onCancelSnooze,
    onDeleteForever,
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
    pinned,
    popOutThread,
    printThread,
    proposeDiaryFromThread,
    requestDiscard,
    setToolbarRowNode,
    shortcuts,
    snoozeMenuSignal,
    snoozedUntil,
    startForward,
    startReply,
    t,
    threadId,
    tightToolbar,
    unread,
    updateCrmFromThread,
    updatingCrm,
  } = m;
  return (
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
          // The same rule as the key: in the Drafts view, the draft —
          // composer open or not. Without one this sent the whole
          // conversation to Trash.
          onClick={() =>
            fromDrafts ? requestDiscard() : onTrash({ account, threadId })
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
      <ThreadStripEnd m={m} thread={thread} />
      </div>
    </div>
  );
}

/**
 * The right-hand end of the action strip: the ellipsis menu holding the
 * actions that do not fit, the thread's files, and the zoom.
 */
function ThreadStripEnd({
  m,
  thread,
}: {
  m: ThreadPaneModel;
  thread: MailThreadDetail;
}) {
  const {
    account,
    adjustZoomFromControls,
    folders,
    here,
    hidden,
    inTrash,
    olderParts,
    onArchive,
    onCancelSnooze,
    onJunk,
    onMoveToFolder,
    onMoveToInbox,
    onSnooze,
    onTogglePin,
    onToggleUnread,
    onTrash,
    pinned,
    popOutThread,
    printThread,
    setAttachmentPreview,
    shortcuts,
    showOverflowMenu,
    snoozedUntil,
    t,
    threadId,
    unread,
    updateCrmFromThread,
    updatingCrm,
    zoom,
  } = m;
  return (
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
  );
}
