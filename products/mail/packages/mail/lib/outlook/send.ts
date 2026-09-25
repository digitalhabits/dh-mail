/*
 * Sending on Outlook: a draft, a message sent now or at a time Exchange
 * holds it to, the scheduled ones listed, and a scheduled one sent now or
 * put back.
 */

import "server-only";
import { graphFetch } from "@/lib/outlook/graph";
import { type GraphMessage, MESSAGE_LIST_SELECT } from "@/lib/outlook/api";

type GraphSendRecipient = { emailAddress: { address: string } };

function toRecipients(emails: string[]): GraphSendRecipient[] {
  return emails
    .map((e) => e.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

/**
 * The MAPI property that holds a message back until a time.
 *
 * `PidTagDeferredSendTime`, named the way Graph names extended properties:
 * the type, then the tag. Exchange keeps the message in Drafts and sends it
 * itself when the time comes, so the machine that wrote it can be shut.
 *
 * There is no equivalent on Gmail — see `sendMailMessage`.
 */
const DEFERRED_SEND_TIME = "SystemTime 0x3FEF";

/**
 * Write the message into the mailbox as a draft, and leave it there.
 *
 * The same shape a send takes, stopping one step earlier: Graph makes the
 * message, we fill it in, and nothing is sent. It lands in Drafts, where
 * every client signed in to this mailbox will find it — which is the point,
 * because the client the reader wants is not this one.
 *
 * A reply goes through `createReply` so it keeps its conversation, exactly
 * as a sent reply does. The body Graph pre-fills is overwritten by ours,
 * appendix and all — see the note in `sendMailMessage`.
 */
export async function createOutlookDraft(
  accessToken: string,
  input: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html: string;
    /** Reply to this Graph message id (keeps the conversation). */
    replyToMessageId?: string;
    attachments?: {
      filename: string;
      mimeType: string;
      contentBase64: string;
      contentId?: string;
    }[];
  }
): Promise<{ id: string; webLink?: string }> {
  const attachments = (input.attachments ?? []).map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.filename,
    contentType: a.mimeType || "application/octet-stream",
    contentBytes: a.contentBase64.replace(/\s+/g, ""),
    ...(a.contentId ? { isInline: true, contentId: a.contentId } : null),
  }));
  const fields = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.html },
    toRecipients: toRecipients(input.to),
    ccRecipients: toRecipients(input.cc ?? []),
    bccRecipients: toRecipients(input.bcc ?? []),
    ...(attachments.length ? { attachments } : {}),
  };

  if (input.replyToMessageId) {
    const draft = await graphFetch<GraphMessage>(
      accessToken,
      `/me/messages/${input.replyToMessageId}/createReply`,
      { method: "POST", body: "{}" }
    );
    if (!draft.id) throw new Error("Graph createReply returned no draft id");
    const filled = await graphFetch<GraphMessage>(
      accessToken,
      `/me/messages/${draft.id}`,
      { method: "PATCH", body: JSON.stringify(fields) }
    );
    return { id: draft.id, webLink: filled.webLink ?? draft.webLink };
  }

  const made = await graphFetch<GraphMessage>(accessToken, "/me/messages", {
    method: "POST",
    body: JSON.stringify(fields),
  });
  if (!made.id) throw new Error("Graph returned no draft id");
  return { id: made.id, webLink: made.webLink };
}

