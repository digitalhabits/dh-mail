/**
 * Conversations: provider threads grouped into one talk, split into parts.
 *
 * The rules live here. Mail decides the title, the participant fingerprint,
 * every id, and when a part rotates. The store writes what it is given. See
 * `@/lib/mail/store/types`.
 */

import { newMailId } from "@/lib/mail/uuid";

import { mailStore } from "@/lib/mail/store";
import {
  chatPartSubject,
  chatTitleFromCounterpart,
  type MailChatDetail,
  type MailChatPartSummary,
  type MailChatRef,
} from "@/lib/mail/chat-types";
import { resolveMailProvider } from "@/lib/mail/providers";
import { PlanError } from "@/lib/plan/errors";
import { normalizeEmail } from "@/lib/own-addresses";

import type { MailChatBinding } from "@/lib/mail/store/types";

export {
  chatPartSubject,
  chatTitleFromCounterpart,
  type MailChatDetail,
  type MailChatPartSummary,
  type MailChatRef,
};

function fingerprintFor(emails: string[]): string {
  const keys = [
    ...new Set(emails.map(normalizeEmail).filter(Boolean)),
  ].sort();
  return keys.join("|") || "empty";
}

function chatDetailFromBinding(
  binding: MailChatBinding,
  counterpartLabel: string
): MailChatDetail {
  return {
    chatId: binding.chatId,
    title: binding.title,
    partIndex: binding.partIndex,
    partCount: binding.partCount,
    subject: binding.subject,
    isOpenPart: binding.partStatus === "open",
    noQuote: binding.noQuote,
    participantEmails: binding.participantEmails,
    rotateAt: clampRotateAt(binding.rotateAt),
    messageCount: binding.messageCount,
    counterpartLabel,
  };
}

/**
 * Rotate a part before the provider splits it for us.
 *
 * Reports put Gmail's own conversation split at about 100 messages, and a
 * split Gmail makes is a thread we never bound. 80 stays under that, and an
 * 80-message part also fits one Graph page, which is what makes Outlook's
 * local sort exact. See docs/mail-chat-architecture.md.
 */
const DEFAULT_ROTATE_AT = 80;

/**
 * Bindings from before this decision carry rotateAt 1000, which is above
 * every provider's own split. Clamp on read rather than migrate: the value
 * was never a promise to anyone, and a migration can miss a store.
 */
function clampRotateAt(stored: number): number {
  return Math.min(Math.max(1, stored || DEFAULT_ROTATE_AT), DEFAULT_ROTATE_AT);
}

/** Chat metadata for a provider thread, if bound. */
export async function getChatForThread(
  account: string,
  threadId: string,
  counterpartLabel?: string
): Promise<MailChatDetail | null> {
  const binding = await mailStore().chats.findBinding(account, threadId);
  if (!binding) return null;
  return chatDetailFromBinding(binding, counterpartLabel || binding.title);
}

/** Batch lookup for inbox list rows. */
export async function getChatsForThreads(
  keys: { account: string; threadId: string }[]
): Promise<Map<string, MailChatRef>> {
  const out = new Map<string, MailChatRef>();
  if (!keys.length) return out;

  const bindings = await mailStore().chats.findBindings(keys);
  for (const [key, binding] of bindings) {
    out.set(key, {
      chatId: binding.chatId,
      title: binding.title,
      partIndex: binding.partIndex,
      partCount: binding.partCount,
      subject: binding.subject,
      isOpenPart: binding.partStatus === "open",
      noQuote: binding.noQuote,
    });
  }
  return out;
}

/**
 * Bind a provider thread into a conversation (for parts + optional chat-style).
 * Keeps the human subject; does not brand “DH Chat”.
 */
