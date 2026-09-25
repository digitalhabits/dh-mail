/*
 * Sending: the MIME message, with a forward or a quote under it and its
 * files; scheduled messages held by the provider; and Outlook's own draft.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */

import "server-only";

import { localStoreServes } from "@/lib/mail/local-store";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import { sendRawMessage } from "@/lib/gmail/api";
import {
  filterAccountsForScope,
  type MailAccountScope,
} from "@/lib/mail/account-scope";
import { extractInlineImages } from "@/lib/mail/inline-images";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { draftOutlookMailMessage, sendOutlookMailMessage, listScheduledOutlookMessages, cancelScheduledOutlookMessage, sendScheduledOutlookMessageNow } from "@/lib/mail/outlook-inbox";
import {
  listConnectedMailAccounts,
  resolveMailProvider,
} from "@/lib/mail/providers";
import type { MailScheduledMessage } from "@/lib/mail/types";
import { senderNameFor } from "@/lib/mail/sender-identity";
import {
  escapeHtml,
  signatureHtml,
  signaturePlainText,
} from "@/lib/mail/signature-html";
import { formatFromHeader } from "@/lib/mail/sender-name";
import { getMailSignatureSettings } from "@/lib/mail/settings";
import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { PlanError } from "@/lib/plan/errors";
import { utf8ToBase64 } from "@/lib/base64";
import { discardGmailDraft, discardOutlookDraft } from "@/lib/mail/inbox-drafts";
import { newRfcMessageId, translateGmailError } from "@/lib/mail/inbox-gmail-common";

function encodeSubject(subject: string): string {
  if (/^[\x20-\x7e]*$/.test(subject)) return subject;
  return `=?UTF-8?B?${utf8ToBase64(subject)}?=`;
}

function base64Wrapped(text: string): string {
  return utf8ToBase64(text).replace(/(.{76})/g, "$1\r\n");
}

/** Wrap already-encoded standard base64 at 76 chars (MIME). */
function wrapBase64(b64: string): string {
  const clean = b64.replace(/\s+/g, "");
  return clean.replace(/(.{76})/g, "$1\r\n");
}

function sanitizeMimeFilename(filename: string): string {
  return filename.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "attachment";
}

/** Gmail's practical raw-message size limit. */
export const MAIL_ATTACHMENT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
export type OutgoingAttachment = {
  filename: string;
  mimeType: string;
  /** Standard base64 (not base64url). */
  contentBase64: string;
  /**
   * Set when this is a picture written into the body rather than hung off
   * the end of it: the body refers to it as `cid:` this value, and it is
   * sent inside `multipart/related` instead of beside the message.
   */
  contentId?: string;
};

/** Original message quoted below a forward, Gmail-style. */
export type ForwardedMessage = {
  fromName: string;
  fromEmail: string;
  /** Display date of the original message. */
  date: string;
  subject: string;
  to: string[];
  text: string;
  /** Sanitized HTML of the original, so rich mail forwards with its layout. */
  html?: string;
};

function forwardedPlainText(forward: ForwardedMessage): string {
  const from = forward.fromName
    ? `${forward.fromName} <${forward.fromEmail}>`
    : forward.fromEmail;
  return [
    "---------- Forwarded message ----------",
    `From: ${from}`,
    `Date: ${forward.date}`,
    `Subject: ${forward.subject}`,
    `To: ${forward.to.join(", ")}`,
    "",
    forward.text,
  ].join("\n");
}

function forwardedHtml(forward: ForwardedMessage): string {
  const from = forward.fromName
    ? `${escapeHtml(forward.fromName)} &lt;${escapeHtml(forward.fromEmail)}&gt;`
    : escapeHtml(forward.fromEmail);
  const rows = [
    `From: ${from}`,
    `Date: ${escapeHtml(forward.date)}`,
    `Subject: ${escapeHtml(forward.subject)}`,
    `To: ${escapeHtml(forward.to.join(", "))}`,
  ].join("<br>");
  const original =
    forward.html ||
    `<pre style="white-space:pre-wrap;font-family:Helvetica,Arial,sans-serif;font-size:12pt;margin:0">${escapeHtml(forward.text)}</pre>`;
  return [
    '<div style="margin-top:24px;padding-top:12px;border-top:1px solid #ddd">',
    `<div style="font-size:13px;color:#555;line-height:1.5"><b>---------- Forwarded message ----------</b><br>${rows}</div>`,
    `<div style="margin-top:12px">${original}</div>`,
    "</div>",
  ].join("");
}

