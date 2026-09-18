import "server-only";

import {
  bodyHasInlineImage,
  getOutlookAttachmentBytes,
  getOutlookMessageFull,
  getOutlookMessageTimes,
  graphAddress,
  graphAddresses,
  listConversationAfter,
  listConversationMessages,
  listOutlookConversationDrafts,
  listOutlookConversationSummaries,
  listOutlookAttachmentMeta,
  listOutlookFileAttachments,
  resolveOutlookInlineImages,
  getOutlookAutomaticReplies,
  markOutlookMessageRead,
  unreadMessageIds,
  updateOutlookAutomaticReplies,
  moveOutlookConversation,
  createOutlookDraft,
  sendOutlookMail,
  clearOutlookDeferredSend,
  deleteOutlookMessage,
  listOutlookScheduledMessages,
  sendOutlookDraftNow,
  type GraphMessage,
  getOutlookMessageSource,
} from "@/lib/outlook/api";
import { findOutlookFolder } from "@/lib/mail/outlook-folders";
import {
  clearOutlookAccessToken,
  outlookAccessTokenFor,
} from "@/lib/mail/outlook-token";
import {
  formatInviteChip,
  isCalendarAttachment,
  parseCalendarInvite,
} from "@/lib/mail/ics";
import { getChatForThread, noteChatMessageIds } from "@/lib/mail/chats";
import { mailStore } from "@/lib/mail/store";
import type {
  MailMessage,
  MailScheduledMessage,
  MailThreadDetail,
  MailThreadSummary,
} from "@/lib/mail/types";
import { isOwnOrgAddress, normalizeEmail } from "@/lib/own-addresses";
import { dedupeMessagesByRfcId } from "@/lib/mail/thread-copies";
import { replyAllRecipients, sentFromThisMailbox } from "@/lib/mail/reply-target";
import {
  type Classifier,
  classifyThread,
  crmLogoFor,
  crmNameFor,
  displayName,
  THREAD_AROUND_RADIUS,
  THREAD_PAGE_SIZE,
} from "@/lib/mail/thread-classify";
import { signatureHtml } from "@/lib/mail/signature-html";
import { htmlToText } from "@/lib/mail/html-to-text";
import { getMailSignatureSettings } from "@/lib/mail/settings";
import { PlanError } from "@/lib/plan/errors";

// Tokens live in their own module so folders can reach them too. Re-exported
// here because most callers already import them from the inbox.
export { clearOutlookAccessToken, outlookAccessTokenFor };

function messageHtml(m: GraphMessage): string {
  const body = m.body;
  if (!body?.content) return "";
  if ((body.contentType || "").toLowerCase() === "text") {
    return body.content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  }
  return body.content;
}

function outlookIsMeetingMessage(m: GraphMessage): boolean {
  // Prefer @odata.type — meetingMessageType is not $selectable on Message for
  // many Outlook.com mailboxes (Graph 400 ParseUri).
  const odata = (m["@odata.type"] || "").toLowerCase();
  if (odata.includes("eventmessage")) return true;
  const meetingType = (m.meetingMessageType || "").toLowerCase();
  return Boolean(meetingType && meetingType !== "none");
}

