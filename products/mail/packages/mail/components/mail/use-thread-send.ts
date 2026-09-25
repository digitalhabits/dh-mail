"use client";

/*
 * Send, forward, the outbox and Undo for the open thread, off the pane
 * component: the message that goes out, the bubble that stands in the
 * thread before the provider has it, the few seconds in which Send can be
 * taken back, and the retry after a failure.
 *
 * This hook reads the composer and does not own it. It receives the fields
 * that it reads, one by one, and each dependency list names exactly those
 * fields. `reply` changes on each keystroke, so a list that names more than
 * a callback reads makes that callback again on each key press. A list that
 * names less sends the value of an earlier render, which happened three
 * times. If a callback needs a new value, add it to the input and to that
 * callback's list, and to no other.
 *
 * It writes the composer in two ways only: `closeComposer` after a send, and
 * `restoreComposer` for Undo and for a forward that failed. Its two effects
 * only keep a ref up to date: is the pane still here, and is a composer
 * open. The pane keeps the two effects that clear the outbox, at the place
 * where they always ran, and they write through `resetOutbox` and
 * `dropSettledOutboxRows`.
 *
 * Every message waits out the Undo count: a reply, a reply under a new
 * subject, and a forward. A reaction and a message that Outlook holds until
 * a set time do not, and each says why where it is sent.
 *
 * New work on sending goes in this file, not in ThreadPane.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { promisesAnAttachment } from "@/lib/mail/attachment-hint";
import { sanitizeEmailHtml } from "@/lib/mail/email-html";
import {
  quotedReplyMessage,
  reactionMessage,
} from "@/lib/mail/reaction-message";
import { sendWithUndo } from "@/components/mail/undo-send";
import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { notifyScheduledChanged } from "@/lib/mail/scheduled-events";
import { bodyToEmailHtml } from "@/lib/client-email-html";
import { formatEmailBody } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import type { MailChatRef } from "@/lib/mail/chat-types";
import {
  flattenRecipientsForSend,
  formatRecipientSummary,
  recipientsFromEmails,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import { messageStamp } from "@/lib/mail/date-format";
import { type CrmProposeResult } from "@/components/mail/crm-proposal-parts";
import { showCrmProposal } from "@/components/mail/CrmProposalHost";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import { mailSay } from "@/lib/mail/i18n";
import {
  OutboxEntry,
  scheduleThreadRefetchAfterSend,
  type ComposerMode,
} from "@/components/mail/thread-messages";
import { toastCrmNotesResult } from "@/components/mail/thread-crm-notes";
import type { OlderThreadPart } from "@/components/mail/use-thread-stream";
import type { ReadableThreadAttachment } from "@/components/mail/use-thread-assistant";
import type { useDraftAttachments } from "@/components/mail/draft-attachments";
import type { useThreadComposer } from "@/components/mail/use-thread-composer";
import { readyAttachmentsForDraft } from "@/lib/mail/local-drafts";

/** The quoted message as a send carries it. */
type QuotePayload = Parameters<typeof quotedReplyMessage>[1];
/** What a reaction says it answers. */
type ReactionQuote = Parameters<typeof reactionMessage>[1];
type Strip = ReturnType<typeof useDraftAttachments>;
type Composer = ReturnType<typeof useThreadComposer>;