/** The message being replied to, quoted Gmail-style below the reply. */
export type QuotedMessage = {
  fromName: string;
  fromEmail: string;
  /** Display date of the original message. */
  date: string;
  text: string;
  /** Sanitized HTML of the original, so rich mail quotes with its layout. */
  html?: string;
};

function quotedPlainText(quote: QuotedMessage): string {
  const from = quote.fromName
    ? `${quote.fromName} <${quote.fromEmail}>`
    : quote.fromEmail;
  const quoted = quote.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `On ${quote.date}, ${from} wrote:\n${quoted}`;
}

function quotedHtml(quote: QuotedMessage): string {
  const from = quote.fromName
    ? `${escapeHtml(quote.fromName)} &lt;${escapeHtml(quote.fromEmail)}&gt;`
    : escapeHtml(quote.fromEmail);
  const original =
    quote.html ||
    `<pre style="white-space:pre-wrap;font-family:Helvetica,Arial,sans-serif;font-size:12pt;margin:0">${escapeHtml(quote.text)}</pre>`;
  // class=gmail_quote so our own reader (and Gmail) can collapse the quote
  // behind the "…" pill the same way inbound replies do.
  return [
    '<div class="gmail_quote" style="margin-top:24px">',
    `<div class="gmail_attr" style="font-size:13px;color:#555">On ${escapeHtml(quote.date)}, ${from} wrote:</div>`,
    `<blockquote class="gmail_quote" style="margin:8px 0 0 0;padding-left:12px;border-left:2px solid #ddd">${original}</blockquote>`,
    "</div>",
  ].join("");
}

/**
 * The messages a provider is holding for this thread, and when each goes.
 *
 * Only Outlook can send later. A Gmail message in the local outbox is on
 * its way now, and the thread already shows it as a bubble. Listed here
 * too, it showed a second time: an empty box with "Sends 12:16", Edit,
 * Send now and Cancel. The Outbox group at the top of the list still
 * shows it, through `listAllScheduledMailMessages`.
 */
export async function listScheduledMailMessages(input: {
  account: string;
  /** One conversation, or the whole mailbox when left out. */
  threadId?: string;
}): Promise<MailScheduledMessage[]> {
  if ((await resolveMailProvider(input.account)) !== "outlook") return [];
  return listScheduledOutlookMessages(input.account, input.threadId);
}

/** Gmail messages the outbox holds for a time, as scheduled rows. */
async function heldInOutbox(account: string): Promise<MailScheduledMessage[]> {
  const invoke = tauriInvoke();
  if (!invoke) return [];
  if (!(await localStoreServes(account))) return [];
  const answer = (await invoke("mail_sync_outbox", { account })) as
    | {
        id: number;
        threadId?: string | null;
        subject: string;
        to: string[];
        sendAt: number;
        status?: "waiting" | "sending" | "failed";
        lastError?: string | null;
      }[]
    | null;
  // A shell without the command answers nothing, which is an empty outbox.
  const rows = Array.isArray(answer) ? answer : [];
  // Every row, whatever its state: a message on its way and one given
  // up are both the reader's to see, in the Outbox at the top of the
  // list, until they have gone.
  return rows.map((row) => ({
    id: String(row.id),
    sendAt: new Date(row.sendAt).toISOString(),
    account,
    threadId: row.threadId ?? "",
    toName: row.to[0] ?? "",
    subject: row.subject,
    bodyText: "",
    to: row.to,
    cc: [],
    status: row.status ?? "waiting",
    ...(row.lastError ? { error: row.lastError } : null),
  }));
}

/**
 * Everything being held, across every mailbox that can hold anything.
 *
 * For the group at the top of the list. Outlook holds messages on the
 * server. A Gmail mailbox with a local copy holds them in the outbox — a
 * message on its way, one waiting for its time, one the server refused —
 * and a Gmail mailbox without one holds nothing, which `heldInOutbox`
 * answers without a round trip.
 */
