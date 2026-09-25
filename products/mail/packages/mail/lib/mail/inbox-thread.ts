/*
 * One thread, a page of its messages at a time: from Outlook, the local
 * copy or the Gmail API.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */

import "server-only";

import { threadFromLocalStore } from "@/lib/mail/local-thread";
import { extractAttachments, extractBodyHtml, extractBodyText, getMessageFull, getThreadFull, getThreadMinimal, headerValue, modifyThreadLabels, parseAddressList, resolveInlineImages, type GmailMessage } from "@/lib/gmail/api";
import { mailStore } from "@/lib/mail/store";
import { dedupeMessagesByRfcId } from "@/lib/mail/thread-copies";
import { replyTargets } from "@/lib/mail/reply-target";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { adoptSplitThread, getChatForThread, noteChatMessageIds } from "@/lib/mail/chats";
import { getOutlookMailThread } from "@/lib/mail/outlook-inbox";
import { resolveMailProvider } from "@/lib/mail/providers";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import { isOwnOrgAddress } from "@/lib/own-addresses";
import { THREAD_PAGE_SIZE } from "@/lib/mail/thread-classify";
import { emptyThreadDetail, threadWindow } from "@/lib/mail/thread-window";
import { mapWithConcurrency, messageDate } from "@/lib/mail/inbox-gmail-common";
import { participantNames } from "@/lib/mail/thread-participants";

// ---------------------------------------------------------------------------
// Thread detail
// ---------------------------------------------------------------------------


/** One Gmail message as the reader sees it, bodies and headers resolved. */
async function gmailMailMessage(
  token: string,
  account: string,
  m: GmailMessage
): Promise<MailMessage> {
  const from = parseAddressList(headerValue(m, "From"))[0] ?? {
    email: "",
    name: "",
  };
  const own = from.email === account || isOwnOrgAddress(from.email);
  const bodyHtml = extractBodyHtml(m) || undefined;
  // Embedded (cid:) images live in the message itself, so resolving them
  // is privacy-safe — unlike remote images, which stay behind the toggle.
  const inlineImages =
    bodyHtml && bodyHtml.includes("cid:")
      ? await resolveInlineImages(token, m, bodyHtml)
      : undefined;
  const attachments = extractAttachments(m, bodyHtml ?? "");
  return {
    id: m.id,
    fromName: from.name || from.email,
    fromEmail: from.email,
    toEmails: parseAddressList(headerValue(m, "To")).map((p) => p.email),
    ccEmails: parseAddressList(headerValue(m, "Cc")).map((p) => p.email),
    sentAt: messageDate(m) ? new Date(messageDate(m)).toISOString() : null,
    bodyText: extractBodyText(m),
    bodyHtml,
    inlineImages:
      inlineImages && Object.keys(inlineImages).length
        ? inlineImages
        : undefined,
    attachments: attachments.length ? attachments : undefined,
    own,
    // The protocol's own thread identity. Provider thread ids are views;
    // these headers are what a conversation is actually made of.
    rfcMessageId: headerValue(m, "Message-ID").trim() || undefined,
    inReplyTo: headerValue(m, "In-Reply-To").trim() || undefined,
    references: headerValue(m, "References").trim() || undefined,
  };
}

export async function getMailThread(
  account: string,
  threadId: string,
  options?: {
    before?: string;
    after?: string;
    around?: string;
    /**
     * The oldest page, rather than the newest.
     *
     * The id list already says where a thread begins, so the beginning is one
     * request away at any size. Walking back a window at a time to reach it
     * would read the whole thread to show its first message.
     *
     * With `limit: 1` this answers the first message and nothing else, which
     * is what a header needs to say when a thread began.
     */
    oldest?: boolean;
    limit?: number;
    /** When false, skip marking the thread read (used for background prefetch). */
    markRead?: boolean;
    /**
     * Message count the caller already knows from the list row. A thread that
     * fits in one page is then one Gmail call instead of an id list followed
     * by a call per message. A stale hint only costs the slower path.
     */
    messageCountHint?: number;
  }
): Promise<MailThreadDetail> {
  if ((await resolveMailProvider(account)) === "outlook") {
    return getOutlookMailThread(account, threadId, options);
  }
  const stored = await threadFromLocalStore(account, threadId, options);
  if (stored) return stored;

  return getGmailApiThread(account, threadId, options);
}

