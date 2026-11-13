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
import { pauseCutOff, shownUnderCutOff } from "@/lib/mail/pause-cut-off";
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
  return (await withCopiesAndHeld(account, rows)).shown;
}

/** The same, and beside it the rows a pause holds back. */
async function withCopiesAndHeld(
  account: string,
  rows: StoredWithBody[]
): Promise<{ shown: StoredWithBody[]; held: StoredWithBody[] }> {
  const ids = rows.filter((r) => !r.isDraft).map((r) => r.rfcMessageId);
  const all = [...rows, ...(await copyRows(account, ids, linksOf(rows)))];
  const shown = withoutHeldBack(account, all);
  if (shown.length === all.length) return { shown, held: [] };
  const kept = new Set(shown);
  return { shown, held: all.filter((r) => !kept.has(r)) };
}

/**
 * Whether a stored message is the mailbox's own: a draft, a message it
 * sent (the Sent label), or one from its own address. The store's search
 * and lists use the same rule (read.rs, `before_cut_off`).
 *
 * Not "any address of the organisation", as the bubbles' side uses: that
 * made a colleague's reply the reader's own, so a pause never held it
 * back in the open conversation, while the search did (2026-11-12).
 */
function ownInMailbox(row: StoredWithBody, mailbox: string): boolean {
  if (row.isDraft) return true;
  if (row.labels?.some((label) => label === "SENT" || label === "DRAFT")) return true;
  return normalizeEmail(row.fromEmail) === normalizeEmail(mailbox);
}

/**
 * The thread as a paused mailbox held it: no message that came in after
 * the pause's cut-off (lib/mail/pause-cut-off.ts). Each row by its own
 * mailbox, so a copy in a mailbox that is not paused still shows. The
 * mailbox's own messages and drafts always show.
 */
function withoutHeldBack(account: string, rows: StoredWithBody[]): StoredWithBody[] {
  const cuts = new Map<string, number | null>();
  const cutFor = (mailbox: string) => {
    const key = mailbox.toLowerCase();
    if (!cuts.has(key)) cuts.set(key, pauseCutOff(mailbox));
    return cuts.get(key) ?? null;
  };
  return rows.filter((r) => {
    const owner = r.copy?.account ?? account;
    return shownUnderCutOff({ sentAt: r.sentAt, own: ownInMailbox(r, owner) }, cutFor(owner));
  });
}

/**
 * A thread the provider answered (Outlook over Graph, Gmail over its API),
 * as a paused mailbox held it. The provider knows nothing of the pause, so
 * its answer had every message, the held-back ones too, and the reply went
 * to the newest of them.
 *
 * `held` is how many messages were left out. The reply target is then the
 * newest message that shows.
 */
export function detailWithoutHeldBack(detail: MailThreadDetail): { detail: MailThreadDetail; held: number } {
  const cuts = new Map<string, number | null>();
  const cutFor = (mailbox: string) => {
    const key = mailbox.toLowerCase();
    if (!cuts.has(key)) cuts.set(key, pauseCutOff(mailbox));
    return cuts.get(key) ?? null;
  };
  const messages = detail.messages.filter((m) => {
    const owner = m.account ?? detail.account;
    const cut = cutFor(owner);
    if (cut == null) return true;
    const own = normalizeEmail(m.fromEmail) === normalizeEmail(owner);
    // A message with no date cannot be placed: it is held back.
    const sentAt = m.sentAt ? Date.parse(m.sentAt) : Infinity;
    return shownUnderCutOff({ sentAt: Number.isFinite(sentAt) ? sentAt : Infinity, own }, cut);
  });
  const held = detail.messages.length - messages.length;
  if (!held) return { detail, held: 0 };
  const last = messages[messages.length - 1];
  const from = last ? (last.account ?? detail.account) : detail.account;
  const targets = replyTargets({
    from: last?.fromEmail ?? "",
    to: last?.toEmails ?? [],
    cc: last?.ccEmails ?? [],
    account: from,
  });
  const references = [last?.references ?? "", last?.rfcMessageId ?? ""]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  return {
    held,
    detail: {
      ...detail,
      messages,
      participants: participantNames(messages),
      ...(detail.totalMessageCount != null
        ? { totalMessageCount: Math.max(0, detail.totalMessageCount - held) }
        : null),
      reply: {
        inReplyTo: (last?.rfcMessageId ?? "").trim(),
        references,
        to: targets.to,
        cc: [],
        allTo: targets.allTo,
        allCc: targets.allCc,
        ...(from !== detail.account ? { from } : null),
      },
    },
  };
}