export async function listOutlookAccountThreads(options: {
  accountEmail: string;
  folder: "inbox" | "sent" | "trash" | "junk" | "archived";
  q: string;
  label?: string;
  pageToken?: string;
  maxConversations: number;
  classifier: Classifier;
}): Promise<{
  summaries: { summary: MailThreadSummary; latestRfcId: string }[];
  nextPageToken?: string;
}> {
  const token = await outlookAccessTokenFor(options.accountEmail);

  // A folder view names one folder by path. The mailbox may not have it —
  // the folder list merges every account, so a folder can belong to another
  // one. Show nothing for this account rather than its whole inbox.
  let folderId: string | undefined;
  if (options.label) {
    const hit = await findOutlookFolder(options.accountEmail, options.label);
    if (!hit) return { summaries: [] };
    folderId = hit.id;
  }

  const folder =
    options.folder === "sent"
      ? ("sentitems" as const)
      : options.folder === "trash"
        ? ("deleteditems" as const)
        : options.folder === "junk"
          ? ("junkemail" as const)
          : // Outlook has a real Archive folder, so archived is simply what
            // is in it. The rail reaches it by path on this provider and
            // never asks for the view — but the view has an answer here
            // rather than quietly serving the inbox if anything ever does.
            options.folder === "archived"
            ? ("archive" as const)
        : options.q
          ? undefined
          : ("inbox" as const);

  const page = await listOutlookConversationSummaries(token, {
    folder: folderId ? undefined : folder,
    folderId,
    q: options.q || undefined,
    maxConversations: options.maxConversations,
    pageToken: options.pageToken,
  });

  const summaries: { summary: MailThreadSummary; latestRfcId: string }[] = [];
  const attachChecks: { messageId: string; summary: MailThreadSummary }[] = [];

  for (const conv of page.conversations) {
    const threadId = conv.conversationId;
    const latest = conv.latest;
    const from = graphAddress(latest.from);
    const to = graphAddresses(latest.toRecipients);
    const cc = graphAddresses(latest.ccRecipients);
    // Graph hands the list one message per conversation, so the rule runs
    // on that message's envelope. Gmail's runs on the whole thread.
    const { tab, counterpart, externalParticipants } = classifyThread({
      accountEmail: options.accountEmail,
      participants: [from, ...to, ...cc],
      senders: [from],
      latestFrom: from,
      latestTo: to,
      classifier: options.classifier,
    });

    const lastAt = latest.receivedDateTime || latest.sentDateTime;
    const fromMeeting = outlookIsMeetingMessage(latest);
    const summary: MailThreadSummary = {
      account: options.accountEmail,
      threadId,
      subject: (latest.subject || "").trim() || "(no subject)",
      fromName: displayName(counterpart),
      fromEmail: counterpart.email,
      snippet: (latest.bodyPreview || "").trim(),
      lastAt: lastAt
        ? new Date(lastAt).toISOString()
        : new Date().toISOString(),
      unread: conv.unread,
      messageCount: conv.messageCount,
      tab,
      externalParticipants,
      crmName: crmNameFor(counterpart.email, options.classifier),
      crmLogoUrl: crmLogoFor(counterpart.email, options.classifier),
      ...(options.q ? { focusMessageId: conv.focusMessageId } : null),
      ...(fromMeeting ? { hasCalendarInvite: true } : null),
    };
    if (!fromMeeting && latest.hasAttachments) {
      attachChecks.push({ messageId: latest.id, summary });
    }
    summaries.push({
      summary,
      latestRfcId:
        latest.internetMessageId || `${options.accountEmail}|${threadId}`,
    });
  }

  if (attachChecks.length) {
    await Promise.all(
      attachChecks.map(async ({ messageId, summary }) => {
        const files = await listOutlookFileAttachments(token, messageId).catch(
          (err) => {
            console.warn(`[mail] outlook attachments for ${messageId}:`, err);
            return [];
          }
        );
        // Graph's own hasAttachments counts inline pictures, so a signature
        // logo would flag every message. These are what it left after the
        // inline parts were dropped.
        if (files.length) summary.hasAttachments = true;
        const ics = files.find((f) =>
          isCalendarAttachment({
            mimeType: f.contentType || "",
            filename: f.name || "",
          })
        );
        if (!ics) return;
        summary.hasCalendarInvite = true;
        try {
          const bytes = await getOutlookAttachmentBytes(
            token,
            messageId,
            ics.id
          );
          const parsed = parseCalendarInvite(
            new TextDecoder().decode(bytes)
          );
          const when = parsed ? formatInviteChip(parsed) : null;
          if (when) summary.calendarInviteWhen = when;
        } catch {
          /* chip can still show without a when-label */
        }
      })
    );
  }

  return { summaries, nextPageToken: page.nextPageToken };
}

