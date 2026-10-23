/**
 * A reply and the thread it answers, when the provider keeps them apart.
 *
 * The reader answered from a mailbox that is not connected (Outlook, with a
 * college address), and the reply came back in a CC under a thread of its
 * own. The store finds the pair (answer_links.rs); the thread view shows a
 * link in each. Nothing is joined: every action stays on its own thread.
 */

import "server-only";

import { mailStore } from "@/lib/mail/store";
import type { MailAnswerLink } from "@/lib/mail/store/types";

export async function getAnswerLinks(account: string, threadId: string, own: string[]): Promise<MailAnswerLink[]> {
  const store = mailStore();
  if (!store.messages.answerLinks) return [];
  const addresses = [...new Set([account, ...own].map((a) => a.trim().toLowerCase()).filter(Boolean))];
  return store.messages.answerLinks(account, threadId, addresses);
}
