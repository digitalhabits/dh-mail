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
import { isAppPasswordGmail } from "@/lib/gmail/accounts";
import { mailStore } from "@/lib/mail/store";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import { fetchExchangeBodies } from "@/lib/mail/exchange-native";
import type { MailStoredBody, MailStoredMessage } from "@/lib/mail/store/types";
import type { MailAttachment, MailMessage, MailOutlineItem, MailThreadDetail } from "@/lib/mail/types";
import { isOwnOrgAddress, normalizeEmail } from "@/lib/own-addresses";
import { replyTargets } from "@/lib/mail/reply-target";
import { dedupeMessagesByRfcId } from "@/lib/mail/thread-copies";
import { adoptSplitThread, getChatForThread, noteChatMessageIds } from "@/lib/mail/chats";
import { THREAD_PAGE_SIZE } from "@/lib/mail/thread-classify";
import { emptyThreadDetail, threadWindow } from "@/lib/mail/thread-window";
import { participantNames } from "@/lib/mail/thread-participants";

/** An attachment id that names an IMAP section of the message. */
export const IMAP_ATTACHMENT_PREFIX = "imap:";

type StoredWithBody = MailStoredMessage & {
  body: MailStoredBody | null;
  /** Merged in from this mailbox's copy of the conversation (`withCopies`). */
  copy?: { account: string; threadId: string };
};

/** More copies than this are not read: a conversation reaches a few mailboxes at most. */
const MAX_COPIES = 4;

/**
 * The conversation's messages from the reader's other mailboxes, added to
 * this mailbox's rows. Only the ones this mailbox lacks, by Message-ID.
 *
 * A conversation that reached two mailboxes is one row in the list. If the
 * thread view reads only that row's mailbox, a message that only the other
 * mailbox has is missing from the conversation. Most often that message is
 * the reader's own reply in its Sent folder. A message with no
 * Message-ID cannot be matched, so it is not merged.
 */
async function withCopies(account: string, rows: StoredWithBody[]): Promise<StoredWithBody[]> {
  const ids = rows.filter((r) => !r.isDraft).map((r) => r.rfcMessageId);
  return [...rows, ...(await copyRows(account, ids))];
}

/**
 * The messages of the copies in other mailboxes that these Message-IDs do
 * not name: what `withCopies` adds. Empty when there are no copies.
 */
async function copyRows(account: string, rfcIds: (string | null | undefined)[]): Promise<StoredWithBody[]> {
  const store = mailStore();
  if (!store.messages.copies) return [];
  const key = (id: string | null | undefined) => (id ?? "").trim();
  const ids = rfcIds.map(key).filter(Boolean);
  if (!ids.length) return [];
  const copies = await store.messages.copies(account, ids).catch(() => []);
  if (!copies.length) return [];
  const seen = new Set(ids);
  const out: StoredWithBody[] = [];
  for (const copy of copies.slice(0, MAX_COPIES)) {
    const theirs = await store.messages.thread(copy.account, copy.threadId).catch(() => []);
    for (const row of theirs) {
      const id = key(row.rfcMessageId);
      if (row.isDraft || !id || seen.has(id)) continue;
      seen.add(id);
      out.push({ ...row, copy });
    }
  }
  return out;
}

/**
 * The same for a thread read from the provider instead of the copy: an
 * Outlook mailbox over Graph, or Gmail over its API. Without this, a reply
 * the reader sent from another mailbox was missing from the conversation
 * whenever the list's row was the copy in such a mailbox.
 *
 * Only the newest window, or the whole thread: a page of older messages
 * would show again what the first window added. And only from the oldest
 * message shown onward, so the newest window does not gain old messages.
 */
export async function withLocalCopies(
  detail: MailThreadDetail,
  options?: { before?: string; after?: string; around?: string }
): Promise<MailThreadDetail> {
  if (options?.before || options?.after || options?.around || !detail.messages.length) return detail;
  const ids = detail.messages.map((m) => m.rfcMessageId);
  let extra = await copyRows(detail.account, ids).catch(() => []);
  const from = detail.hasOlder
    ? Math.min(...detail.messages.map((m) => (m.sentAt ? Date.parse(m.sentAt) : Infinity)))
    : -Infinity;
  const shown = (rows: StoredWithBody[]) => rows.filter((r) => r.sentAt >= from);
  extra = shown(extra);
  if (!extra.length) return detail;
  // Bodies the copies lack, from their own mailboxes, as the copy path does.
  const lacking = extra.filter((r) => !r.body);
  if (lacking.length) {
    for (const other of new Set(lacking.map((r) => r.copy!.account))) {
      const missing = lacking.filter((r) => r.copy?.account === other).map((r) => r.messageId);
      await resolveMailProvider(other)
        .then((provider) => fetchMissingBodies(other, provider, missing))
        .catch(() => false);
    }
    extra = shown(await copyRows(detail.account, ids).catch(() => extra));
  }
  const messages = dedupeMessagesByRfcId(
    [...detail.messages, ...extra.map((r) => toMailMessage(r, detail.account))].sort(
      (a, b) => (a.sentAt ? Date.parse(a.sentAt) : 0) - (b.sentAt ? Date.parse(b.sentAt) : 0)
    )
  );
  const added = messages.length - detail.messages.length;
  return {
    ...detail,
    messages,
    ...(detail.totalMessageCount != null ? { totalMessageCount: detail.totalMessageCount + added } : null),
  };
}

