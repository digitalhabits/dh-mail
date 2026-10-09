"use client";

/*
 * What a reply says and quotes, off useThreadPane: its subject (Re:, Fwd:,
 * or one that was typed, and whether that starts a new conversation), the
 * message it quotes and the history under it, and the words in the empty
 * box.
 *
 * Memos and callbacks only; no effects. useThreadPane calls this hook where
 * these stood.
 */

import * as React from "react";

import { sanitizeEmailHtml } from "@/lib/mail/email-html";
import { isPendingLocalMessage } from "@/components/mail/MailBubble";
import { formatEmailBody } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import {
  buildQuoteHistory,
  REPLY_HISTORY_CAP,
} from "@/lib/mail/quote-history";
import {
  replyPlaceholder,
  replyPlaceholderNames,
} from "@/lib/mail/reply-placeholder";
import { messageStamp } from "@/lib/mail/date-format";
import type { MailMessage } from "@/lib/mail/types";
import { historyEntryOf } from "@/components/mail/thread-messages";

import type { MailRecipient } from "@/lib/mail/contact-list-types";
import type { OlderThreadPart } from "@/components/mail/use-thread-stream";
import type { MailThreadDetail } from "@/lib/mail/types";

export function useReplyContent({
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
}: {
  account: string;
  ccList: MailRecipient[];
  forwardSource: MailMessage | undefined;
  forwarding: boolean;
  fromAccount: string;
  olderParts: OlderThreadPart[];
  quoteMessageId: string | null;
  subjectDraft: string;
  thread: MailThreadDetail | null;
  toList: MailRecipient[];
}) {
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

  return {
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
  };
}
