/**
 * The forwards of a thread: the reader sent the mail on, and the provider
 * filed the forward as a thread of its own. The store finds them
 * (forward_links.rs); the thread says so under its title and opens the
 * forward, and the list row has an arrow. Nothing is joined.
 */

import "server-only";

import { mailStore } from "@/lib/mail/store";
import type { MailForwardLink } from "@/lib/mail/store/types";

export async function getForwardLinks(account: string, threadId: string): Promise<MailForwardLink[]> {
  const store = mailStore();
  if (!store.messages.forwardLinks) return [];
  return store.messages.forwardLinks(account, threadId);
}

/** The page sent a reply under a new subject: keep which thread it answers, so that thread can say so. */
export async function noteReplyApart(note: {
  account: string;
  threadId: string;
  fromAccount: string;
  subject: string;
  to: { name?: string; email: string }[];
}): Promise<void> {
  await mailStore().messages.noteReplyApart?.(note);
}