async function graphMessageToMailMessage(
  token: string,
  account: string,
  m: GraphMessage
): Promise<MailMessage> {
  const from = graphAddress(m.from);
  const own = from.email === account || isOwnOrgAddress(from.email);
  const bodyHtml = messageHtml(m) || undefined;
  const bodyText = bodyHtml
    ? htmlToText(bodyHtml)
    : (m.bodyPreview || "").trim();
  /**
   * A picture in the body, which arrives as an inline attachment.
   *
   * The body is the only thing that says so. `hasAttachments` is false when a
   * message carries nothing but inline parts — that is Graph working as
   * designed, and Microsoft's own advice is to read the body for a `cid:`
   * source instead. Asking `hasAttachments` first meant a picture dropped
   * into a Gmail message and sent to Outlook was never looked for; the
   * sanitizer then dropped the `cid:` image it could not resolve, and the
   * mail arrived empty. A picture attached the ordinary way was fine, which
   * is what made it look like a rendering fault.
   */
  const wantsInline = bodyHasInlineImage(bodyHtml);

  let attachments:
    | { attachmentId: string; filename: string; mimeType: string; size: number }[]
    | undefined;
  let inlineImages: Record<string, string> | undefined;

  if (m.hasAttachments || wantsInline) {
    // Listed once and used for both. Not silently: a Graph refusal here is
    // why an Outlook mail with a file showed none for as long as it did.
    const meta = await listOutlookAttachmentMeta(token, m.id).catch((err) => {
      console.warn(`[mail] outlook attachments for ${m.id}:`, err);
      return [];
    });

    const files = meta.filter((a) => !a.isInline);
    if (files.length) {
      attachments = files.map((f) => ({
        attachmentId: f.id,
        filename: f.name || "attachment",
        mimeType: f.contentType || "application/octet-stream",
        size: f.size ?? 0,
      }));
    }

    if (wantsInline) {
      inlineImages = await resolveOutlookInlineImages(
        token,
        m.id,
        bodyHtml ?? "",
        meta
      ).catch((err) => {
        console.warn(`[mail] outlook inline images for ${m.id}:`, err);
        return {};
      });
    }

    // Something was expected and nothing came back. The listing is answered
    // separately from the message, so it can fail on its own — and when it
    // did, the mail simply looked as though it had nothing on it.
    if (!attachments?.length && !Object.keys(inlineImages ?? {}).length) {
      console.warn(
        `[mail] outlook message ${m.id} should carry ${
          wantsInline ? "a picture in the body" : "an attachment"
        }, but none came back`
      );
    }
  }

  return {
    id: m.id,
    fromName: from.name || from.email,
    fromEmail: from.email,
    toEmails: graphAddresses(m.toRecipients).map((p) => p.email),
    ccEmails: graphAddresses(m.ccRecipients).map((p) => p.email),
    sentAt: m.sentDateTime || m.receivedDateTime || null,
    bodyText,
    bodyHtml,
    inlineImages:
      inlineImages && Object.keys(inlineImages).length ? inlineImages : undefined,
    attachments,
    own,
    // Graph hands the RFC id over in every list. References would cost a
    // second select (internetMessageHeaders), so it waits for a caller that
    // needs it — see docs/mail-chat-architecture.md.
    rfcMessageId: m.internetMessageId || undefined,
  };
}