/** What joins a conversation to its other half in another mailbox: see `linksOf`. */
type ThreadLinks = { refIds: string[]; subject: string };

/**
 * The messages a conversation names in its References and In-Reply-To and
 * does not hold, and its subject.
 *
 * A conversation started in one mailbox and answered from another has no
 * message in both, so it was two rows, each with half of it. The store
 * joins the halves by these ids (read.rs, `linked_elsewhere`), as
 * Thunderbird's index does, and only when the subject is the same.
 */
function linksOf(rows: { rfcMessageId?: string | null; references?: string | null; inReplyTo?: string | null; subject?: string; sentAt?: number | string | null; isDraft?: boolean }[]): ThreadLinks {
  const sent = rows.filter((r) => !r.isDraft);
  const own = new Set(sent.map((r) => (r.rfcMessageId ?? "").trim()).filter(Boolean));
  const named = new Set<string>();
  for (const r of sent) {
    for (const id of `${r.references ?? ""} ${r.inReplyTo ?? ""}`.match(/<[^>]+>/g) ?? []) {
      if (!own.has(id)) named.add(id);
    }
  }
  const at = (r: { sentAt?: number | string | null }) => (typeof r.sentAt === "string" ? Date.parse(r.sentAt) : (r.sentAt ?? 0));
  const newest = [...sent].sort((a, b) => at(b) - at(a))[0];
  return { refIds: [...named], subject: newest?.subject ?? "" };
}

/**
 * The messages of the copies in other mailboxes that these Message-IDs do
 * not name: what `withCopies` adds. Empty when there are no copies.
 */
async function copyRows(
  account: string,
  rfcIds: (string | null | undefined)[],
  links?: ThreadLinks
): Promise<StoredWithBody[]> {
  const store = mailStore();
  if (!store.messages.copies) return [];
  const key = (id: string | null | undefined) => (id ?? "").trim();
  const ids = rfcIds.map(key).filter(Boolean);
  if (!ids.length) return [];
  const copies = await store.messages.copies(account, ids, links).catch(() => []);
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
  // The copies under each mailbox's own pause, as the copy path reads them.
  const links = linksOf(detail.messages.map((m) => ({ ...m, subject: detail.subject })));
  const readCopies = async () => withoutHeldBack(detail.account, await copyRows(detail.account, ids, links));
  let extra = await readCopies().catch(() => []);
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
    extra = shown(await readCopies().catch(() => extra));
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
  // The rows a pause holds back are kept apart: they are not shown, but
  // the mark-as-read step must know of them.
  let held: StoredWithBody[] = [];
  const readRows = async () => {
    const read = await withCopiesAndHeld(account, await store.messages.thread(account, threadId));
    held = read.held;
    return read.shown;
  };
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
    await markCopiesRead(all, held, account, threadId);
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

/**
 * Mark the conversation read in every mailbox: the list shows its copies as one row.
 *
 * Not the mail a pause holds back. The "read" action is for the whole
 * thread, in the copy and on the server, so it took the unread mark off a
 * reply the reader had not seen, and the reply was not bold when the pause
 * ended (2026-11-12). A thread with such mail is marked in the copy only,
 * up to the cut-off; the server learns it when the thread is opened after
 * the pause.
 */
async function markCopiesRead(all: StoredWithBody[], held: StoredWithBody[], account: string, threadId: string) {
  const store = mailStore();
  const at = (r: StoredWithBody) => r.copy ?? { account, threadId };
  const key = (where: { account: string; threadId: string }) => `${where.account}|${where.threadId}`;
  const unreadIn = new Map<string, { account: string; threadId: string }>();
  for (const r of all) {
    if (!r.unread) continue;
    unreadIn.set(key(at(r)), at(r));
  }
  const heldUnreadIn = new Set(held.filter((r) => r.unread && !r.isDraft).map((r) => key(at(r))));
  for (const where of unreadIn.values()) {
    if (heldUnreadIn.has(key(where))) {
      await store.messages
        .setUnread(where.account, where.threadId, false, pauseCutOff(where.account))
        .catch(() => undefined);
      continue;
    }
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