export async function sendOutlookMail(
  accessToken: string,
  input: {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    html: string;
    /** Reply to this Graph message id (keeps the conversation). */
    replyToMessageId?: string;
    /** ISO 8601 UTC time to hold the message until. */
    sendAt?: string;
    attachments?: {
      filename: string;
      mimeType: string;
      contentBase64: string;
      /** Set on a picture written into the body — see the mapping below. */
      contentId?: string;
    }[];
  }
): Promise<void> {
  const deferred = input.sendAt
    ? {
        singleValueExtendedProperties: [
          { id: DEFERRED_SEND_TIME, value: input.sendAt },
        ],
      }
    : null;
  const attachments = (input.attachments ?? []).map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: a.filename,
    contentType: a.mimeType || "application/octet-stream",
    contentBytes: a.contentBase64.replace(/\s+/g, ""),
    /*
      A picture written into the body, rather than hung off the end of it.
      Graph wants both: `isInline` keeps it out of the paperclip list, and
      `contentId` is what the body's `cid:` resolves against. Without the
      id the picture arrives as an attachment and the body draws a hole.

      Set only on a picture that has one, so an ordinary file is the plain
      object it always was.
    */
    ...(a.contentId
      ? { isInline: true, contentId: a.contentId }
      : null),
  }));

  if (input.replyToMessageId) {
    // createReply → patch body/recipients/attachments → send
    const draft = await graphFetch<GraphMessage>(
      accessToken,
      `/me/messages/${input.replyToMessageId}/createReply`,
      { method: "POST", body: "{}" }
    );
    if (!draft.id) throw new Error("Graph createReply returned no draft id");
    await graphFetch(accessToken, `/me/messages/${draft.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        subject: input.subject,
        body: { contentType: "HTML", content: input.html },
        toRecipients: toRecipients(input.to),
        ccRecipients: toRecipients(input.cc ?? []),
        bccRecipients: toRecipients(input.bcc ?? []),
        ...(attachments.length ? { attachments } : {}),
        ...deferred,
      }),
    });
    await graphFetch(accessToken, `/me/messages/${draft.id}/send`, {
      method: "POST",
      body: "{}",
    });
    return;
  }

  await graphFetch(accessToken, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "HTML", content: input.html },
        toRecipients: toRecipients(input.to),
        ccRecipients: toRecipients(input.cc ?? []),
        bccRecipients: toRecipients(input.bcc ?? []),
        ...(attachments.length ? { attachments } : {}),
        ...deferred,
      },
      saveToSentItems: true,
    }),
  });
}

/** The time this message is being held until, if it is being held at all. */
export function deferredSendTimeOf(message: GraphMessage): string | null {
  const held = (message.singleValueExtendedProperties ?? []).find(
    (p) => p.id?.toLowerCase() === DEFERRED_SEND_TIME.toLowerCase()
  );
  const value = held?.value?.trim();
  if (!value) return null;
  // Graph answers these without a zone. They are UTC, and read as local time
  // they would be hours out — which for a send time is the whole point of it.
  const iso = /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

/**
 * The messages Exchange is holding, and when each goes.
 *
 * For one conversation, or the whole mailbox when no conversation is named.
 *
 * A held message lives in Drafts until its time, so this is the drafts query
 * with the deferred time asked for alongside. Which of them are actually
 * held is decided here rather than in the filter: Graph refuses or quietly
 * mishandles `$filter` over extended properties often enough that reading
 * the page and looking is the reliable way round.
 */
export async function listOutlookScheduledMessages(
  accessToken: string,
  conversationId?: string
): Promise<{ message: GraphMessage; sendAt: string }[]> {
  const escaped = conversationId?.replace(/'/g, "''");
  const params = new URLSearchParams({
    $filter: escaped
      ? `conversationId eq '${escaped}' and isDraft eq true`
      : "isDraft eq true",
    $select: `${MESSAGE_LIST_SELECT},body`,
    $expand: `singleValueExtendedProperties($filter=id eq '${DEFERRED_SEND_TIME}')`,
    $top: conversationId ? "20" : "50",
  });
  const data = await graphFetch<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?${params.toString()}`
  );
  const held: { message: GraphMessage; sendAt: string }[] = [];
  for (const message of data.value ?? []) {
    const sendAt = deferredSendTimeOf(message);
    if (sendAt) held.push({ message, sendAt });
  }
  return held.sort((a, b) => a.sendAt.localeCompare(b.sendAt));
}

/** Stop holding it. The message stays a draft until something sends it. */
export async function clearOutlookDeferredSend(
  accessToken: string,
  messageId: string
): Promise<void> {
  await graphFetch(accessToken, `/me/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({
      singleValueExtendedProperties: [
        { id: DEFERRED_SEND_TIME, value: null },
      ],
    }),
  });
}

/** Send a draft the mailbox is already holding, as it stands. */
export async function sendOutlookDraftNow(
  accessToken: string,
  messageId: string
): Promise<void> {
  await graphFetch(accessToken, `/me/messages/${messageId}/send`, {
    method: "POST",
    body: "{}",
  });
}