export async function getOutlookMailThread(
  account: string,
  threadId: string,
  options?: {
    before?: string;
    after?: string;
    around?: string;
    /**
     * The oldest page, rather than the newest. Refused here — see below.
     */
    oldest?: boolean;
    limit?: number;
    /** When false, skip marking the tip message read (background prefetch). */
    markRead?: boolean;
  }
): Promise<MailThreadDetail> {
  const token = await outlookAccessTokenFor(account);
  const limit = options?.limit ?? THREAD_PAGE_SIZE;

  let rawMessages: GraphMessage[] = [];
  let hasOlder = false;
  let hasNewer = false;

  if (options?.around) {
    const hit = await getOutlookMessageFull(token, options.around);
    const hitAt = hit.receivedDateTime || hit.sentDateTime;
    if (!hitAt) throw new PlanError("Search hit has no timestamp", 400);
    const [older, newer] = await Promise.all([
      listConversationMessages(token, threadId, {
        top: THREAD_AROUND_RADIUS,
        beforeReceivedAt: hitAt,
      }),
      // Not listConversationMessages: its "newer" window is the newest page
      // of the conversation rather than the page above the hit.
      listConversationAfter(token, threadId, hitAt, THREAD_AROUND_RADIUS),
    ]);
    rawMessages = [...older.messages, hit, ...newer.messages];
    hasOlder = older.hasOlder;
    hasNewer = newer.hasNewer;
  } else if (options?.oldest) {
    /**
     * Outlook cannot answer this, so it says so rather than guessing.
     *
     * Graph refuses `$orderby` beside a conversationId filter, so
     * `listConversationMessages` sorts each page after it arrives — and a
     * message collection comes back newest first. Asking for everything after
     * the epoch therefore returns the newest page, which sorted ascending
     * looks exactly like the beginning of the conversation and is the end of
     * it. On a long conversation that is a wrong date stated with confidence.
     *
     * Gmail answers exactly, from the thread's id list. Doing this properly
     * here means paging ids and timestamps to the end of the conversation and
     * keeping the oldest — cheap per request, but a request per hundred
     * messages, so it wants caching rather than a straight port.
     */
    throw new PlanError(
      "Outlook cannot open a conversation at its first message yet",
      501
    );
  } else if (options?.after) {
    const times = await getOutlookMessageTimes(token, options.after);
    const afterReceivedAt = times.receivedDateTime || times.sentDateTime;
    if (!afterReceivedAt) {
      throw new PlanError("Couldn't page newer Outlook messages", 400);
    }
    const page = await listConversationAfter(
      token,
      threadId,
      afterReceivedAt,
      limit
    );
    rawMessages = page.messages;
    hasNewer = page.hasNewer;
    hasOlder = true; // we came from a mid/newer window
  } else {
    let beforeReceivedAt: string | undefined;
    if (options?.before) {
      const times = await getOutlookMessageTimes(token, options.before);
      beforeReceivedAt = times.receivedDateTime || times.sentDateTime;
      if (!beforeReceivedAt) {
        throw new PlanError("Couldn't page older Outlook messages", 400);
      }
    }
    const page = await listConversationMessages(token, threadId, {
      top: limit,
      beforeReceivedAt,
    });
    rawMessages = page.messages;
    hasOlder = page.hasOlder;
    hasNewer = Boolean(options?.before);
  }

  // A reply the reader started in Outlook and never sent. Only on the newest
  // page — paging back through an old thread should not reopen a composer.
  const draft =
    options?.before || options?.after || options?.around
      ? null
      : ((await listOutlookConversationDrafts(token, threadId).catch(() => []))
          .at(-1) ?? null);

  // A conversation holding nothing but a draft is a new message the reader
  // started and never sent. It opens as an empty thread with that draft in
  // the composer, which is how the Gmail side already behaves — the Drafts
  // view relies on both doing the same thing.
  if (
    !rawMessages.length &&
    !draft &&
    !options?.before &&
    !options?.after
  ) {
    throw new PlanError("Conversation not found", 404);
  }

  // Sent Items and the Inbox both hold the reader's own cc'd copy, and the
  // conversation is queried across the whole mailbox — see the note on
  // `dedupeMessagesByRfcId`.
  const messages = dedupeMessagesByRfcId(
    await Promise.all(
      rawMessages.map((m) => graphMessageToMailMessage(token, account, m))
    )
  );

  // Reply targets the true conversation tip, not the middle of a deep-link window.
  const tipPage = await listConversationMessages(token, threadId, { top: 1 });
  const tip = tipPage.messages[tipPage.messages.length - 1] ?? rawMessages.at(-1);
  const last = tip;
  const subject = (last?.subject || "").trim() || "(no subject)";

  const lastFrom = last ? graphAddress(last.from) : { email: "", name: "" };
  const lastTo = last
    ? graphAddresses(last.toRecipients).map((p) => p.email)
    : [];
  const lastCc = last
    ? graphAddresses(last.ccRecipients).map((p) => p.email)
    : [];
  // Not "from an address of mine" — from *this* mailbox. See the note on
  // `sentFromThisMailbox`; the difference is a thread with yourself.
  const sentByUs = sentFromThisMailbox({
    from: lastFrom.email,
    account,
    to: lastTo,
    cc: lastCc,
  });
  const accountKey = normalizeEmail(account);

  const recipients = (items: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
      const email = raw.trim();
      if (!email) continue;
      const key = normalizeEmail(email);
      if (key === accountKey || seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
    return out;
  };

  const replyTo = sentByUs ? lastTo : [lastFrom.email];
  const replyAll = replyAllRecipients({
    from: lastFrom.email,
    to: lastTo,
    cc: lastCc,
    account,
    sentByUs,
  });

  const names: string[] = [];
  let hasOwn = false;
  for (const m of messages) {
    if (m.own) {
      hasOwn = true;
      continue;
    }
    const short = m.fromName.split("<")[0].trim() || m.fromEmail;
    if (!names.includes(short)) names.push(short);
  }
  if (hasOwn) names.push("You");

  /**
   * Opening a thread marks it read — all of it, not just its newest message.
   *
   * Graph has no conversation-level read flag, and the list here calls a
   * conversation unread when any message in it is. Marking only the newest
   * one read therefore looked right until the next sync, which read the rest
   * of the conversation and put the row back in bold. It was never that the
   * read state failed to reach Outlook; it was that most of it was never sent.
   */
  if (options?.markRead !== false && !options?.before && !options?.after) {
    void Promise.all(
      unreadMessageIds(rawMessages).map((id) =>
        markOutlookMessageRead(token, id, true).catch(() => undefined)
      )
    );
    // A thread longer than one page can hold an unread message further back,
    // and one is enough to make the whole row unread again.
    if (hasOlder) {
      void markOutlookThreadRead(account, threadId).catch(() => undefined);
    }
  }

  const chat = await getChatForThread(
    account,
    threadId,
    names.find((n) => n !== "You") || undefined
  );

  // Graph has no cheap total, so the count is only known when this window is
  // the whole conversation. Parts rotate at 80 and a Graph page holds 100,
  // so for a chat that is the common case, and the part count stays honest.
  const wholeConversation = !hasOlder && !hasNewer;
  if (chat && wholeConversation) {
    await mailStore()
      .chats.reconcilePartCount({
        account,
        threadId,
        messageCount: messages.length,
      })
      .catch(() => undefined);
  }
  // Graph does not split conversations, so no adoption runs here. The ids
  // still go into the conversation's memory: a sibling Gmail mailbox holds
  // the same messages, and its split can reference them.
  if (chat) {
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
    ...(wholeConversation ? { totalMessageCount: messages.length } : null),
    ...(chat ? { chat } : null),
    ...(draft
      ? {
          providerDraft: {
            // Graph deletes a draft by its message id — no second id to find.
            ref: draft.id,
            bodyText: messageHtml(draft)
              ? htmlToText(messageHtml(draft)!)
              : (draft.bodyPreview || "").trim(),
            bodyHtml: messageHtml(draft) || undefined,
            to: graphAddresses(draft.toRecipients).map((p) => p.email),
            cc: graphAddresses(draft.ccRecipients).map((p) => p.email),
            updatedAt:
              draft.lastModifiedDateTime || draft.sentDateTime || null,
          },
        }
      : null),
    reply: {
      inReplyTo: last?.internetMessageId || "",
      references: last?.internetMessageId || "",
      // Self-addressed threads (notes to yourself) would otherwise strip down
      // to nobody — replying to yourself is legitimate, so keep the mailbox.
      to: recipients(replyTo).length ? recipients(replyTo) : [account],
      cc: [],
      allTo: replyAll.to,
      allCc: replyAll.cc,
    },
  };
}

/** The messages Exchange is holding for this conversation, soonest first. */
export async function listScheduledOutlookMessages(
  account: string,
  conversationId?: string
): Promise<MailScheduledMessage[]> {
  const token = await outlookAccessTokenFor(account);
  const held = await listOutlookScheduledMessages(token, conversationId);
  return held.map(({ message, sendAt }) => {
    const html = messageHtml(message);
    const to = graphAddresses(message.toRecipients);
    return {
      id: message.id,
      sendAt,
      account,
      threadId: message.conversationId || message.id,
      toName: to[0]?.name?.trim() || to[0]?.email || "",
      subject: (message.subject || "").trim(),
      bodyText: html ? htmlToText(html) : (message.bodyPreview || "").trim(),
      ...(html ? { bodyHtml: html } : null),
      to: to.map((p) => p.email),
      cc: graphAddresses(message.ccRecipients).map((p) => p.email),
    };
  });
}

/** Stop holding it, and never send it. */
export async function cancelScheduledOutlookMessage(
  account: string,
  messageId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  await deleteOutlookMessage(token, messageId);
}

/** Take the time off and let it go now. */
export async function sendScheduledOutlookMessageNow(
  account: string,
  messageId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  await clearOutlookDeferredSend(token, messageId);
  await sendOutlookDraftNow(token, messageId);
}

/**
 * Put the message in Drafts instead of sending it.
 *
 * The body is built exactly as a send builds it — signature, quoted
 * history, pictures lifted out — so what the reader finds in Outlook is the
 * mail they were writing here, not an approximation of it.
 */
export async function draftOutlookMailMessage(input: {
  account: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  html?: string;
  includeSignature?: boolean;
  threadId?: string;
  attachments?: {
    filename: string;
    mimeType: string;
    contentBase64: string;
    contentId?: string;
  }[];
  /** Quoted history or forwarded original, already rendered as HTML. */
  appendixHtml?: string;
}): Promise<{ id: string; webLink?: string }> {
  if (!input.to.length) throw new PlanError("Add at least one recipient", 400);
  const token = await outlookAccessTokenFor(input.account);

  const signature =
    input.includeSignature === false
      ? ""
      : (await getMailSignatureSettings(input.account)).signature;

  const htmlInner =
    input.html ||
    input.body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:12pt;line-height:1.6;color:#222">${htmlInner}${
    signature ? signatureHtml(signature) : ""
  }${input.appendixHtml ?? ""}</div>`;

  let replyToMessageId: string | undefined;
  if (input.threadId) {
    const newest = await listConversationMessages(token, input.threadId, {
      top: 1,
    });
    replyToMessageId = newest.messages[newest.messages.length - 1]?.id;
  }

  return createOutlookDraft(token, {
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    html,
    replyToMessageId,
    attachments: input.attachments,
  });
}

export async function sendOutlookMailMessage(input: {
  account: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  html?: string;
  includeSignature?: boolean;
  threadId?: string;
  /** ISO 8601 time to hold the message until. Exchange does the waiting. */
  sendAt?: string;
  attachments?: {
    filename: string;
    mimeType: string;
    contentBase64: string;
  }[];
  /** Quoted history or forwarded original, already rendered as HTML. */
  appendixHtml?: string;
}): Promise<void> {
  if (!input.to.length) throw new PlanError("Add at least one recipient", 400);
  const token = await outlookAccessTokenFor(input.account);

  const signature =
    input.includeSignature === false
      ? ""
      : (await getMailSignatureSettings(input.account)).signature;

  const htmlInner =
    input.html ||
    input.body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:12pt;line-height:1.6;color:#222">${htmlInner}${
    signature ? signatureHtml(signature) : ""
  }${input.appendixHtml ?? ""}</div>`;

  let replyToMessageId: string | undefined;
  if (input.threadId) {
    const newest = await listConversationMessages(token, input.threadId, {
      top: 1,
    });
    replyToMessageId = newest.messages[newest.messages.length - 1]?.id;
  }

  try {
    await sendOutlookMail(token, {
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      html,
      replyToMessageId,
      sendAt: input.sendAt,
      attachments: input.attachments,
    });
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 403) {
      throw new PlanError(
        `The Outlook connection for ${input.account} can't send — reconnect the account.`,
        403
      );
    }
    throw err;
  }
}