export async function ensureThreadConversation(input: {
  account: string;
  threadId: string;
  title?: string;
  subject?: string;
  participantEmails: string[];
  counterpartName: string;
  counterpartEmail: string;
  messageCount?: number;
  noQuote?: boolean;
}): Promise<MailChatDetail> {
  const existing = await getChatForThread(input.account, input.threadId);
  if (existing) {
    if (input.noQuote != null && existing.noQuote !== input.noQuote) {
      return setThreadChatStyle({
        account: input.account,
        threadId: input.threadId,
        noQuote: input.noQuote,
      });
    }
    return existing;
  }

  const title =
    input.title?.trim() ||
    chatTitleFromCounterpart(input.counterpartName, input.counterpartEmail);
  const participants = [
    ...new Set(
      input.participantEmails.map((e) => e.trim()).filter(Boolean)
    ),
  ];
  const fp = fingerprintFor(participants);
  const provider = await resolveMailProvider(input.account);
  const chatId = newMailId();
  const partId = newMailId();
  const subject = chatPartSubject(title, 1, input.subject);
  const messageCount = Math.max(0, input.messageCount ?? 0);
  const noQuote = Boolean(input.noQuote);

  await mailStore().chats.createConversation({
    chatId,
    title,
    createdByAccount: input.account,
    participantFingerprint: fp,
    participantEmails: participants,
    rotateAt: DEFAULT_ROTATE_AT,
    noQuote,
    partId,
    subject,
    messageCount,
    provider,
    threadId: input.threadId,
  });

  return {
    chatId,
    title,
    partIndex: 1,
    partCount: 1,
    subject,
    isOpenPart: true,
    noQuote,
    participantEmails: participants,
    rotateAt: DEFAULT_ROTATE_AT,
    messageCount,
    counterpartLabel: title,
  };
}

/** @deprecated Use ensureThreadConversation — kept for older call sites. */
export async function promoteThreadToChat(input: {
  account: string;
  threadId: string;
  title?: string;
  participantEmails: string[];
  counterpartName: string;
  counterpartEmail: string;
  messageCount?: number;
}): Promise<MailChatDetail> {
  return ensureThreadConversation({ ...input, noQuote: true });
}

/** Sticky chat-style (no-quote) preference for a conversation. */
export async function setThreadChatStyle(input: {
  account: string;
  threadId: string;
  noQuote: boolean;
  /** Used when creating a conversation on first enable. */
  title?: string;
  subject?: string;
  participantEmails?: string[];
  counterpartName?: string;
  counterpartEmail?: string;
  messageCount?: number;
}): Promise<MailChatDetail> {
  const existing = await getChatForThread(input.account, input.threadId);
  if (!existing) {
    if (!input.noQuote) {
      throw new PlanError("No conversation prefs for this thread", 404);
    }
    return ensureThreadConversation({
      account: input.account,
      threadId: input.threadId,
      title: input.title,
      subject: input.subject,
      participantEmails: input.participantEmails ?? [],
      counterpartName: input.counterpartName ?? "",
      counterpartEmail: input.counterpartEmail ?? "",
      messageCount: input.messageCount,
      noQuote: true,
    });
  }

  await mailStore().chats.setNoQuote(existing.chatId, input.noQuote);
  return { ...existing, noQuote: input.noQuote };
}

/**
 * Resolve the open part for sending. If at rotate threshold, close it and
 * open the next part (caller sends without provider thread id).
 */
export async function prepareChatSend(input: {
  account: string;
  threadId: string;
}): Promise<{
  chat: MailChatDetail;
  /** Provider thread for this send; null when starting a brand-new part. */
  sendThreadId: string | null;
  /** True when this send opens a new part (show first-part toast). */
  rotated: boolean;
  subject: string;
}> {
  const chat = await getChatForThread(input.account, input.threadId);
  if (!chat) {
    throw new PlanError("This thread has no conversation binding", 400);
  }

  const open = await mailStore().chats.findOpenPart(chat.chatId);
  if (!open) throw new PlanError("Conversation has no open part", 500);

  // Sending from a closed historical part: still use the open part.
  const openThreadId = await mailStore().chats.findPartThreadId(
    open.partId,
    input.account
  );

  if (open.messageCount >= chat.rotateAt) {
    const nextIndex = open.partIndex + 1;
    // Keep the same subject — parting is invisible plumbing.
    const nextSubject = chatPartSubject(chat.title, nextIndex, open.subject);
    const nextPartId = newMailId();
    await mailStore().chats.rotatePart({
      chatId: chat.chatId,
      closePartId: open.partId,
      nextPartId,
      nextIndex,
      nextSubject,
    });

    return {
      chat: {
        ...chat,
        partIndex: nextIndex,
        partCount: chat.partCount + 1,
        subject: nextSubject,
        isOpenPart: true,
        messageCount: 0,
      },
      sendThreadId: null,
      rotated: true,
      subject: nextSubject,
    };
  }

  return {
    chat: {
      ...chat,
      partIndex: open.partIndex,
      subject: open.subject,
      isOpenPart: true,
      messageCount: open.messageCount,
    },
    sendThreadId: openThreadId ?? input.threadId,
    rotated: false,
    subject: open.subject,
  };
}

