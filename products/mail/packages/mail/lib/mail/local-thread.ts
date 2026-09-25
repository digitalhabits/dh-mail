/**
 * A thread from the local copy.
 *
 * The rows are already on disk; what may be missing is a body, which the
 * IMAP worker fetches once and keeps. Everything the thread view needs is
 * built here in the same shape the provider path builds it — windowing,
 * the reply target, the participants, the conversation binding — so the
 * view cannot tell which path answered. See docs/mail-local-store.md.
 */

import "server-only";

import { localStoreComplete, queueLocalAction } from "@/lib/mail/local-store";
import { resolveMailProvider } from "@/lib/mail/providers";
import { mailStore } from "@/lib/mail/store";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import type { MailStoredBody, MailStoredMessage } from "@/lib/mail/store/types";
import type { MailAttachment, MailMessage, MailThreadDetail } from "@/lib/mail/types";
import { isOwnOrgAddress, normalizeEmail } from "@/lib/own-addresses";
import { replyTargets } from "@/lib/mail/reply-target";
import { dedupeMessagesByRfcId } from "@/lib/mail/thread-copies";
import { adoptSplitThread, getChatForThread, noteChatMessageIds } from "@/lib/mail/chats";
import { THREAD_PAGE_SIZE } from "@/lib/mail/thread-classify";
import { emptyThreadDetail, threadWindow } from "@/lib/mail/thread-window";
import { participantNames } from "@/lib/mail/thread-participants";

/** An attachment id that names an IMAP section of the message. */
export const IMAP_ATTACHMENT_PREFIX = "imap:";

type StoredWithBody = MailStoredMessage & { body: MailStoredBody | null };

export type LocalThreadOptions = {
  before?: string;
  after?: string;
  around?: string;
  oldest?: boolean;
  limit?: number;
  markRead?: boolean;
};

/**
 * The thread, or null when the copy does not serve this mailbox, does not
 * hold the thread, or cannot fetch a body it lacks.
 */
