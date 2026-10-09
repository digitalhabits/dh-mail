/**
 * The thread's history, rebuilt for the tail of the next reply.
 *
 * Classic mail inherits its tail from the mail it answers; this rebuilds it
 * from the thread instead, so it survives a chat-style mail in the middle
 * and stays the same whichever composer sends the reply — the thread pane's
 * box or the floating one. One builder, so the two cannot drift.
 */

import { formatEmailBody, stripQuotedReplies } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { messageStamp } from "@/lib/mail/date-format";
import {
  buildQuoteHistory,
  REPLY_HISTORY_CAP,
} from "@/lib/mail/quote-history";
import type { MailMessage } from "@/lib/mail/types";

/** One message, reduced to what the tail quotes of it. */
export function replyHistoryEntry(
  m: MailMessage,
  html?: string
): {
  fromName: string;
  fromEmail: string;
  date: string;
  text: string;
  html?: string;
} {
  const full = decodeHtmlEntities(formatEmailBody(m.bodyText)).trim();
  const ownWords = stripQuotedReplies(full).trim();
  return {
    fromName:
      m.fromName === "You" ||
      m.fromName.toLowerCase() === m.fromEmail.toLowerCase()
        ? ""
        : m.fromName,
    fromEmail: m.fromEmail,
    date: messageStamp(m.sentAt),
    text: ownWords || full,
    html,
  };
}

/**
 * The appendix a reply carries under itself.
 *
 * `messages` is everything loaded, oldest first, pending local bubbles
 * already dropped. `total` is what the whole thread holds, so the note
 * under the tail can say how much of the conversation it is not.
 */
export function replyHistoryAppendix(
  messages: MailMessage[],
  total: number,
  htmlOf?: (m: MailMessage) => string | undefined
): { text: string; html: string } | null {
  if (!messages.length) return null;
  const kept = messages.slice(-REPLY_HISTORY_CAP);
  return buildQuoteHistory(
    kept.map((m) => replyHistoryEntry(m, htmlOf?.(m))),
    { omittedBeyond: Math.max(0, total - kept.length) }
  );
}