/** The mailbox a row is in. */
const rowAccount = (row: StoredWithBody, account: string) => row.copy?.account ?? account;

export type LocalThreadOptions = {
  before?: string;
  after?: string;
  around?: string;
  oldest?: boolean;
  limit?: number;
  markRead?: boolean;
};

/**
 * Fetch the bodies a thread window lacks, and keep them. False when this
 * path cannot: the caller then asks the provider.
 *
 * Gmail's bodies come over IMAP, and an Exchange item's from its MIME over
 * EWS. An Outlook body arrives with its row, so one missing means the
 * provider path answers.
 */
async function fetchMissingBodies(account: string, provider: string, missing: string[]): Promise<boolean> {
  if (provider === "exchange") {
    await fetchExchangeBodies(account, missing).catch((err: unknown) => {
      console.warn(`[mail] ${account}: Exchange bodies were not fetched:`, err);
    });
    return true;
  }
  const invoke = tauriInvoke();
  if (!invoke || provider !== "gmail") return false;
  await invoke("mail_sync_fetch_bodies", { account, messageIds: missing });
  return true;
}

/**
 * A thread's outline from the copy: every message, headers and first words
 * only, no bodies. Null where the copy does not serve this mailbox's
 * threads, by the same rule `threadFromLocalStore` keeps.
 */
export async function outlineFromLocalStore(
  account: string,
  threadId: string
): Promise<MailOutlineItem[] | null> {
  if (!(await localStoreComplete(account))) {
    const early = await resolveMailProvider(account).catch(() => null);
    if (early !== "exchange" && !(early === "gmail" && (await isAppPasswordGmail(account)))) {
      return null;
    }
  }
  const rows = await withCopies(account, await mailStore().messages.thread(account, threadId));
  if (!rows.length) return null;
  return rows
    .filter((r) => !r.isDraft)
    .sort((a, b) => a.sentAt - b.sentAt)
    .map((r) => {
      const owner = rowAccount(r, account);
      return {
        id: r.messageId,
        sentAt: r.sentAt ? new Date(r.sentAt).toISOString() : null,
        own: normalizeEmail(r.fromEmail) === normalizeEmail(owner) || isOwnOrgAddress(r.fromEmail),
        ...(r.unread ? { unread: true as const } : null),
        fromName: r.fromName || r.fromEmail,
        fromEmail: r.fromEmail,
        firstLine: (r.snippet ?? "").slice(0, 160),
        ...(r.hasAttachments ? { hasAttachments: true as const } : null),
        rfcMessageId: r.rfcMessageId ?? null,
      };
    });
}

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
  // half a copy is a thread with its older messages quietly missing. An
  // Exchange mailbox has no other source, so its copy serves at once.
  // Nor has a Gmail on an app password: Google's API does not take it.
  const complete = await localStoreComplete(account);
  const early = complete ? null : await resolveMailProvider(account).catch(() => null);
  if (!complete && early !== "exchange" && !(early === "gmail" && (await isAppPasswordGmail(account)))) {
    return null;
  }
  const store = mailStore();
  const readRows = async () => withCopies(account, await store.messages.thread(account, threadId));
  let rows = await readRows();
  if (!rows.length) return null;

  // Drafts are the composer's, not the thread's; the newest is offered back.
  const all = rows.filter((r) => !r.isDraft).sort((a, b) => a.sentAt - b.sentAt);
  if (!all.length) return null;
  const draft = rows.filter((r) => r.isDraft).sort((a, b) => b.sentAt - a.sentAt)[0] ?? null;
  const limit = options?.limit ?? THREAD_PAGE_SIZE;
  const window = pickWindow(all, options, limit);
  if (!window) return emptyThreadDetail(account, threadId);

  // Bodies the window lacks, fetched once and kept. The draft's too.
  const filled = await fillBodies(account, early, window.rows, draft, readRows);
  if (!filled) return null;
  window.rows = filled.windowRows;
  rows = filled.rows ?? rows;
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
  const { reply, replyFrom } = replyOf(last, account);
  const subject = (last.subject ?? "").trim() || "(no subject)";
  const references = [last.references ?? "", last.rfcMessageId ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");

  const names = participantNames(messages);

  // Opening a window marks the thread read in the copy at once; the
  // provider learns it through the action queue.
  if (options?.markRead !== false && !options?.before && !options?.after) {
    await markCopiesRead(all, account, threadId);
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
      ...(replyFrom ? { from: replyFrom } : null),
    },
  };
}