export async function listAllScheduledMailMessages(input: {
  clerkUserId: string;
  scope?: MailAccountScope;
}): Promise<MailScheduledMessage[]> {
  const accounts = filterAccountsForScope(
    await listConnectedMailAccounts(input.clerkUserId),
    input.scope ?? "all"
  );
  if (!accounts.length) return [];

  const pages = await Promise.all(
    accounts.map(async (a) => {
      try {
        if (a.provider !== "outlook") return await heldInOutbox(a.email);
        return await listScheduledOutlookMessages(a.email);
      } catch (err) {
        // One mailbox refusing must not empty the group for the others.
        console.warn("[mail] could not list held messages:", err);
        return [];
      }
    })
  );
  return pages.flat().sort((a, b) => a.sendAt.localeCompare(b.sendAt));
}

/** Never send it. */
export async function cancelScheduledMailMessage(input: {
  account: string;
  id: string;
}): Promise<void> {
  if ((await resolveMailProvider(input.account)) !== "outlook") {
    const invoke = tauriInvoke();
    if (!invoke) throw new PlanError("Only Outlook holds a message for a time", 400);
    await invoke("mail_sync_outbox_cancel", { account: input.account, id: Number(input.id) });
    invalidateInboxCache();
    return;
  }
  await cancelScheduledOutlookMessage(input.account, input.id);
  invalidateInboxCache();
}

/** Send it now instead of when it was set for. */
export async function sendScheduledMailMessageNow(input: {
  account: string;
  id: string;
}): Promise<void> {
  if ((await resolveMailProvider(input.account)) !== "outlook") {
    const invoke = tauriInvoke();
    if (!invoke) throw new PlanError("Only Outlook holds a message for a time", 400);
    await invoke("mail_sync_outbox_send_now", { account: input.account, id: Number(input.id) });
    invalidateInboxCache();
    return;
  }
  await sendScheduledOutlookMessageNow(input.account, input.id);
  invalidateInboxCache();
}

/**
 * What a message carries below its words: a forward, a quote, or the
 * history the composer rebuilt.
 */
type Appendix = {
  forward?: ForwardedMessage;
  quote?: QuotedMessage;
  appendix?: { text: string; html: string };
};

/** The appendix, as html. */
function appendixHtml(input: Appendix): string {
  if (input.forward) return forwardedHtml(input.forward);
  if (input.quote) return quotedHtml(input.quote);
  return input.appendix?.html ?? "";
}

/** The same, as plain text. */
function appendixText(input: Appendix): string {
  if (input.forward) return forwardedPlainText(input.forward);
  if (input.quote) return quotedPlainText(input.quote);
  return input.appendix?.text ?? "";
}

/**
 * Hand the message to Outlook, by leaving it in the mailbox as a draft.
 *
 * For the times the reader wants to finish a mail in Outlook itself. A file
 * handed to Outlook opens read-only — it previews a message rather than
 * composing one — so the draft is made where Outlook already looks: in the
 * mailbox. It appears in Drafts on the next sync, formatted, editable, and
 * in the conversation it answers.
 *
 * Outlook mailboxes only. Gmail has drafts too, but a draft in Gmail is not
 * a draft in Outlook, and offering this on an account Outlook does not hold
 * would promise something nothing can do.
 */
export async function draftMailInOutlook(input: {
  account: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  html?: string;
  includeSignature?: boolean;
  threadId?: string;
  forward?: ForwardedMessage;
  quote?: QuotedMessage;
  appendix?: { text: string; html: string };
  attachments?: OutgoingAttachment[];
}): Promise<{ id: string; webLink?: string }> {
  // Somebody, anywhere on the envelope. A course mail goes to two dozen
  // people in Bcc and to nobody in To, which is what Bcc is for — counting
  // only To refused exactly the message Bcc exists for.
  if (!input.to.length && !input.cc?.length && !input.bcc?.length) {
    throw new PlanError("Add at least one recipient", 400);
  }

  const provider = await resolveMailProvider(input.account);
  if (provider !== "outlook") {
    throw new PlanError(
      "Only an Outlook mailbox can hand a draft to Outlook.",
      400
    );
  }

  // The same lift a send does: the composer can only hold a picture as a
  // `data:` URI, and Outlook will not draw one.
  const lifted = input.html
    ? extractInlineImages(input.html)
    : { html: input.html, images: [] };
  const attachments = lifted.images.length
    ? [...(input.attachments ?? []), ...lifted.images]
    : input.attachments;

  const appendix = appendixHtml(input);

  return draftOutlookMailMessage({
    account: input.account,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    html: lifted.html,
    includeSignature: input.includeSignature,
    threadId: input.threadId,
    attachments,
    appendixHtml: appendix || undefined,
  });
}