/** Remember a bound thread's Message-IDs. Best effort, never throws. */
export async function noteChatMessageIds(
  account: string,
  threadId: string,
  messageIds: (string | undefined)[]
): Promise<void> {
  const ids = messageIds.filter((x): x is string => Boolean(x));
  if (!ids.length) return;
  await mailStore()
    .chats.rememberMessageIds({ account, threadId, messageIds: ids })
    .catch(() => undefined);
}

/**
 * Bind a thread the provider split off back to its conversation.
 *
 * Gmail starts a new thread at about 100 messages. The new thread's messages
 * still reference Message-IDs from the old one, because a split changes the
 * grouping and not the headers. When an unbound thread's oldest message
 * references an id a conversation holds, that thread is the conversation's
 * next part.
 *
 * A forward references chat messages too, and is not the chat. So a thread
 * with anyone on it who is not in the conversation is left alone.
 *
 * Answers the adopted binding, or null when this thread is not a
 * continuation of anything.
 */
export async function adoptSplitThread(input: {
  account: string;
  threadId: string;
  subject?: string;
  /** Ids from the oldest loaded message's References and In-Reply-To. */
  referencedIds: string[];
  /** Everyone on the thread, with our own addresses already removed. */
  counterpartEmails: string[];
}): Promise<MailChatDetail | null> {
  const ids = [...new Set(input.referencedIds.filter(Boolean))];
  if (!ids.length) return null;
  const hit = await mailStore().chats.findByMessageIds(input.account, ids);
  if (!hit) return null;

  const known = new Set(
    hit.participantEmails.map((e) => e.trim().toLowerCase())
  );
  known.add(input.account.trim().toLowerCase());
  const stranger = input.counterpartEmails.some(
    (e) => !known.has(e.trim().toLowerCase())
  );
  if (stranger) return null;

  const open = await mailStore().chats.findOpenPart(hit.chatId);
  if (!open) return null;

  const nextIndex = open.partIndex + 1;
  const nextPartId = newMailId();
  const provider = await resolveMailProvider(input.account);
  await mailStore().chats.rotatePart({
    chatId: hit.chatId,
    closePartId: open.partId,
    nextPartId,
    nextIndex,
    // The split thread keeps the old subject, and so does its part.
    nextSubject: chatPartSubject(hit.title, nextIndex, input.subject),
  });
  await mailStore().chats.bindThread({
    partId: nextPartId,
    account: input.account,
    provider,
    threadId: input.threadId,
    tipMessageId: null,
  });
  await mailStore().chats.touch(hit.chatId);
  return getChatForThread(input.account, input.threadId);
}

/** After a successful chat send: bump count and bind thread if new part. */
export async function recordChatSend(input: {
  account: string;
  chatId: string;
  subject: string;
  providerThreadId: string;
  tipMessageId?: string;
}): Promise<MailChatDetail> {
  const provider = await resolveMailProvider(input.account);
  const part = await mailStore().chats.findOpenPart(input.chatId);
  if (!part) throw new PlanError("Chat has no open part", 500);

  await mailStore().chats.addMessageToPart(part.partId);
  await mailStore().chats.bindThread({
    partId: part.partId,
    account: input.account,
    provider,
    threadId: input.providerThreadId,
    tipMessageId: input.tipMessageId ?? null,
  });
  if (input.tipMessageId) {
    // Our send is the message a provider split is most likely to reference.
    await noteChatMessageIds(input.account, input.providerThreadId, [
      input.tipMessageId,
    ]);
  }
  await mailStore().chats.touch(input.chatId);

  const detail = await getChatForThread(input.account, input.providerThreadId);
  if (!detail) throw new PlanError("Couldn't refresh chat after send", 500);
  return detail;
}

/** All parts for a chat, with this mailbox's provider thread ids. */
export async function listChatParts(
  account: string,
  chatId: string
): Promise<MailChatPartSummary[]> {
  return mailStore().chats.listParts(account, chatId);
}

/** Fork draft metadata for Leave chat (chat itself is unchanged). */
export async function leaveChatForkInfo(input: {
  account: string;
  threadId: string;
}): Promise<{
  to: string[];
  subject: string;
  continuedFromLabel: string;
  chat: MailChatDetail;
}> {
  const chat = await getChatForThread(input.account, input.threadId);
  if (!chat) throw new PlanError("This thread is not a chat", 400);
  return {
    to: chat.participantEmails.length
      ? chat.participantEmails
      : [chat.counterpartLabel].filter((e) => e.includes("@")),
    subject: chat.title,
    continuedFromLabel: chat.counterpartLabel || chat.title,
    chat,
  };
}