export async function archiveOutlookThread(
  account: string,
  threadId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  await moveOutlookConversation(token, threadId, "archive");
}

export async function unarchiveOutlookThread(
  account: string,
  threadId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  await moveOutlookConversation(token, threadId, "inbox");
}

export async function trashOutlookThread(
  account: string,
  threadId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  await moveOutlookConversation(token, threadId, "deleteditems");
}

export async function untrashOutlookThread(
  account: string,
  threadId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  await moveOutlookConversation(token, threadId, "inbox");
}

export async function markOutlookThreadUnread(
  account: string,
  threadId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  const newest = await listConversationMessages(token, threadId, { top: 1 });
  const last = newest.messages[newest.messages.length - 1];
  if (last) await markOutlookMessageRead(token, last.id, false);
}

/**
 * Mark every message in a conversation read.
 *
 * Graph has no conversation-level flag, so this is one PATCH per message that
 * is actually unread. Sending one for messages already read would be work for
 * nothing and more requests to be throttled for.
 */
export async function markOutlookThreadRead(
  account: string,
  threadId: string
): Promise<void> {
  const token = await outlookAccessTokenFor(account);
  const page = await listConversationMessages(token, threadId, { top: 100 });
  const unread = page.messages.filter((m) => m.isRead === false);
  await Promise.all(
    unread.map((m) => markOutlookMessageRead(token, m.id, true))
  );
}