/**
 * The Gmail message itself: the headers, then the words as text and (when
 * there is any) html, the pictures the body refers to, and the files.
 */
function gmailRawMessage({
  headers,
  plainBody,
  htmlBody,
  attachments,
}: {
  headers: string[];
  plainBody: string;
  /** The html part, whole; null sends text alone. */
  htmlBody: string | null;
  attachments: OutgoingAttachment[];
}): string {
  const buildAlternative = (): { headers: string[]; body: string } => {
    if (htmlBody !== null) {
      const boundary = `=_redd_alt_${Date.now().toString(36)}`;
      return {
        headers: [
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ],
        body: [
          `--${boundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          base64Wrapped(plainBody),
          `--${boundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: base64",
          "",
          base64Wrapped(htmlBody),
          `--${boundary}--`,
        ].join("\r\n"),
      };
    }
    return {
      headers: [
        'Content-Type: text/plain; charset="UTF-8"',
        "Content-Transfer-Encoding: base64",
      ],
      body: base64Wrapped(plainBody),
    };
  };

  /*
   * The pictures written into the body, and the files hung off the end.
   *
   * They are not the same kind of part and cannot share a wrapper: a picture
   * the body refers to by `cid:` has to sit in `multipart/related` *with*
   * that body, or the client has nothing to resolve the reference against
   * and draws a broken image. A file beside the message sits in
   * `multipart/mixed`, outside all of it.
   *
   * So the nesting is mixed( related( alternative, pictures ), files ) —
   * and where there are no pictures it stays exactly the shape it was.
   */
  const inlineParts = attachments.filter((a) => a.contentId);
  const fileParts = attachments.filter((a) => !a.contentId);

  /** The body, with any pictures it refers to wrapped in with it. */
  const buildRelated = (): { headers: string[]; body: string } => {
    const alt = buildAlternative();
    if (!inlineParts.length) return alt;
    const related = `=_redd_rel_${Date.now().toString(36)}`;
    const parts: string[] = [`--${related}`, ...alt.headers, "", alt.body];
    for (const image of inlineParts) {
      const filename = sanitizeMimeFilename(image.filename);
      const mimeType =
        image.mimeType.replace(/[\r\n]+/g, "").trim() || "image/png";
      parts.push(
        `--${related}`,
        `Content-Type: ${mimeType}; name="${filename}"`,
        // Angle brackets, because that is what a Content-ID is. The body
        // says `cid:x`; the header says `<x>`.
        `Content-ID: <${image.contentId}>`,
        `Content-Disposition: inline; filename="${filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(image.contentBase64)
      );
    }
    parts.push(`--${related}--`);
    return {
      headers: [`Content-Type: multipart/related; boundary="${related}"`],
      body: parts.join("\r\n"),
    };
  };

  if (fileParts.length) {
    const alt = buildRelated();
    const mixed = `=_redd_mix_${Date.now().toString(36)}`;
    const parts: string[] = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      "",
      `--${mixed}`,
      ...alt.headers,
      "",
      alt.body,
    ];
    for (const file of fileParts) {
      const filename = sanitizeMimeFilename(file.filename);
      const mimeType =
        file.mimeType.replace(/[\r\n]+/g, "").trim() ||
        "application/octet-stream";
      parts.push(
        `--${mixed}`,
        `Content-Type: ${mimeType}; name="${filename}"`,
        `Content-Disposition: attachment; filename="${filename}"`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapBase64(file.contentBase64)
      );
    }
    parts.push(`--${mixed}--`);
    return parts.join("\r\n");
  }
  const alt = buildRelated();
  return [...headers, ...alt.headers, "", alt.body].join("\r\n");

}

/** Gmail refuses a message over 25 MB; say so before asking it. */
function refuseOverGmailLimit(attachments: OutgoingAttachment[]): void {
  let attachmentBytes = 0;
  for (const a of attachments) {
    const bytes = Math.floor((a.contentBase64.replace(/\s+/g, "").length * 3) / 4);
    attachmentBytes += bytes;
  }
  if (attachmentBytes > MAIL_ATTACHMENT_MAX_TOTAL_BYTES) {
    throw new PlanError(
      "Attachments exceed Gmail’s 25 MB limit. Remove some files and try again.",
      400
    );
  }
}

/**
 * What no provider is asked to send: a message to nobody, or one held to a
 * time that is not a time or has passed.
 */
function refuseUnsendable(input: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  sendAt?: string;
}): void {
  // Somebody, anywhere on the envelope. A course mail goes to two dozen
  // people in Bcc and to nobody in To, which is what Bcc is for — counting
  // only To refused exactly the message Bcc exists for.
  if (!input.to.length && !input.cc?.length && !input.bcc?.length) {
    throw new PlanError("Add at least one recipient", 400);
  }

  if (input.sendAt) {
    const at = Date.parse(input.sendAt);
    if (!Number.isFinite(at)) {
      throw new PlanError("That send time is not a time", 400);
    }
    if (at <= Date.now()) {
      throw new PlanError("Choose a time that has not passed", 400);
    }
  }
}

export async function sendMailMessage(input: {
  account: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Rich-text body; when present the mail is sent as multipart/alternative. */
  html?: string;
  /** Append the shared signature (default true). */
  includeSignature?: boolean;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  /** Quoted below the body (and signature) when forwarding. */
  forward?: ForwardedMessage;
  /** The original message, quoted below a reply Gmail-style. */
  quote?: QuotedMessage;
  /**
   * The thread's history, rebuilt by the composer and quoted below the
   * body. Pre-rendered, because the composer holds the thread and the
   * preview must show exactly what will be sent — one builder, two uses.
   * See lib/mail/quote-history.
   */
  appendix?: { text: string; html: string };
  /** File attachments (base64); wrapped as multipart/mixed. */
  attachments?: OutgoingAttachment[];
  /**
   * A draft the provider is holding, which this send replaces.
   *
   * Discarded after the mail is away, never before: a failed send must leave
   * the reader's draft where it was. Discarding it at all is what stops the
   * provider keeping an unsent copy of a message that has gone out.
   */
  discardProviderDraft?: string;
  /**
   * Hold the message until this time (ISO 8601). Outlook only.
   *
   * Exchange keeps it and sends it, so it goes whether or not this machine is
   * on. Gmail has nothing like it: their schedule send lives in Google's own
   * client and was never opened to the API, and holding the message here
   * instead would mean a send that quietly does not happen when the machine
   * is asleep or on a plane. So this asks the provider or it refuses.
   */
  sendAt?: string;
}): Promise<{ messageId?: string; threadId?: string }> {
  refuseUnsendable(input);

  /*
   * The pictures in the body become parts of the message.
   *
   * Done once, above the split, because it is the same job on both
   * providers: the composer can only hold a picture as a `data:` URI, and
   * neither Gmail's web client nor Outlook will draw one of those. What
   * goes out refers to `cid:` instead, with the bytes travelling as their
   * own part — see `extractInlineImages`.
   */
  const lifted = input.html
    ? extractInlineImages(input.html)
    : { html: input.html, images: [] };
  if (lifted.images.length) {
    input = {
      ...input,
      html: lifted.html,
      attachments: [...(input.attachments ?? []), ...lifted.images],
    };
  }

  const provider = await resolveMailProvider(input.account);
  // The outbox holds a Gmail message for its time; the API never could.
  const viaOutbox = provider === "gmail" && Boolean(tauriInvoke()) && (await localStoreServes(input.account));
  if (input.sendAt && provider !== "outlook" && !viaOutbox) {
    throw new PlanError(
      "Only Outlook accounts can send later. Gmail has no way to hold a message for us.",
      400
    );
  }

  if (provider === "outlook") {
    // Graph's createReply pre-fills the quoted original, and the PATCH that
    // sets our body overwrites it — so an Outlook reply from here carried
    // no history at all, whatever the composer asked. The appendix is
    // rendered into the body instead, the same as the Gmail path.
    const outlookAppendix = appendixHtml(input);
    await sendOutlookMailMessage({
      account: input.account,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body: input.body,
      html: input.html,
      includeSignature: input.includeSignature,
      threadId: input.threadId,
      sendAt: input.sendAt,
      attachments: input.attachments,
      appendixHtml: outlookAppendix || undefined,
    });
    if (input.discardProviderDraft) {
      await discardOutlookDraft(input.account, input.discardProviderDraft);
    }
    invalidateInboxCache();
    // Graph sendMail doesn't return ids; keep the conversation we replied in.
    return { threadId: input.threadId };
  }

  // Only the API path needs a token; the outbox path never asks for one.
  let tokenPromise: Promise<string> | null = null;
  const tokenFor = () => (tokenPromise ??= accessTokenFor(input.account));

  const attachments = input.attachments ?? [];
  refuseOverGmailLimit(attachments);

  const signature =
    input.includeSignature === false
      ? ""
      : (await getMailSignatureSettings(input.account)).signature;
  const noteWithSignature = signature
    ? `${input.body.replace(/\s+$/, "")}\n\n${signaturePlainText(signature)}`
    : input.body;
  const plainAppendix = appendixText(input);
  const plainBody = plainAppendix
    ? `${noteWithSignature.trimEnd()}\n\n${plainAppendix}`.trimStart()
    : noteWithSignature;

  // The name Gmail already puts on their mail. Never throws: an account we
  // cannot ask sends with the bare address, the way every send did before.
  const senderName = await senderNameFor(input.account, {
    token: await tokenFor(),
    provider: "gmail",
  });

  const headers = [
    `From: ${formatFromHeader(input.account, senderName)}`,
    // Nobody in To (a message to Bcc alone): the empty group, not an empty
    // header, which is not valid and which some servers refuse.
    `To: ${input.to.length ? input.to.join(", ") : "undisclosed-recipients:;"}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
    `Subject: ${encodeSubject(input.subject)}`,
    `Message-ID: ${newRfcMessageId(input.account)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    "MIME-Version: 1.0",
  ];

  // 12pt matches Outlook's default, so replies don't render smaller than
  // the rest of the thread (for us and for recipients).
  const htmlBody =
    input.html || input.forward || input.quote || input.appendix
      ? `<div style="font-family:Helvetica,Arial,sans-serif;font-size:12pt;line-height:1.6;color:#222">${input.html ?? ""}${
          signature ? signatureHtml(signature) : ""
        }${appendixHtml(input)}</div>`
      : null;
  const raw = gmailRawMessage({ headers, plainBody, htmlBody, attachments });

  if (viaOutbox) {
    // Written to the outbox and shown as sent; the worker carries it over
    // SMTP as soon as it is woken, a first sync included, and Gmail files
    // the copy in Sent itself. Until it has gone it stands in the Outbox
    // group at the top of the list.
    const invoke = tauriInvoke();
    if (invoke) {
      const recipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])]
        .map((e) => e.trim())
        .filter(Boolean);
      await invoke("mail_sync_send", {
        account: input.account,
        threadId: input.threadId ?? null,
        recipients,
        raw,
        subject: input.subject,
        to: input.to,
        sendAt: input.sendAt ? Date.parse(input.sendAt) : null,
        // Discarded by the worker once the send has gone through, not
        // here: a message the server refused kept its draft that way.
        draftMessageId: input.discardProviderDraft ?? null,
      });
      invalidateInboxCache();
      return { threadId: input.threadId };
    }
  }

  let sent: { id: string; threadId?: string } | undefined;
  try {
    sent = await sendRawMessage(await tokenFor(), raw, input.threadId);
  } catch (err) {
    translateGmailError(err, input.account);
  }
  if (input.discardProviderDraft) {
    await discardGmailDraft(
      await tokenFor(),
      input.discardProviderDraft,
      sent?.threadId ?? input.threadId
    );
  }
  invalidateInboxCache();
  return {
    messageId: sent?.id,
    threadId: sent?.threadId ?? input.threadId,
  };
}
