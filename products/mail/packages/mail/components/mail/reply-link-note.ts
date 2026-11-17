/*
 * A reply went out under a new subject: tell the store which thread it
 * answers, so that thread can say "You replied … under a new subject"
 * (components/mail/thread-forward-mark.tsx, forward_links.rs).
 *
 * Called when the provider has taken the message, from both places a send
 * is confirmed: the conversation's own pane (use-thread-send.ts) and a send
 * with no pane (send-launch.ts). Best effort: a note that is not kept costs
 * only the mark.
 */

import type { OutboxEntry } from "@/components/mail/thread-messages";
import { mailApiJson } from "@/lib/mail/api";

export function noteReplyUnderNewSubject(account: string, threadId: string, entry: OutboxEntry): void {
  if (!entry.startsNewThread || entry.forward) return;
  const subject = (entry.request.subject ?? "").trim();
  if (!account || !threadId || !subject) return;
  void mailApiJson("/api/mail/reply-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      account,
      threadId,
      fromAccount: entry.fromAccount || entry.request.account,
      subject,
      // A contact list is the people in it.
      to: entry.toList.flatMap((who) =>
        "email" in who
          ? [{ name: who.name ?? "", email: who.email }]
          : who.members.map((member) => ({ name: member.name ?? "", email: member.email }))
      ),
    }),
  }).catch(() => undefined);
}