export function useThreadSend(input: {
  account: string;
  threadId: string;
  thread: MailThreadDetail | null;
  olderParts: OlderThreadPart[];
  setThread: React.Dispatch<React.SetStateAction<MailThreadDetail | null>>;
  // The composer's fields that a send reads — see the top of the file.
  mode: ComposerMode | null;
  reply: string;
  replyText: string;
  subjectDraft: string;
  toList: MailRecipient[];
  ccList: MailRecipient[];
  showCc: boolean;
  editRecipients: boolean;
  includeSignature: boolean;
  fromAccount: string;
  quoteMessageId: string | null;
  updateCrmNotes: boolean;
  // What the pane works out from them and from the thread.
  forwardSource: MailMessage | undefined;
  forwardWholeAppendix: { text: string; html: string } | null;
  /** The two boxes under a forward, so that Undo can put them back. */
  forwardFiles: boolean;
  forwardConversation: MailMessage[] | null;
  restoreForwardBoxes: (boxes: {
    includeFiles: boolean;
    conversation: MailMessage[] | null;
  }) => void;
  outgoingSubject: string;
  replySubject: string;
  startsNewThread: boolean;
  quotePayload: QuotePayload;
  historyAppendix: { text: string; html: string } | null;
  /** The strip as it stands, so that Undo after Send can put it back. */
  attachItems: Strip["items"];
  attachmentPayload: Strip["payload"];
  attachmentsReady: boolean;
  closeComposer: Composer["close"];
  restoreComposer: Composer["restore"];
  focusReply: (caret?: number | null) => void;
  /** Closes the floating card, when this pane is the card. */
  closeFloatingCardRef: React.RefObject<() => void>;
  /** The provider draft this composer was opened from, if any. */
  importedDraftRef: React.RefObject<string | null>;
  loadScheduled: () => Promise<void> | void;
  readableAttachments: ReadableThreadAttachment[];
  crmChanged: () => void;
  onSent?: (accountEmail: string) => void;
  onChatPromoted: (chat: MailChatRef) => void;
  onChatThreadChanged: (
    threadId: string,
    chat: MailChatRef,
    focusMessageId?: string
  ) => void;
}) {
  const {
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
  } = input;

  const [sending, setSending] = React.useState(false);
  /** Optimistic sends keyed by local-* message id (pending / failed). */
  const [outbox, setOutbox] = React.useState<Record<string, OutboxEntry>>({});
  /** Brief color-in flash after the provider accepts a send. */
  const [confirmingIds, setConfirmingIds] = React.useState<Set<string>>(
    () => new Set()
  );
  /** A send held back because the words promise a file and none is on it. */
  const [forgottenAttachment, setForgottenAttachment] = React.useState<{
    sendAt?: string;
    extras?: { proposeCrm?: boolean };
  } | null>(null);
  const clearForgottenAttachment = React.useCallback(
    () => setForgottenAttachment(null),
    []
  );

  /**
   * Is the pane still here, and is a composer open in it.
   *
   * A send settles seconds after Send was pressed. By then the reader can be
   * in another thread, or writing something else in this one. A forward that
   * failed comes back into the composer only when there is a pane to come
   * back to and nothing in it to write over.
   */
  const paneAliveRef = React.useRef(true);
  React.useEffect(() => {
    paneAliveRef.current = true;
    return () => {
      paneAliveRef.current = false;
    };
  }, []);
  const composerOpenRef = React.useRef(false);
  React.useEffect(() => {
    composerOpenRef.current = Boolean(mode);
  }, [mode]);

  /**
   * Take a held or failed message back into the composer, as it was written.
   *
   * Given the entry, not read from `outbox`: Undo reads the newest outbox,
   * but a failure is handled by the send that made it, which knows its entry
   * and may be older than the newest render.
   */
  const putBackFromOutbox = React.useCallback(
    (localId: string, entry: OutboxEntry) => {
      setOutbox((prev) => {
        if (!(localId in prev)) return prev;
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
      restoreComposer(
        {
          mode: entry.mode,
          reply: entry.reply,
          subject: entry.subject,
          toList: entry.toList,
          ccList: entry.ccList,
          showCc: entry.showCc,
          editRecipients: entry.editRecipients,
          includeSignature: entry.includeSignature,
          fromAccount: entry.fromAccount,
          updateCrmNotes: Boolean(entry.request.updateCrmNotes),
          // A forward names the message it carries. A reply leaves the pick
          // as it is, which is what it always did.
          ...(entry.forward
            ? { quoteMessageId: entry.forward.quoteMessageId }
            : {}),
        },
        // The files that Send took out of the strip. A reaction has none.
        entry.attachments ?? []
      );
      if (entry.forward) {
        restoreForwardBoxes({
          includeFiles: entry.forward.includeFiles,
          conversation: entry.forward.conversation,
        });
      }
      focusReply();
    },
    [focusReply, restoreComposer, restoreForwardBoxes, setThread]
  );

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
        // A forward is not part of this conversation, so an answer about
        // the chat is not about this thread.
        if (
          !entry.forward &&
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
        if (json.chat && !entry.forward) {
          setThread((current) =>
            current ? { ...current, chat: json.chat } : current
          );
          onChatPromoted(json.chat);
        }
        // Provider accepted the send — color the bubble in. Thread refetch
        // still replaces local-* with the real message id when it appears.
        markOutboxConfirmed(localId);
        // The thread has no bubble for these, so the toast is all there is
        // to say it went.
        if (entry.forward) {
          toast.success(mailSay("forwardedTo", { who: entry.forward.who }));
        } else if (entry.startsNewThread) {
          toast.success(mailSay("sent"));
        }
        onSent?.(entry.request.account);
        scheduleThreadRefetchAfterSend(account, threadId, setThread);
      } catch (err) {
        /**
         * A forward has no bubble, so it has no red bubble with a retry to
         * come back to. It goes back into the composer, as it did before it
         * had a count: the words, the recipients and the files are there,
         * and Send is the retry. Only when the pane is still here and no
         * other message is being written in it. If not, the toast below
         * carries the retry, as it does for a reply.
         */
        if (entry.forward && paneAliveRef.current && !composerOpenRef.current) {
          putBackFromOutbox(localId, entry);
          toast.error(
            err instanceof Error ? err.message : "Couldn't forward",
            { duration: 15_000 }
          );
          return;
        }
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
        const what = entry.forward ? "forward" : "reply";
        toast.error(`Your ${what} to ${firstTo} did not send`, {
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
      setThread,
      putBackFromOutbox,
    ]
  );
  /* Through a ref so the failure toast's Retry reaches the newest version
     of the dispatch rather than the one closed over when it was shown. */
  dispatchOutboxSendRef.current = dispatchOutboxSend;

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
      subject: subjectDraft,
      startsNewThread,
      toList,
      ccList,
      showCc,
      editRecipients,
      includeSignature,
      fromAccount,
      // Taken now: `closeComposer` below empties the strip.
      attachments: readyAttachmentsForDraft(attachItems),
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
        threadId: crossAccount || startsNewThread ? undefined : threadId,
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
        closeFloatingCardRef.current();
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
    /* Not into this thread when it is not going there. The bubble would
       stand under the conversation it was written from until the next
       fetch of that thread quietly took it away again. */
    if (!startsNewThread) {
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
    }
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
      onSend: () => {
        void dispatchOutboxSend(localId, entry);
        // And now the card, which was this message and nothing else. The
        // send takes what it needs with it, so nothing here is waited for.
        closeFloatingCardRef.current();
      },
      // With the entry, not by a look in the outbox. Each new answer about
      // the thread clears the outbox of rows that have no bubble, and a
      // message with no bubble would then have nothing to come back from.
      onUndo: () => putBackFromOutbox(localId, entry),
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
    // The pick, not only the quote. If the picked message is the newest one,
    // the quote is the same object with a pick and without one.
    quoteMessageId,
    historyAppendix,
    closeComposer,
    attachmentsReady,
    attachmentPayload,
    // The strip's files, which the outbox entry carries so that Undo puts
    // them back with the words.
    attachItems,
    olderParts,
    mode,
    showCc,
    editRecipients,
    updateCrmNotes,
    dispatchOutboxSend,
    loadScheduled,
    // The subject the writer set. Without it the callback keeps the first
    // render's answer and sends the thread's own name over a changed one.
    outgoingSubject,
    // And the box it was typed in, which the outbox entry carries so that
    // Undo puts the subject back with the words.
    subjectDraft,
    startsNewThread,
    setThread,
    importedDraftRef,
    closeFloatingCardRef,
    putBackFromOutbox,
  ]);

  const retryOutboxSend = React.useCallback(
    (localId: string) => {
      const entry = outbox[localId];
      if (!entry || entry.status !== "failed" || sending) return;
      void dispatchOutboxSend(localId, entry);
    },
    [outbox, sending, dispatchOutboxSend]
  );

  /** Edit on a bubble that failed: back into the composer, as it was written. */
  const editOutboxSend = React.useCallback(
    (localId: string) => {
      const entry = outbox[localId];
      if (!entry) return;
      putBackFromOutbox(localId, entry);
    },
    [outbox, putBackFromOutbox]
  );

  /**
   * Forward, with the same few seconds as a reply.
   *
   * It went straight out once, and a forward is the message most likely to
   * go to the wrong person: the recipient is typed fresh each time. So it is
   * held like a reply. The whole request is made now, because the composer
   * closes now and the boxes under it reset. Undo puts all of it back.
   *
   * No bubble goes into this thread. The message is for somebody else, and
   * the toast says that it went.
   */
  const sendForward = React.useCallback(() => {
    const flatTo = flattenRecipientsForSend(toList);
    const flatCc = flattenRecipientsForSend(ccList);
    if (!thread || !forwardSource || !flatTo.emails.length || sending) return;
    if (!attachmentsReady) {
      toast.error(mailSay("stillPreparingAttachments"));
      return;
    }
    const attachments = attachmentPayload();
    const bcc = [...flatTo.bccEmails, ...flatCc.bccEmails];
    const localId = `local-${Date.now()}`;
    const entry: OutboxEntry = {
      status: "sending",
      mode: "forward",
      reply,
      subject: subjectDraft,
      toList,
      ccList,
      showCc,
      editRecipients,
      includeSignature,
      fromAccount,
      // Taken now: `closeComposer` below empties the strip.
      attachments: readyAttachmentsForDraft(attachItems),
      forward: {
        quoteMessageId,
        includeFiles: forwardFiles,
        conversation: forwardWholeAppendix ? forwardConversation : null,
        who: formatRecipientSummary(toList),
      },
      request: {
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
      },
    };
    setOutbox((prev) => ({ ...prev, [localId]: entry }));
    closeComposer();
    sendWithUndo({
      onSend: () => {
        void dispatchOutboxSend(localId, entry);
        // And now the card, if this forward was written in one.
        closeFloatingCardRef.current();
      },
      // With the entry, not by a look in the outbox. Each new answer about
      // the thread clears the outbox of rows that have no bubble, and a
      // message with no bubble would then have nothing to come back from.
      onUndo: () => putBackFromOutbox(localId, entry),
    });
  }, [
    thread,
    forwardSource,
    forwardWholeAppendix,
    forwardFiles,
    forwardConversation,
    toList,
    ccList,
    showCc,
    editRecipients,
    // Not `forwardSubject`. The send reads the subject that the writer set,
    // and a list without it sent the subject of an earlier render.
    outgoingSubject,
    // And the box it was typed in, which Undo puts back.
    subjectDraft,
    quoteMessageId,
    sending,
    fromAccount,
    reply,
    replyText,
    includeSignature,
    closeComposer,
    attachmentsReady,
    attachmentPayload,
    // The strip's files, which the outbox entry carries for Undo.
    attachItems,
    dispatchOutboxSend,
    closeFloatingCardRef,
    putBackFromOutbox,
  ]);

  /** Gmail-style quick reaction: replies with just the emoji (+ quoted history). */
  const sendQuickReply = React.useCallback(
    async (emoji: string, quoteOverride?: ReactionQuote) => {
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
        // A reaction is never under a subject of its own.
        subject: "",
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
      replySubject,
      setThread,
    ]
  );

  /** Another thread: no send of the last one waits in this pane. */
  const resetOutbox = React.useCallback(() => {
    setOutbox({});
    setConfirmingIds(new Set());
  }, []);

  /** Drop outbox rows once the provider message replaced the local-* bubble. */
  const dropSettledOutboxRows = React.useCallback(
    (loaded: MailThreadDetail) => {
      const ids = new Set(loaded.messages.map((m) => m.id));
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
    },
    []
  );

  return {
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
  };
}