export async function threadFromLocalStore(
  account: string,
  threadId: string,
  options?: LocalThreadOptions
): Promise<MailThreadDetail | null> {
  // The whole mailbox, not a copy still filling: a thread read from
  // half a copy is a thread with its older messages quietly missing.
  if (!(await localStoreComplete(account))) return null;
  const store = mailStore();
  let rows = await store.messages.thread(account, threadId);
  if (!rows.length) return null;

  // Drafts are the composer's, not the thread's; the newest is offered back.
  const all = rows.filter((r) => !r.isDraft).sort((a, b) => a.sentAt - b.sentAt);
  if (!all.length) return null;
  const draft = rows.filter((r) => r.isDraft).sort((a, b) => b.sentAt - a.sentAt)[0] ?? null;
  const limit = options?.limit ?? THREAD_PAGE_SIZE;
  const window = pickWindow(all, options, limit);
  if (!window) return emptyThreadDetail(account, threadId);

  // Bodies the window lacks, fetched once and kept. The draft's too.
  const missing = [...window.rows, ...(draft ? [draft] : [])]
    .filter((r) => !r.body)
    .map((r) => r.messageId);
  if (missing.length) {
    const invoke = tauriInvoke();
    if (!invoke) return null;
    // Only Gmail's bodies come over IMAP; an Outlook body arrives with its
    // row, so one missing means the provider path answers.
    if ((await resolveMailProvider(account)) !== "gmail") return null;
    await invoke("mail_sync_fetch_bodies", { account, messageIds: missing });
    rows = await store.messages.thread(account, threadId);
    const byId = new Map(rows.map((r) => [r.messageId, r]));
    window.rows = window.rows.map((r) => byId.get(r.messageId) ?? r);
    if (window.rows.some((r) => !r.body)) return null;
  }
  const draftRow = draft ? (rows.find((r) => r.messageId === draft.messageId) ?? draft) : null;
  const providerDraft = draftRow?.body
    ? {
        ref: draftRow.messageId,
        bodyText: draftRow.body.text ?? "",
        ...(draftRow.body.html ? { bodyHtml: draftRow.body.html } : null),
        to: draftRow.to.map((a) => a.email),
        cc: draftRow.cc.map((a) => a.email),
        updatedAt: draftRow.sentAt ? new Date(draftRow.sentAt).toISOString() : null,
      }
    : null;

  const messages = dedupeMessagesByRfcId(window.rows.map((r) => toMailMessage(r, account)));

  // The reply target comes from the thread's newest message, in or out of
  // the window.
  const last = all[all.length - 1];
  const subject = (last.subject ?? "").trim() || "(no subject)";
  const reply = replyTargets({
    from: last.fromEmail,
    to: last.to.map((a) => a.email),
    cc: last.cc.map((a) => a.email),
    account,
  });
  const references = [last.references ?? "", last.rfcMessageId ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  const names = participantNames(messages);

  // Opening a window marks the thread read in the copy at once; the
  // provider learns it through the action queue.
  if (options?.markRead !== false && !options?.before && !options?.after) {
    if (all.some((r) => r.unread)) {
      const queued = await queueLocalAction(account, threadId, "read").catch(() => false);
      if (!queued) await store.messages.setUnread(account, threadId, false).catch(() => undefined);
    }
  }

  let chat = await getChatForThread(account, threadId, names.find((n) => n !== "You") || undefined);
  if (!chat && messages.length) {
    const head = messages[0];
    const referencedIds = [
      ...(head.references?.match(/<[^>]+>/g) ?? []),
      ...(head.inReplyTo?.match(/<[^>]+>/g) ?? []),
    ];
    if (referencedIds.length) {
      const self = account.trim().toLowerCase();
      const counterpartEmails = [
        ...new Set(
          messages
            .flatMap((m) => [m.fromEmail, ...m.toEmails, ...m.ccEmails])
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e && e !== self && !isOwnOrgAddress(e))
        ),
      ];
      chat = await adoptSplitThread({ account, threadId, subject, referencedIds, counterpartEmails }).catch(
        () => null
      );
    }
  }
  if (chat) {
    await store.chats
      .reconcilePartCount({ account, threadId, messageCount: all.length })
      .catch(() => undefined);
    await noteChatMessageIds(account, threadId, messages.map((m) => m.rfcMessageId));
  }

  return {
    account,
    threadId,
    subject,
    participants: names,
    messages,
    hasOlder: window.hasOlder,
    hasNewer: window.hasNewer,
    totalMessageCount: all.length,
    ...(chat ? { chat } : null),
    ...(providerDraft ? { providerDraft } : null),
    reply: {
      inReplyTo: (last.rfcMessageId ?? "").trim(),
      references,
      to: reply.to,
      cc: [],
      allTo: reply.allTo,
      allCc: reply.allCc,
    },
  };
}


/** The rows the view asked for, and whether more lie either side. */
function pickWindow(
  all: StoredWithBody[],
  options: LocalThreadOptions | undefined,
  limit: number
): { rows: StoredWithBody[]; hasOlder: boolean; hasNewer: boolean } | null {
  const page = threadWindow(
    all.map((r) => r.messageId),
    options,
    limit
  );
  if (!page) return null;
  return { rows: all.slice(page.start, page.end), hasOlder: page.hasOlder, hasNewer: page.hasNewer };
}


type StoredPart = { section: string; filename: string; mimeType: string; size: number };

function toMailMessage(row: StoredWithBody, account: string): MailMessage {
  const body = row.body;
  const attachments: MailAttachment[] = ((body?.attachments ?? []) as StoredPart[]).map((p) => ({
    attachmentId: `${IMAP_ATTACHMENT_PREFIX}${p.section}`,
    filename: p.filename,
    mimeType: p.mimeType,
    size: p.size,
  }));
  const inlineImages = body?.inlineImages ?? {};
  const own =
    normalizeEmail(row.fromEmail) === normalizeEmail(account) || isOwnOrgAddress(row.fromEmail);
  return {
    id: row.messageId,
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    toEmails: row.to.map((a) => a.email),
    ccEmails: row.cc.map((a) => a.email),
    sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
    bodyText: body?.text ?? "",
    ...(body?.html ? { bodyHtml: body.html } : null),
    ...(Object.keys(inlineImages).length ? { inlineImages } : null),
    ...(attachments.length ? { attachments } : null),
    own,
    ...(row.rfcMessageId ? { rfcMessageId: row.rfcMessageId } : null),
    ...(row.inReplyTo ? { inReplyTo: row.inReplyTo } : null),
    ...(row.references ? { references: row.references } : null),
  };
}