/**
 * A Gmail thread's message ids, oldest first, and the draft it holds.
 *
 * When the thread is known to fit one page, one call brings every body
 * too, kept in `prefetched`. Otherwise the cheap id list, and the bodies
 * of the page asked for are read after.
 */
async function readGmailThreadIds(
  token: string,
  threadId: string,
  fitsOnePage: boolean
): Promise<{
  allIds: string[];
  prefetched: Map<string, GmailMessage> | null;
  draftMessage: GmailMessage | null;
}> {
  const notDraft = (m: { labelIds?: string[] }) =>
    !(m.labelIds ?? []).includes("DRAFT");

  /** The last draft in a thread. More than one is possible; the newest wins. */
  const newestDraft = <T extends { id: string; labelIds?: string[] }>(
    rows: T[]
  ): T | null => {
    const drafts = rows.filter((m) => !notDraft(m));
    return drafts.length ? drafts[drafts.length - 1] : null;
  };

  /** Bodies already in hand — set only on the single-call path. */
  let prefetched: Map<string, GmailMessage> | null = null;
  let allIds: string[] | null = null;
  /** The newest unsent reply Gmail is holding for this thread, if any. */
  let draftMessage: GmailMessage | null = null;

  if (fitsOnePage) {
    const full = await getThreadFull(token, threadId);
    draftMessage = newestDraft(full.messages ?? []);
    const messages = (full.messages ?? []).filter(notDraft);
    // Take the single call only when it really carried every body. Anything
    // else falls through to the id list, which is correct but slower.
    if (messages.length > 0 && messages.every((m) => m.payload)) {
      allIds = messages.map((m) => m.id);
      prefetched = new Map(messages.map((m) => [m.id, m]));
    }
  }

  if (!allIds) {
    // Cheap id list (oldest → newest); hydrate only the requested page bodies.
    const minimal = await getThreadMinimal(token, threadId);
    const draftRow = newestDraft(minimal.messages ?? []);
    // The id list carries no bodies, so a draft costs one more call — and only
    // when there is one.
    if (draftRow) {
      draftMessage = await getMessageFull(token, draftRow.id).catch(() => null);
    }
    allIds = (minimal.messages ?? []).filter(notDraft).map((m) => m.id);
  }

  return { allIds, prefetched, draftMessage };
}

/**
 * An unbound thread that references a conversation's messages is that
 * conversation, split by the provider. Adopt it as the next part. The
 * References header survives the split — the grouping changed, not the
 * headers — so this is where a Gmail split finds its way home.
 */
async function adoptIfSplit(
  account: string,
  threadId: string,
  subject: string,
  messages: MailMessage[]
): Promise<Awaited<ReturnType<typeof getChatForThread>>> {
  if (!messages.length) return null;
  const head = messages[0];
  const referencedIds = [
    ...(head.references?.match(/<[^>]+>/g) ?? []),
    ...(head.inReplyTo?.match(/<[^>]+>/g) ?? []),
  ];
  if (!referencedIds.length) return null;
  const self = account.trim().toLowerCase();
  const counterpartEmails = [
    ...new Set(
      messages
        .flatMap((m) => [m.fromEmail, ...m.toEmails, ...m.ccEmails])
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e && e !== self && !isOwnOrgAddress(e))
    ),
  ];
  return adoptSplitThread({
    account,
    threadId,
    subject,
    referencedIds,
    counterpartEmails,
  }).catch(() => null);
}

/**
 * A thread read from the Gmail API: the path for a Gmail mailbox the
 * local copy does not serve. Moved out of getMailThread, which now only
 * chooses: Outlook, the local copy, or this.
 */
