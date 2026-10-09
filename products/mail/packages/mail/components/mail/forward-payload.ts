/*
 * What a forward carries: the forwarded message's own words, and under them
 * the conversation before it, newest first, each message with its own
 * "On …, … wrote:" line in a quote bar, the way other mail clients show a
 * chain. All of it goes under the "Forwarded message" header (inbox-send).
 *
 * The history is built from the thread, as a reply's is (quote-history.ts),
 * not taken from the message's own tail. A message written in chat style has
 * no tail, so a forward of it carried nothing of what came before; the
 * "Forward the whole conversation" box was there to make up for that, and
 * put the conversation oldest first. Building it every time makes every
 * forward whole, in the order a recipient expects.
 */

import type { ForwardedMessage } from "@/lib/mail/inbox-send";
import { buildQuoteHistory } from "@/lib/mail/quote-history";
import { messageStamp } from "@/lib/mail/date-format";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import { isPendingLocalMessage } from "@/lib/mail/local-message";
import { historyEntryOf } from "@/components/mail/thread-messages";

export function forwardPayload(input: {
  source: MailMessage;
  thread: MailThreadDetail;
  /** Earlier parts of a long conversation, oldest first. */
  olderParts: { messages: MailMessage[] }[];
}): ForwardedMessage {
  const { source, thread, olderParts } = input;
  // What is loaded, oldest first, and how many there are in all.
  const conversation = [...olderParts.flatMap((p) => p.messages), ...thread.messages].filter(
    (m) => !isPendingLocalMessage(m.id)
  );
  const total =
    olderParts.reduce((n, p) => n + p.messages.length, 0) + (thread.totalMessageCount ?? thread.messages.length);
  const subject = thread.subject;
  const own = historyEntryOf(source);
  const at = conversation.findIndex((m) => m.id === source.id);
  const earlier = at > 0 ? conversation.slice(0, at) : [];
  const history = earlier.length
    ? buildQuoteHistory(earlier.map(historyEntryOf), {
        // What is not loaded is older still, and is said as not shown.
        omittedBeyond: Math.max(0, total - conversation.length),
      })
    : null;
  return {
    fromName: source.fromName,
    fromEmail: source.fromEmail,
    date: messageStamp(source.sentAt),
    subject,
    to: source.toEmails,
    text: history ? `${own.text}\n\n${history.text}` : own.text,
    html: own.html ? own.html + (history?.html ?? "") : undefined,
  };
}