/**
 * Whom a reply goes to, from the conversation's newest message, and from
 * which mailbox. A newest message that only another mailbox has (the
 * reader's own reply sent from there) is answered from that mailbox, and
 * this mailbox is not one of the people it goes to.
 */
function replyOf(last: StoredWithBody, account: string) {
  const from = rowAccount(last, account);
  const targets = replyTargets({
    from: last.fromEmail,
    to: last.to.map((a) => a.email),
    cc: last.cc.map((a) => a.email),
    account: from,
  });
  if (from === account) return { reply: targets, replyFrom: null };
  const notHere = (list: string[]) => list.filter((e) => normalizeEmail(e) !== normalizeEmail(account));
  return {
    reply: { to: notHere(targets.to), allTo: notHere(targets.allTo), allCc: notHere(targets.allCc) },
    replyFrom: from,
  };
}

/**
 * Fetch the bodies the window lacks, each from its own mailbox: a merged-in
 * copy's body is that mailbox's. Null when this mailbox's own cannot be
 * fetched; a copy that cannot be fetched shows with no body.
 */
async function fillBodies(
  account: string,
  early: string | null,
  windowRows: StoredWithBody[],
  draft: StoredWithBody | null,
  readRows: () => Promise<StoredWithBody[]>
): Promise<{ windowRows: StoredWithBody[]; rows: StoredWithBody[] | null } | null> {
  const missing = [...windowRows, ...(draft ? [draft] : [])].filter((r) => !r.body);
  if (!missing.length) return { windowRows, rows: null };
  const provider = early ?? (await resolveMailProvider(account));
  const own = missing.filter((r) => !r.copy).map((r) => r.messageId);
  if (own.length && !(await fetchMissingBodies(account, provider, own))) return null;
  for (const other of new Set(missing.filter((r) => r.copy).map((r) => r.copy!.account))) {
    const ids = missing.filter((r) => r.copy?.account === other).map((r) => r.messageId);
    await resolveMailProvider(other)
      .then((p) => fetchMissingBodies(other, p, ids))
      .catch(() => false);
  }
  const rows = await readRows();
  const at = (r: StoredWithBody) => `${rowAccount(r, account)}|${r.messageId}`;
  const byId = new Map(rows.map((r) => [at(r), r]));
  const fresh = windowRows.map((r) => byId.get(at(r)) ?? r);
  // An Exchange message whose body the server did not give still shows,
  // with no body: there is no other path to ask.
  if (provider !== "exchange" && fresh.some((r) => !r.body && !r.copy)) return null;
  return { windowRows: fresh, rows };
}

/** Mark the conversation read in every mailbox: the list shows its copies as one row. */
async function markCopiesRead(all: StoredWithBody[], account: string, threadId: string) {
  const store = mailStore();
  const unreadIn = new Map<string, { account: string; threadId: string }>();
  for (const r of all) {
    if (!r.unread) continue;
    const where = r.copy ?? { account, threadId };
    unreadIn.set(`${where.account}|${where.threadId}`, where);
  }
  for (const where of unreadIn.values()) {
    const queued = await queueLocalAction(where.account, where.threadId, "read").catch(() => false);
    if (!queued) await store.messages.setUnread(where.account, where.threadId, false).catch(() => undefined);
  }
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


type StoredPart = { section: string; filename: string; mimeType: string; size: number; text?: string };

function toMailMessage(row: StoredWithBody, threadAccount: string): MailMessage {
  const account = rowAccount(row, threadAccount);
  const body = row.body;
  const attachments: MailAttachment[] = ((body?.attachments ?? []) as StoredPart[]).map((p) => ({
    attachmentId: `${IMAP_ATTACHMENT_PREFIX}${p.section}`,
    filename: p.filename,
    mimeType: p.mimeType,
    size: p.size,
    ...(typeof p.text === "string" ? { text: p.text } : null),
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
    ...(row.unread ? { unread: true as const } : null),
    ...(row.rfcMessageId ? { rfcMessageId: row.rfcMessageId } : null),
    ...(row.inReplyTo ? { inReplyTo: row.inReplyTo } : null),
    ...(row.references ? { references: row.references } : null),
    ...(row.copy ? { account: row.copy.account } : null),
  };
}