async function getGmailApiThread(
  account: string,
  threadId: string,
  options?: Parameters<typeof getMailThread>[2]
): Promise<MailThreadDetail> {
  const token = await accessTokenFor(account);
  const limit = options?.limit ?? THREAD_PAGE_SIZE;

  const windowed = Boolean(
    options?.before || options?.after || options?.around || options?.oldest
  );
  const fitsOnePage =
    !windowed &&
    typeof options?.messageCountHint === "number" &&
    options.messageCountHint > 0 &&
    options.messageCountHint <= limit;

  const { allIds, prefetched, draftMessage } = await readGmailThreadIds(token, threadId, fitsOnePage);

  // Which page of the thread, and whether more lie either side.
  const page = threadWindow(allIds, options, limit);
  if (!page) return emptyThreadDetail(account, threadId);
  const { start, end: endExclusive, hasOlder, hasNewer } = page;

  const pageIds = allIds.slice(start, endExclusive);

  // A hint that undercounted still lands here with every body already loaded.
  const rawMessages = prefetched
    ? pageIds
        .map((id) => prefetched.get(id))
        .filter((m): m is GmailMessage => Boolean(m))
    : await mapWithConcurrency(pageIds, (id) => getMessageFull(token, id));

  // Gmail keeps one message per Message-ID and labels it both SENT and
  // INBOX, so this finds nothing to fold today. It is here so that "one
  // bubble per message" is a rule of the reader rather than a property of
  // one provider — which is what let the Outlook side double for months.
  const messages: MailMessage[] = dedupeMessagesByRfcId(
    await Promise.all(rawMessages.map((m) => gmailMailMessage(token, account, m)))
  );

  // Reply targets the true thread tip, not the middle of a deep-link window.
  const tipId = allIds[allIds.length - 1];
  const tipMessage =
    tipId && pageIds[pageIds.length - 1] === tipId
      ? rawMessages[rawMessages.length - 1]
      : tipId
        ? (prefetched?.get(tipId) ?? (await getMessageFull(token, tipId)))
        : undefined;
  const last = tipMessage;
  const subject =
    (last ? headerValue(last, "Subject") : "").trim() || "(no subject)";

  const reply = replyTargets({
    from: last ? (parseAddressList(headerValue(last, "From"))[0]?.email ?? "") : "",
    to: last ? parseAddressList(headerValue(last, "To")).map((p) => p.email) : [],
    cc: last ? parseAddressList(headerValue(last, "Cc")).map((p) => p.email) : [],
    account,
  });

  const references = last
    ? [
        headerValue(last, "References").trim(),
        headerValue(last, "Message-ID").trim(),
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const names = participantNames(messages);

  // Opening a window (not paging) marks the thread read (best-effort).
  // Prefetch passes markRead: false so unread badges stay until a real open.
  if (
    options?.markRead !== false &&
    !options?.before &&
    !options?.after
  ) {
    void modifyThreadLabels(token, threadId, {
      removeLabelIds: ["UNREAD"],
    }).catch(() => undefined);
  }

  let chat = await getChatForThread(
    account,
    threadId,
    names.find((n) => n !== "You") || undefined
  );

  if (!chat) chat = await adoptIfSplit(account, threadId, subject, messages);

  // A bound thread corrects its part's count from the id list, which sees
  // every message — the send counter sees only ours. And its Message-IDs go
  // into the conversation's memory, so the next split can find them. Best
  // effort: a store hiccup must not cost the thread view.
  if (chat) {
    await mailStore()
      .chats.reconcilePartCount({
        account,
        threadId,
        messageCount: allIds.length,
      })
      .catch(() => undefined);
    await noteChatMessageIds(
      account,
      threadId,
      messages.map((m) => m.rfcMessageId)
    );
  }

  return {
    account,
    threadId,
    subject,
    participants: names,
    messages,
    hasOlder,
    hasNewer,
    totalMessageCount: allIds.length,
    ...(chat ? { chat } : null),
    ...(draftMessage
      ? {
          providerDraft: {
            // The message id. `sendMailMessage` turns it into a draft id when
            // it is time to discard — see findGmailDraftIdForMessage.
            ref: draftMessage.id,
            bodyText: extractBodyText(draftMessage),
            bodyHtml: extractBodyHtml(draftMessage) || undefined,
            to: parseAddressList(headerValue(draftMessage, "To")).map(
              (p) => p.email
            ),
            cc: parseAddressList(headerValue(draftMessage, "Cc")).map(
              (p) => p.email
            ),
            updatedAt: messageDate(draftMessage)
              ? new Date(messageDate(draftMessage)).toISOString()
              : null,
          },
        }
      : null),
    reply: {
      inReplyTo: last ? headerValue(last, "Message-ID").trim() : "",
      references,
      to: reply.to,
      cc: [],
      allTo: reply.allTo,
      allCc: reply.allCc,
    },
  };
}

