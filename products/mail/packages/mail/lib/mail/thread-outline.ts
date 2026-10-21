/**
 * A thread's outline: every message, with who, when and the first words,
 * and no bodies (MailOutlineItem).
 *
 * The reader loads a long thread fifty messages at a time. Its outline
 * (components/mail/thread-outline.tsx) shows the whole thread, so it reads
 * this instead: one light request for all of it, from the same source the
 * thread itself is read from.
 *
 * - The local copy: its stored rows, which carry a snippet already.
 * - Gmail over its API: one `threads.get` in metadata format. Metadata does
 *   not say which messages carry files, so that mark is left out.
 * - Outlook over Graph: the conversation walked a hundred at a time, with
 *   the outline's fields selected and no bodies.
 * - Exchange, and a Gmail on an app password, have only the copy.
 */

import "server-only";

import { isAppPasswordGmail } from "@/lib/gmail/accounts";
import { getThreadMetadata, headerValue, parseAddressList } from "@/lib/gmail/api";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { messageDate } from "@/lib/mail/inbox-gmail-common";
import { outlineFromLocalStore } from "@/lib/mail/local-thread";
import { outlookAccessTokenFor } from "@/lib/mail/outlook-token";
import { resolveMailProvider } from "@/lib/mail/providers";
import type { MailOutlineItem } from "@/lib/mail/types";
import { graphAddress, listConversationOutline } from "@/lib/outlook/api";
import { isOwnOrgAddress, normalizeEmail } from "@/lib/own-addresses";

/** Gmail writes its snippets with HTML entities: `&#39;`, `&amp;`. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function own(account: string, email: string): boolean {
  return normalizeEmail(email) === normalizeEmail(account) || isOwnOrgAddress(email);
}

/** Copies of one message (Sent and Inbox) come once, the first kept. */
function oncePerMessage(items: MailOutlineItem[]): MailOutlineItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.rfcMessageId?.trim();
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function gmailOutline(account: string, threadId: string): Promise<MailOutlineItem[]> {
  const token = await accessTokenFor(account);
  const thread = await getThreadMetadata(token, threadId, ["From", "Date", "Message-ID"]);
  return (thread.messages ?? [])
    .filter((m) => !(m.labelIds ?? []).includes("DRAFT"))
    .map((m) => {
      const from = parseAddressList(headerValue(m, "From"))[0] ?? { email: "", name: "" };
      const at = messageDate(m);
      return {
        id: m.id,
        sentAt: at ? new Date(at).toISOString() : null,
        own: own(account, from.email),
        ...((m.labelIds ?? []).includes("UNREAD") ? { unread: true as const } : null),
        fromName: from.name || from.email,
        fromEmail: from.email,
        firstLine: decodeEntities(m.snippet ?? "").slice(0, 160),
        rfcMessageId: headerValue(m, "Message-ID") || null,
      };
    });
}

async function outlookOutline(account: string, threadId: string): Promise<MailOutlineItem[]> {
  const token = await outlookAccessTokenFor(account);
  const messages = await listConversationOutline(token, threadId);
  return messages.map((m) => {
    const from = graphAddress(m.from);
    const at = m.sentDateTime || m.receivedDateTime || null;
    return {
      id: m.id,
      sentAt: at,
      own: own(account, from.email),
      ...(m.isRead === false ? { unread: true as const } : null),
      fromName: from.name || from.email,
      fromEmail: from.email,
      firstLine: (m.bodyPreview ?? "").slice(0, 160),
      ...(m.hasAttachments ? { hasAttachments: true as const } : null),
      rfcMessageId: m.internetMessageId ?? null,
    };
  });
}

/** Every message of the thread, oldest first, as its outline shows it. */
export async function getMailThreadOutline(
  account: string,
  threadId: string
): Promise<MailOutlineItem[]> {
  const provider = await resolveMailProvider(account);
  if (provider === "outlook") return oncePerMessage(await outlookOutline(account, threadId));
  const stored = await outlineFromLocalStore(account, threadId);
  if (stored) return oncePerMessage(stored);
  if (provider === "exchange") return [];
  if (await isAppPasswordGmail(account)) return [];
  return oncePerMessage(await gmailOutline(account, threadId));
}