/**
 * Out of office, in the shape mail uses for both providers.
 *
 * The two do not line up exactly, and where they differ this keeps what the
 * user asked for rather than what is convenient:
 *
 * - Outlook has an internal and an external message. Mail has one, so both are
 *   set to it, and the internal one is read back. Anyone who has set two in
 *   Outlook itself sees the internal one here, and saving replaces both — so
 *   the dialog cannot silently keep a stale external reply on.
 * - "Only contacts" is `contactsOnly` for the external audience. Off means
 *   `all`, which is Outlook's own default and what a Gmail user expects.
 * - Times are epoch milliseconds here and zoned strings there. UTC is used
 *   both ways: Graph rejects a bare timestamp, and picking the mailbox's own
 *   zone would move the times the user set.
 */

/** Graph wants "2026-08-12T09:00:00" with a zone beside it, not an offset. */
function toGraphTime(ms: number): { dateTime: string; timeZone: string } {
  return { dateTime: new Date(ms).toISOString().replace(/\.\d+Z$/, ""), timeZone: "UTC" };
}

function fromGraphTime(
  time: { dateTime: string; timeZone?: string } | undefined
): number | null {
  if (!time?.dateTime) return null;
  // Graph returns the wall time without a zone marker. It was written as UTC.
  const iso = /(Z|[+-]\d\d:\d\d)$/.test(time.dateTime)
    ? time.dateTime
    : `${time.dateTime}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export type OutlookAutoReply = {
  enabled: boolean;
  bodyHtml: string;
  restrictToContacts: boolean;
  startTime: number | null;
  endTime: number | null;
};

export async function getOutlookAutoReply(
  account: string
): Promise<OutlookAutoReply> {
  const token = await outlookAccessTokenFor(account);
  const setting = await getOutlookAutomaticReplies(token);
  const status = setting.status ?? "disabled";
  return {
    enabled: status !== "disabled",
    bodyHtml: setting.internalReplyMessage || setting.externalReplyMessage || "",
    restrictToContacts: setting.externalAudience === "contactsOnly",
    startTime:
      status === "scheduled" ? fromGraphTime(setting.scheduledStartDateTime) : null,
    endTime:
      status === "scheduled" ? fromGraphTime(setting.scheduledEndDateTime) : null,
  };
}

export async function setOutlookAutoReply(input: {
  account: string;
  enabled: boolean;
  bodyHtml: string;
  restrictToContacts: boolean;
  startTime: number | null;
  endTime: number | null;
}): Promise<OutlookAutoReply> {
  const token = await outlookAccessTokenFor(input.account);
  // A schedule needs both ends. With only one, Outlook would run it forever or
  // refuse it, so treat a half-set range as no schedule at all.
  const scheduled =
    input.enabled && input.startTime != null && input.endTime != null;
  const setting = {
    status: !input.enabled
      ? ("disabled" as const)
      : scheduled
        ? ("scheduled" as const)
        : ("alwaysEnabled" as const),
    externalAudience: input.restrictToContacts
      ? ("contactsOnly" as const)
      : ("all" as const),
    internalReplyMessage: input.bodyHtml,
    externalReplyMessage: input.bodyHtml,
    ...(scheduled
      ? {
          scheduledStartDateTime: toGraphTime(input.startTime!),
          scheduledEndDateTime: toGraphTime(input.endTime!),
        }
      : null),
  };
  const updated = await updateOutlookAutomaticReplies(token, setting);
  return {
    enabled: (updated.status ?? "disabled") !== "disabled",
    bodyHtml: updated.internalReplyMessage || input.bodyHtml,
    restrictToContacts: updated.externalAudience === "contactsOnly",
    startTime: fromGraphTime(updated.scheduledStartDateTime),
    endTime: fromGraphTime(updated.scheduledEndDateTime),
  };
}

export async function fetchOutlookMailAttachment(input: {
  account: string;
  messageId: string;
  attachmentId: string;
}): Promise<{ bytes: Uint8Array }> {
  const token = await outlookAccessTokenFor(input.account);
  const bytes = await getOutlookAttachmentBytes(
    token,
    input.messageId,
    input.attachmentId
  );
  return { bytes };
}

/** The RFC 5322 source of one message, for "Show original" and the .eml. */
export async function fetchOutlookMessageSource(input: {
  account: string;
  messageId: string;
}): Promise<{ bytes: Uint8Array }> {
  const token = await outlookAccessTokenFor(input.account);
  const text = await getOutlookMessageSource(token, input.messageId);
  return { bytes: new TextEncoder().encode(text) };
}
