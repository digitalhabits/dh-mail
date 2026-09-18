import { applyLocalAction, localStoreServes, localStoreServesFolder, queueLocalAction } from "@/lib/mail/local-store";
import { highlightRanges, searchHighlightTerms } from "@/lib/mail/search-highlight";
import { wakeOutlookSync } from "@/lib/mail/outlook-sync";
import { IMAP_ATTACHMENT_PREFIX, threadFromLocalStore } from "@/lib/mail/local-thread";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import type { MailStoredThread, MailStoredView } from "@/lib/mail/store/types";
import "server-only";

import {
  decodeSnippet,
  extractAttachments,
  extractBodyHtml,
  extractBodyText,
  getGmailAttachment,
  getMessageFull,
  getThreadFull,
  getThreadMetadata,
  getThreadMinimal,
  headerValue,
  gmailLabelSearchQuery,
  listGmailHistory,
  listRecentMessages,
  listRecentThreads,
  modifyMessageLabels,
  modifyThreadLabels,
  parseAddressList,
  resolveInlineImages,
  listMessageIds,
  getMessageMetadata,
  getMessageRaw,
  isGmailRateLimit,
  findGmailDraftIdForMessage,
  deleteGmailDraft,
  sendRawMessage,
  trashThread,
  untrashThread,
  type GmailMessage,
  type GmailThread,
} from "@/lib/gmail/api";
import {
  formatInviteChip,
  isCalendarAttachment,
  mimeTreeHasCalendar,
  parseCalendarInvite,
} from "@/lib/mail/ics";
import {
  filterAccountsForScope,
  type MailAccountScope,
} from "@/lib/mail/account-scope";
import { mailStore } from "@/lib/mail/store";
import { extractInlineImages } from "@/lib/mail/inline-images";
import { dedupeMessagesByRfcId } from "@/lib/mail/thread-copies";
import { replyAllRecipients, sentFromThisMailbox } from "@/lib/mail/reply-target";
import type { MailListSyncRow } from "@/lib/mail/store/types";
import { loadCrmContacts, resetCrmGate } from "@/lib/mail/crm-gate";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import {
  expandMailSearchQuery,
  parenthesizeSearchQuery,
} from "@/lib/mail/expand-search-query";
import {
  adoptSplitThread,
  getChatForThread,
  getChatsForThreads,
  noteChatMessageIds,
} from "@/lib/mail/chats";
import {
  archiveOutlookThread,
  fetchOutlookMailAttachment,
  fetchOutlookMessageSource,
  getOutlookMailThread,
  listOutlookAccountThreads,
  markOutlookThreadRead,
  markOutlookThreadUnread,
  outlookAccessTokenFor,
  draftOutlookMailMessage,
  sendOutlookMailMessage,
  listScheduledOutlookMessages,
  cancelScheduledOutlookMessage,
  sendScheduledOutlookMessageNow,
  trashOutlookThread,
  unarchiveOutlookThread,
  untrashOutlookThread,
} from "@/lib/mail/outlook-inbox";
import {
  deleteOutlookMessage,
  listConversationMessages,
  listOutlookDraftMessages,
  moveOutlookConversation,
} from "@/lib/outlook/api";
import {
  listConnectedMailAccounts,
  resolveMailProvider,
} from "@/lib/mail/providers";
import type {
  MailMessage,
  MailDraftRow,
  MailScheduledMessage,
  MailThreadDetail,
  MailThreadSummary,
} from "@/lib/mail/types";
import { isOwnOrgAddress, normalizeEmail } from "@/lib/own-addresses";
import type { ContactIndex, CrmRecordRef } from "@/lib/crm-contact-index";
import { senderNameFor } from "@/lib/mail/sender-identity";
import {
  type Classifier,
  classifyThread,
  crmLogoFor,
  crmNameFor,
  displayName,
  THREAD_AROUND_RADIUS,
  THREAD_PAGE_SIZE,
} from "@/lib/mail/thread-classify";
import {
  escapeHtml,
  signatureHtml,
  signaturePlainText,
} from "@/lib/mail/signature-html";
import { formatFromHeader } from "@/lib/mail/sender-name";
import { getMailSignatureSettings } from "@/lib/mail/settings";
import {
  invalidateInboxCache,
  registerInboxListCacheClear,
  registerMailFullCacheClear,
} from "@/lib/mail/inbox-cache";
import { PlanError } from "@/lib/plan/errors";
import {
  base64ToBytes,
  base64UrlToBytes,
  base64UrlToUtf8,
  utf8ToBase64,
  utf8ToBase64Url,
} from "@/lib/base64";

export { invalidateInboxCache, invalidateMailCaches } from "@/lib/mail/inbox-cache";

const CONCURRENCY = 8;
const PER_ACCOUNT_MESSAGES = 100;
// References and In-Reply-To ride along so a provider split can be adopted
// straight from the list — see docs/mail-chat-architecture.md.
const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "Message-ID",
  "References",
  "In-Reply-To",
  // How the list knows a thread carries a file. `format=metadata` answers
  // headers and no MIME tree, so the parts cannot be walked here — see
  // `gmailMessageHasFile`.
  "Content-Type",
];

/**
 * A message that carries a file somebody attached.
 *
 * The parts are read when they are there, which is exact. They are usually
 * not: the list asks Gmail for metadata, and that answers a payload with no
 * `parts` array. What it does answer is how the message was built, in both
 * `payload.mimeType` and the Content-Type header, so read that instead.
 *
 * `multipart/mixed` is an attachment beside the body; `multipart/related` is
 * a picture inside it, which a signature logo is; `multipart/alternative` is
 * the same body written twice.
 */
function gmailMessageHasFile(m: GmailMessage): boolean {
  const parts = extractAttachments(m, "");
  if (parts.length) return parts.some((a) => !isCalendarAttachment(a));
  const built = `${m.payload?.mimeType ?? ""} ${headerValue(m, "Content-Type")}`;
  return built.toLowerCase().includes("multipart/mixed");
}

/**
 * Stored list pages are rows we wrote, so a row written before a field
 * existed will never grow one — the page is reused whole while its snippet
 * is unchanged, and a thread nobody replies to is never rewritten.
 *
 * Bump this when a row gains a field the list draws, and the stored pages go
 * once. They are a cache: losing them costs one slow poll.
 */
const LIST_ROW_SHAPE = "3";
const LIST_ROW_SHAPE_KEY = "mail_list_row_shape";
let listShapeChecked = false;

async function dropListRowsFromAnOlderShape(): Promise<void> {
  if (listShapeChecked) return;
  listShapeChecked = true;
  try {
    const stored = await mailStore().settings.get(LIST_ROW_SHAPE_KEY);
    if (stored === LIST_ROW_SHAPE) return;
    await mailStore().listSync.clear();
    await mailStore().settings.set(LIST_ROW_SHAPE_KEY, LIST_ROW_SHAPE);
  } catch {
    // Best effort. A stale page is a missing clip, not a wrong inbox.
  }
}

/** Normalize RFC 822 Message-ID for snooze / cross-mailbox matching. */
function normalizeRfcMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/^<|>$/g, "");
}

export { accessTokenFor } from "@/lib/mail/mail-gmail-token";

/** Surfaces Gmail's 403 (old readonly token) as an actionable message. */
function translateGmailError(err: unknown, accountEmail: string): never {
  const status = (err as Error & { status?: number }).status;
  // Gmail says "over the limit" with a 403 as well, and reconnecting does
  // nothing for that. Said as what it is, so the reader waits instead.
  if (status === 403 && isGmailRateLimit(err)) {
    throw new PlanError(
      `Gmail is over its request limit for ${accountEmail}. Try again in a minute.`,
      429
    );
  }
  if (status === 403) {
    throw new PlanError(
      `The Gmail connection for ${accountEmail} is read-only — reconnect the account to enable sending and archiving.`,
      403
    );
  }
  throw err;
}

// ---------------------------------------------------------------------------
// People / everything-else classification (CRM contact matcher)
// ---------------------------------------------------------------------------

let classifierCache: { value: Classifier; expiresAt: number } | null = null;
/** How long a list waits for the CRM before filing by address books. */
const CRM_WAIT_MS = 8_000;
/** One in-flight build — parallel /threads?account=… must not stampede Postgres. */
let classifierInflight: Promise<Classifier> | null = null;

/**
 * The classifier is cached for the whole process, not per owner. On the planner
 * the CRM index is org-wide, so that is right. The public flavor reads one
 * user's address books, and that host has a single owner.
 */
async function getClassifier(ownerId: string): Promise<Classifier> {
  if (classifierCache && classifierCache.expiresAt > Date.now()) {
    return classifierCache.value;
  }
  if (classifierInflight) return classifierInflight;

  classifierInflight = (async () => {
    let contacts: ContactIndex;
    let domains: Map<string, CrmRecordRef[]>;
    // Without the CRM the list still reads; the People tab is only
    // thinner. Short-lived, so the next refresh asks the CRM again.
    let withoutCrm = false;
    const crm = await loadCrmContacts();
    if (crm) {
      try {
        // Not for long: a planner that hangs would hold every list behind
        // it. Past this the address books answer and the next refresh asks
        // again.
        contacts = await Promise.race([
          crm.buildContactIndex(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("the CRM did not answer in time")), CRM_WAIT_MS)
          ),
        ]);
        domains = await crm.buildContactDomainIndex();
      } catch (err) {
        // The planner did not answer: a session being renewed, or the
        // server away. That is not a mailbox that cannot be read, which
        // is what failing here told the reader. File by the address
        // books instead, and say so once in the console.
        console.warn("[mail] CRM not reachable; filing by address books:", err);
        const people = await import("@/lib/mail/people-contacts");
        contacts = await people.buildPeopleContactIndex(ownerId);
        domains = new Map();
        withoutCrm = true;
      }
    } else {
      // Public: People = address-book emails only (no CRM org-domain matching).
      const people = await import("@/lib/mail/people-contacts");
      contacts = await people.buildPeopleContactIndex(ownerId);
      domains = new Map();
    }
    const value = { contacts, domains };
    classifierCache = {
      value,
      expiresAt: Date.now() + (withoutCrm ? 20 * 1000 : 5 * 60 * 1000),
    };
    return value;
  })().finally(() => {
    classifierInflight = null;
  });

  return classifierInflight;
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index]);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Unified inbox listing
// ---------------------------------------------------------------------------

function messageDate(message: GmailMessage): number {
  const internal = Number(message.internalDate ?? 0);
  if (internal) return internal;
  const header = Date.parse(headerValue(message, "Date"));
  return Number.isFinite(header) ? header : 0;
}

/**
 * Invite detection is expensive (it probes full payloads of up to six
 * messages per meeting-looking thread), and a thread's invite status can
 * only change when a new message arrives — so memoize per latest message.
 */
const gmailCalendarCache = new Map<
  string,
  { hasCalendarInvite: boolean; calendarInviteWhen?: string }
>();
const GMAIL_CALENDAR_CACHE_MAX = 5000;

/** Build a list row from Gmail thread metadata (no bodies). */
/**
 * A page of a mailbox from the local copy, or null when the copy does not
 * serve this mailbox or this shape of request.
 *
 * The rows are the same MailThreadSummary the provider path builds, with
 * the same classifier, so everything downstream — dedupe across mailboxes,
 * snoozes, tabs, the People view — sees no difference.
 */
/**
 * A search in the provider's language rather than in words: operators,
 * OR, a minus, a quoted phrase. The copy's index reads every word as a
 * required prefix, so these go to the provider, which speaks them.
 */
async function listFromLocalStore(input: {
  accountEmail: string;
  folder: string;
  label?: string;
  q?: string;
  folderScoped: boolean;
  includeDeleted: boolean;
  pageToken?: string;
  classifier: Classifier;
}): Promise<{ summaries: SummaryEntry[]; nextPageToken?: string } | null> {
  const { accountEmail, classifier } = input;
  if (!(await localStoreServes(accountEmail))) return null;
  const store = mailStore().messages;
  if (input.q) {
    if (input.pageToken) return { summaries: [] };
    // A copy still filling answers too. The first read goes newest
    // first, so the part in hand is the part a search most often wants,
    // and the list says how much is read. Asking the provider meanwhile
    // was worse: each pause in typing was another search on the API,
    // and a few of those put the mailbox over its request limit.
    // Inside a folder when the reader asked for that; the folders the
    // copy does not hold fall back to the provider.
    let within: { view: MailStoredView; label?: string } | null = null;
    if (input.label) {
      within = { view: "label", label: input.label };
    } else if (input.folderScoped) {
      const view = viewForFolder(input.folder);
      if (!view) return null;
      within = { view };
    }
    const { threads, handled } = await store.search({
      accounts: [accountEmail],
      q: input.q,
      limit: PER_ACCOUNT_MESSAGES,
      includeDeleted: input.includeDeleted,
      ...(within ?? {}),
    });
    // The copy reads the words Gmail reads — from:, has:attachment,
    // before:, quotes, OR — and says when a query asks something only the
    // provider knows, such as in: or is:unread. That one goes out.
    if (handled === false) return null;
    return { summaries: threads.map((t) => summaryFromStored(t, classifier)) };
  }
  const view: MailStoredView | null = input.label ? "label" : viewForFolder(input.folder);
  if (!view) return null;
  if (view === "trash" && !(await localStoreServesFolder(accountEmail, "trash"))) return null;
  if (view === "junk" && !(await localStoreServesFolder(accountEmail, "spam"))) return null;
  const before = input.pageToken ? Number(input.pageToken) : null;
  const page = await store.list({
    accounts: [accountEmail],
    view,
    label: input.label,
    before: Number.isFinite(before) ? before : null,
    limit: PER_ACCOUNT_MESSAGES,
  });
  return {
    summaries: page.threads.map((t) => summaryFromStored(t, classifier)),
    nextPageToken: page.nextBefore != null ? String(page.nextBefore) : undefined,
  };
}

/** The copy's view for a folder, or null for one it has no view of. */
function viewForFolder(folder: string): MailStoredView | null {
  switch (folder) {
    case "inbox":
      return "inbox";
    case "sent":
      return "sent";
    case "archived":
      return "archived";
    case "trash":
      return "trash";
    case "junk":
      return "junk";
    default:
      return null;
  }
}

type SummaryEntry = {
  summary: MailThreadSummary;
  latestRfcId: string;
  latestReferences?: string;
};

function summaryFromStored(t: MailStoredThread, classifier: Classifier): SummaryEntry {
  const { tab, counterpart, externalParticipants } = classifyThread({
    accountEmail: t.account,
    participants: t.participants,
    senders: t.senders,
    latestFrom: { name: t.latest.fromName, email: t.latest.fromEmail },
    latestTo: t.latest.to,
    classifier,
  });
  return {
    summary: {
      account: t.account,
      threadId: t.threadId,
      subject: t.subject.trim() || "(no subject)",
      fromName: displayName(counterpart),
      fromEmail: counterpart.email,
      snippet: t.latest.snippet,
      lastAt: new Date(t.lastAt).toISOString(),
      unread: t.unread,
      messageCount: t.messageCount,
      tab,
      externalParticipants,
      crmName: crmNameFor(counterpart.email, classifier),
      crmLogoUrl: crmLogoFor(counterpart.email, classifier),
      ...(t.focusMessageId ? { focusMessageId: t.focusMessageId } : null),
      ...(t.hasAttachments ? { hasAttachments: true } : null),
    },
    latestRfcId: (t.latest.rfcMessageId ?? "").trim(),
    latestReferences:
      [t.latest.references ?? "", t.latest.inReplyTo ?? ""].join(" ").trim() || undefined,
  };
}

async function summarizeGmailThread(options: {
  token: string;
  accountEmail: string;
  thread: GmailThread;
  classifier: Classifier;
  focusMessageId?: string;
  resolveCalendar?: boolean;
  /** Set on a row of the Snoozed list. */
  snoozedUntil?: string;
}): Promise<{
  summary: MailThreadSummary;
  latestRfcId: string;
  latestReferences?: string;
} | null> {
  const { token, accountEmail, thread, classifier, focusMessageId } = options;
  const threadMessages = [...(thread.messages ?? [])];
  if (threadMessages.length === 0) return null;

  threadMessages.sort((a, b) => messageDate(a) - messageDate(b));
  const latest = threadMessages[threadMessages.length - 1];

  const { tab, counterpart, externalParticipants } = classifyThread({
    accountEmail,
    participants: threadMessages.flatMap((m) => [
      ...parseAddressList(headerValue(m, "From")),
      ...parseAddressList(headerValue(m, "To")),
      ...parseAddressList(headerValue(m, "Cc")),
    ]),
    senders: threadMessages.flatMap((m) =>
      parseAddressList(headerValue(m, "From")).slice(0, 1)
    ),
    latestFrom: parseAddressList(headerValue(latest, "From"))[0],
    latestTo: parseAddressList(headerValue(latest, "To")),
    classifier,
  });

  const subject = headerValue(latest, "Subject").trim() || "(no subject)";
  const snippet = decodeSnippet(latest.snippet ?? "");
  const calKey = `${accountEmail}|${thread.id}|${latest.id}`;
  let cal =
    options.resolveCalendar === false
      ? { hasCalendarInvite: false as const }
      : gmailCalendarCache.get(calKey);
  if (!cal) {
    cal = await resolveGmailCalendarInvite(
      token,
      threadMessages,
      latest,
      subject,
      snippet
    );
    if (gmailCalendarCache.size >= GMAIL_CALENDAR_CACHE_MAX) {
      const oldest = gmailCalendarCache.keys().next().value;
      if (oldest != null) gmailCalendarCache.delete(oldest);
    }
    gmailCalendarCache.set(calKey, cal);
  }

  return {
    summary: {
      account: accountEmail,
      threadId: thread.id,
      subject,
      fromName: displayName(counterpart),
      fromEmail: counterpart.email,
      snippet,
      lastAt: new Date(messageDate(latest)).toISOString(),
      unread: threadMessages.some((m) =>
        (m.labelIds ?? []).includes("UNREAD")
      ),
      messageCount: threadMessages.length,
      tab,
      externalParticipants,
      crmName: crmNameFor(counterpart.email, classifier),
      crmLogoUrl: crmLogoFor(counterpart.email, classifier),
      ...(focusMessageId ? { focusMessageId } : null),
      ...(options.snoozedUntil ? { snoozedUntil: options.snoozedUntil } : null),
      // A file somebody attached, not a logo in a signature. Reading the
      // parts costs nothing here: the metadata is already in hand.
      ...(threadMessages.some(gmailMessageHasFile)
        ? { hasAttachments: true }
        : null),
      ...(cal.hasCalendarInvite
        ? {
            hasCalendarInvite: true,
            ...(cal.calendarInviteWhen
              ? { calendarInviteWhen: cal.calendarInviteWhen }
              : null),
          }
        : null),
    },
    latestRfcId: headerValue(latest, "Message-ID").trim(),
    latestReferences:
      [headerValue(latest, "References"), headerValue(latest, "In-Reply-To")]
        .join(" ")
        .trim() || undefined,
  };
}

function gmailMessageLooksLikeInvite(
  subject: string,
  snippet: string
): boolean {
  return /invite|attend|rsvp|teams meeting|zoom\.|meet\.google|icalendar|\.ics|calendar|meeting request/i.test(
    `${subject}\n${snippet}`
  );
}

function gmailHasCalendarPart(m: GmailMessage): boolean {
  if (mimeTreeHasCalendar(m.payload)) return true;
  if (extractAttachments(m, "").some(isCalendarAttachment)) return true;
  return headerValue(m, "Content-Type").toLowerCase().includes("text/calendar");
}

/** Detect .ics / meeting parts and parse a short when-label for the list chip. */
async function resolveGmailCalendarInvite(
  token: string,
  threadMessages: GmailMessage[],
  _latest: GmailMessage,
  _subject: string,
  _snippet: string
): Promise<{ hasCalendarInvite: boolean; calendarInviteWhen?: string }> {
  const calendarAtt = (m: GmailMessage) =>
    extractAttachments(m, "").find(isCalendarAttachment);

  let host =
    threadMessages.find((m) => gmailHasCalendarPart(m)) ?? null;

  // Metadata often omits nested MIME parts. Invites usually sit on an older
  // message while the list tip is a later reply — so scan oldest-first with
  // full payloads when the thread looks meeting-related (or is short).
  if (!host) {
    const looksMeeting =
      threadMessages.length <= 4 ||
      threadMessages.some((m) =>
        gmailMessageLooksLikeInvite(
          headerValue(m, "Subject"),
          m.snippet ?? ""
        )
      );
    if (looksMeeting) {
      for (const m of threadMessages.slice(0, 6)) {
        if (gmailHasCalendarPart(m)) {
          host = m;
          break;
        }
        const full = await getMessageFull(token, m.id).catch(() => null);
        if (full && gmailHasCalendarPart(full)) {
          host = full;
          break;
        }
      }
    }
  }

  if (!host) return { hasCalendarInvite: false };

  const att = calendarAtt(host);
  if (!att) return { hasCalendarInvite: true };

  try {
    const { data } = await getGmailAttachment(
      token,
      host.id,
      att.attachmentId
    );
    const text = base64UrlToUtf8(data);
    const parsed = parseCalendarInvite(text);
    const when = parsed ? formatInviteChip(parsed) : null;
    return {
      hasCalendarInvite: true,
      ...(when ? { calendarInviteWhen: when } : null),
    };
  } catch {
    return { hasCalendarInvite: true };
  }
}

type InboxCacheEntry = {
  value: { threads: MailThreadSummary[]; nextCursor: string | null };
  expiresAt: number;
};
const inboxCache = new Map<string, InboxCacheEntry>();

/** Prior Gmail first-page rows for list-diff polls (survives fresh=1). */
type GmailPriorRow = {
  /** Decoded snippet from the last threads.list response. */
  listSnippet: string;
  summary: MailThreadSummary;
  latestRfcId: string;
  latestReferences?: string;
};
type GmailPriorPage = Map<string, Map<string, GmailPriorRow>>; // account → threadId → row
const gmailPriorPages = new Map<string, GmailPriorPage>();


/**
 * State each prior first page was built at (cacheKey → account): the history
 * position lets the next incremental poll ask Gmail's history API "what
 * changed since?" instead of re-listing and diffing snippets, and the page
 * token re-emits the load-more cursor when the page is served unchanged.
 */
type GmailPriorPageState = { historyId: string; nextPageToken?: string };
const gmailPriorHistoryIds = new Map<string, Map<string, GmailPriorPageState>>();

/** Later of two numeric-string Gmail history ids (avoids BigInt). */
function newerHistoryId(
  a: string | null,
  b: string | null | undefined
): string | null {
  if (!b || !/^\d+$/.test(b)) return a;
  if (!a) return b;
  if (b.length !== a.length) return b.length > a.length ? b : a;
  return b > a ? b : a;
}

registerInboxListCacheClear(() => {
  inboxCache.clear();
});
registerMailFullCacheClear(() => {
  gmailPriorPages.clear();
  gmailPriorHistoryIds.clear();
  void mailStore().listSync.clear();
  classifierCache = null;
  classifierInflight = null;
  resetCrmGate();
});

/** The stored views a thread leaves when it leaves the inbox. */
const INBOX_LIKE_FOLDERS = ["inbox"] as const;

/**
 * Take a thread out of the page we stored, not only out of the caches.
 *
 * Archiving cleared the thirty-second memo and nothing else, so the row
 * survived in `gmailPriorPages` and in `list_sync_state`. That would be
 * harmless if every list came from a fresh listing, but the incremental path
 * has a branch that serves the stored page verbatim when Gmail's history
 * reports nothing changed — and that branch never asks Gmail what is in the
 * inbox. So an archived thread could come back on the next Sync, from our own
 * copy of a list that was already out of date.
 *
 * The history delta is not something to lean on here either: Gmail keeps
 * about a week of it, answers `incomplete` on a long gap, and 404s on an
 * expired id. Any of those leaves the delta empty while the stale row is
 * still stored.
 *
 * Best effort on purpose. Failing to tidy a cache must never fail the archive
 * that the provider has already accepted — and it is only called once the
 * provider has accepted it. A thread the provider refused to archive is still
 * in the inbox, and taking its row out here would hide a thread that is
 * really there, which is the worse of the two mistakes.
 */
export async function forgetThreadInStoredPages(
  clerkUserId: string,
  account: string,
  threadId: string
): Promise<void> {
  // In memory, from every view. A row taken out of a page it should not have
  // left costs one metadata fetch to put back; a row left in a page it should
  // have left is the bug this exists for.
  for (const byAccount of gmailPriorPages.values()) {
    byAccount.get(account)?.delete(threadId);
  }

  try {
    for (const folder of INBOX_LIKE_FOLDERS) {
      const stored = await mailStore().listSync.load(clerkUserId, folder, [
        account,
      ]);
      const entry = stored.get(account);
      if (!entry) continue;
      const rows = entry.rows.filter((row) => row.threadId !== threadId);
      if (rows.length === entry.rows.length) continue;
      await mailStore().listSync.save(clerkUserId, folder, account, {
        rows,
        historyId: entry.historyId,
        nextPageToken: entry.nextPageToken,
      });
    }
  } catch (err) {
    console.warn("[mail] could not drop the stored list row:", err);
  }
}

/** Opaque multi-account Gmail list cursor (base64url JSON of email → pageToken). */
export function encodeMailListCursor(
  tokens: Record<string, string>
): string | null {
  const cleaned: Record<string, string> = {};
  for (const [email, token] of Object.entries(tokens)) {
    if (email && token) cleaned[email] = token;
  }
  if (Object.keys(cleaned).length === 0) return null;
  return utf8ToBase64Url(JSON.stringify(cleaned));
}

export function decodeMailListCursor(
  cursor: string | undefined | null
): Record<string, string> | null {
  if (!cursor?.trim()) return null;
  try {
    const parsed = JSON.parse(
      base64UrlToUtf8(cursor)
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, string> = {};
    for (const [email, token] of Object.entries(
      parsed as Record<string, unknown>
    )) {
      if (typeof email === "string" && typeof token === "string" && token) {
        out[email] = token;
      }
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export async function listUnifiedInbox(options: {
  /** Skip the server-side cache (manual refresh). */
  fresh?: boolean;
  /**
   * Cheap Gmail poll: list ids+snippets and reuse prior metadata when the
   * list snippet is unchanged (read-state drift is reconciled via an extra
   * ids-only unread listing). Ignored for search, labels, and load-more.
   * The periodic full reconcile poll should omit this.
   */
  incremental?: boolean;
  /** Restrict to one account email, or undefined for all. */
  account?: string;
  /** Gmail search terms appended to the folder query. */
  q?: string;
  /** Which Gmail view to list; defaults to the inbox. */
  folder?: "inbox" | "sent" | "trash" | "junk" | "archived";
  /**
   * User “folder” (Gmail label). When set, lists that label instead of
   * inbox/sent; search stays scoped inside the folder.
   */
  label?: string;
  /**
   * When searching (`q` set) without a label, keep the inbox/sent folder
   * constraint instead of searching all mail. Used for “Current folder”.
   */
  folderScoped?: boolean;
  /**
   * Which mailboxes belong in this inbox. Native shells pass "personal"
   * (dh Mail) or "planner"; the browser keeps the unified "all" view.
   */
  scope?: MailAccountScope;
  /** Local owner of the Mail view — required for per-user mailboxes. */
  clerkUserId: string;
  /** Let a search reach Trash and Junk as well. Ignored while browsing. */
  includeDeleted?: boolean;
  /**
   * Continue a previous list page. Opaque cursor from `nextCursor`; when set,
   * only accounts with remaining pages are fetched (no full re-list).
   */
  cursor?: string | null;
}): Promise<{
  accounts: string[];
  threads: MailThreadSummary[];
  /** Pass back as `cursor` to hydrate the next page only. Null = end. */
  nextCursor: string | null;
}> {
  // Before anything reads the stored rows. The first list after a reload is
  // not an incremental poll, so a check further down would let the old rows
  // hydrate the page and never be dropped.
  await dropListRowsFromAnOlderShape();

  const scope = options.scope ?? "all";
  // Browse stays shell-scoped (planner vs personal). Search uses every
  // in-tab mailbox so "Search all mail" can find personal threads from
  // the planner shell (and vice versa) — matches the search-box copy.
  const hasSearchQuery = Boolean(options.q?.trim());
  const allAccounts = filterAccountsForScope(
    await listConnectedMailAccounts(options.clerkUserId),
    hasSearchQuery ? "all" : scope
  );
  const accountEmails = allAccounts
    .map((a) => a.email)
    .filter((email) => !options.account || email === options.account);
  const providerByEmail = new Map(
    allAccounts.map((a) => [a.email, a.provider] as const)
  );

  const folder = options.folder ?? "inbox";
  const label = options.label?.trim() || "";
  const pageTokens = decodeMailListCursor(options.cursor);
  const isContinuation = pageTokens != null;
  // Include clerkUserId so two admins who share mailboxes never reuse each
  // other's first-page / prior-history state on the same Node process.
  const cacheKey = `${options.clerkUserId}|${label ? `label:${label}` : folder}|${accountEmails.join(",")}|${options.q ?? ""}`;
  // Only the first page is cached; later pages are fetched on demand.
  const cached =
    options.fresh || isContinuation ? undefined : inboxCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      accounts: allAccounts.map((a) => a.email),
      threads: cached.value.threads,
      nextCursor: cached.value.nextCursor,
    };
  }

  const classifier = await getClassifier(options.clerkUserId);
  // Gmail keeps Spam and Trash out of threads.list unless asked, whatever
  // the query says — an empty list rather than an error.
  // Browsing Trash or Junk is asking for them. A search is not, unless the
  // reader says so: a query that quietly returned deleted mail would put
  // threads in the results that they had already decided against.
  // Read from the option rather than `rawQ`, which is built further down.
  const includeSpamTrash =
    folder === "trash" ||
    folder === "junk" ||
    (Boolean(options.q?.trim()) && Boolean(options.includeDeleted));
  const folderQuery = label
    ? gmailLabelSearchQuery(label)
    : // Archived is Gmail's own definition of it: a conversation is
      // archived by taking the inbox label off it, so archived is
      // everything without that label. Sent and drafts are taken back out —
      // they are not in the inbox either, and nobody looking for what they
      // filed away means the mail they wrote. Spam and Bin are already out,
      // because a bare Gmail search does not reach them.
      folder === "archived"
      ? "-in:inbox -in:sent -in:draft"
      : folder === "sent"
        ? "in:sent"
      // Trash is the one place a bare search will not reach, which is why it
      // has to be asked for by name. See the note below.
      : folder === "trash"
        ? "in:trash"
        : folder === "junk"
          ? "in:spam"
          : "in:inbox";
  // Folder view: search stays inside the label. Inbox/sent browse without a
  // query stays scoped; a bare search covers all mail (excl. spam/trash) so
  // archived threads stay findable. `folderScoped` keeps inbox/sent when the
  // UI asks for “Current folder” search.
  // Expand single-word stems (øjenhospital → … OR øjenhospitalet) so Gmail's
  // whole-token matching behaves closer to Outlook.
  const rawQ = options.q?.trim() ?? "";
  const q = rawQ ? expandMailSearchQuery(rawQ) : "";
  const qForFolder = q ? parenthesizeSearchQuery(q) : "";
  const query = label
    ? qForFolder
      ? `${folderQuery} ${qForFolder}`
      : folderQuery
    : qForFolder
      ? options.folderScoped
        ? `${folderQuery} ${qForFolder}`
        : qForFolder
      : folderQuery;

  // First page: every account. Load-more: only accounts that still have a token.
  const fetchEmails = isContinuation
    ? accountEmails.filter((email) => pageTokens[email])
    : accountEmails;

  // Cheap Gmail polls: list + reuse metadata when snippets match. Not for
  // search, label folders, or pagination (those need a full rebuild).
  const useGmailIncremental = Boolean(
    options.incremental &&
      !isContinuation &&
      !q &&
      !label
  );

  /**
   * Prior pages live in RAM for speed, but Amplify SSR runs many short-lived
   * Node processes. A process that starts cold would otherwise re-list and
   * metadata-fetch every thread in the page, so hydrate the maps from Postgres
   * first and let the normal history-delta path take over.
   */
  if (useGmailIncremental && !gmailPriorPages.get(cacheKey)?.size) {
    const stored = await mailStore().listSync.load(
      options.clerkUserId,
      folder,
      fetchEmails
    );
    if (stored.size) {
      const prior: GmailPriorPage = gmailPriorPages.get(cacheKey) ?? new Map();
      const states =
        gmailPriorHistoryIds.get(cacheKey) ??
        new Map<string, GmailPriorPageState>();
      for (const [email, entry] of stored) {
        const byThread = new Map<string, GmailPriorRow>();
        for (const row of entry.rows) {
          byThread.set(row.threadId, {
            listSnippet: row.listSnippet,
            summary: row.summary,
            latestRfcId: row.latestRfcId,
            latestReferences: row.latestReferences,
          });
        }
        if (!byThread.size) continue;
        prior.set(email, byThread);
        // Without a history id the rows still serve the cheaper snippet diff.
        if (entry.historyId) {
          states.set(email, {
            historyId: entry.historyId,
            nextPageToken: entry.nextPageToken ?? undefined,
          });
        }
      }
      if (prior.size) gmailPriorPages.set(cacheKey, prior);
      if (states.size) gmailPriorHistoryIds.set(cacheKey, states);
    }
  }

  /*
   * Active snoozes hide their threads — at the end of the fetch, not the
   * start. Snoozed rows travel the whole way and are held back only at the
   * final filter, where their current tip is known. That is what lets a
   * new reply wake a snooze (the tip is no longer the one that was put to
   * sleep), and it keeps the rows in the stored incremental pages — so a
   * wake needs no cache to expire: the next poll replays the page, and the
   * filter simply stops holding the thread back.
   *
   * The map remembers each snooze's stored tip; the set hides sibling
   * copies of the same thread in other mailboxes, matched after dedupe.
   */
  const snoozed = await mailStore().snoozes.listActive();
  const snoozedByKey = new Map<string, string | null>();
  /** When each snooze wakes, by thread and by tip: a search shows it. */
  const wakeByKey = new Map<string, string>();
  const wakeByTip = new Map<string, string>();
  for (const r of snoozed) {
    const tip = normalizeRfcMessageId(r.tipMessageId);
    snoozedByKey.set(`${r.accountEmail}|${r.threadId}`, tip);
    wakeByKey.set(`${r.accountEmail}|${r.threadId}`, r.snoozedUntil);
    if (tip) wakeByTip.set(tip, r.snoozedUntil);
  }
  const snoozedTipIds = new Set(wakeByTip.keys());

  const nextTokens: Record<string, string> = {};
  const summaries: {
    summary: MailThreadSummary;
    latestRfcId: string;
    latestReferences?: string;
  }[] = [];
  /** Per-account list snippets from this fetch (feeds gmailPriorPages). */
  const gmailListSnippetsByAccount = new Map<string, Map<string, string>>();
  /** First-page state per account from this fetch (feeds delta polls). */
  const pageStateByAccount = new Map<string, GmailPriorPageState>();
  // Per-account failures are swallowed so one dead mailbox doesn't blank the
  // whole inbox — but if every account fails we must not return threads:[]
  // (clients cache that as “inbox zero”).
  let accountFetchAttempts = 0;
  let accountFetchFailures = 0;
  /** What the first mailbox that failed said, so the reader is told why. */
  let firstFetchFailure = "";

  await Promise.all(
    fetchEmails.map(async (accountEmail) => {
      const provider = providerByEmail.get(accountEmail) ?? "gmail";
      accountFetchAttempts += 1;
      try {
        if (provider === "outlook") {
          const result = await listOutlookAccountThreads({
            accountEmail,
            folder,
            q,
            label: label || undefined,
            pageToken: pageTokens?.[accountEmail],
            maxConversations: PER_ACCOUNT_MESSAGES,
            classifier,
          });
          if (result.nextPageToken) {
            nextTokens[accountEmail] = result.nextPageToken;
          }
          summaries.push(...result.summaries);
          return;
        }

        // The local copy first, when it has this mailbox. A folder-scoped
        // search is the one shape it does not answer; that still goes out.
        const stored = await listFromLocalStore({
          accountEmail,
          folder,
          label: label || undefined,
          // The words as typed. `q` is Gmail's shape — one word grown into
          // "word OR words OR worded" — and the copy's index reads every
          // word as required, so the grown form found nothing.
          q: rawQ || undefined,
          folderScoped: Boolean(options.folderScoped),
          includeDeleted: Boolean(options.includeDeleted),
          pageToken: pageTokens?.[accountEmail],
          classifier,
        });
        if (stored) {
          if (stored.nextPageToken) nextTokens[accountEmail] = stored.nextPageToken;
          summaries.push(...stored.summaries);
          return;
        }

        // Gmail: list threads so sent replies update the latest snippet/date.
        // Search uses the messages list so we can deep-link to the hit.
        const token = await accessTokenFor(accountEmail);
        const priorForAccount = useGmailIncremental
          ? gmailPriorPages.get(cacheKey)?.get(accountEmail)
          : undefined;

        // Gmail history delta — the official incremental sync. One cheap call
        // answers "did anything change since the prior page was built?".
        // Unchanged → serve the prior page with no further API calls; changed
        // → list for order + metadata-fetch only dirty/new ids. Expired (404),
        // failed, or too-long histories fall back to the snippet diff below.
        let dirtyIds: Set<string> | null = null;
        let deltaHistoryId: string | null = null;
        const storedState = priorForAccount?.size
          ? gmailPriorHistoryIds.get(cacheKey)?.get(accountEmail)
          : undefined;
        if (storedState) {
          try {
            const delta = await listGmailHistory(token, storedState.historyId);
            if (!delta.incomplete) {
              dirtyIds = delta.changedThreadIds;
              deltaHistoryId = delta.historyId;
            }
          } catch {
            /* expired or transient — take the snippet-diff path */
          }
        }

        if (dirtyIds?.size === 0 && priorForAccount?.size) {
          // Nothing changed — the prior page is authoritative as-is.
          const listSnippetById = new Map<string, string>();
          for (const [threadId, row] of priorForAccount) {
            listSnippetById.set(threadId, row.listSnippet);
            const { chat: _chat, ...rest } = row.summary;
            summaries.push({ summary: rest, latestRfcId: row.latestRfcId });
          }
          if (storedState?.nextPageToken) {
            nextTokens[accountEmail] = storedState.nextPageToken;
          }
          gmailListSnippetsByAccount.set(accountEmail, listSnippetById);
          if (deltaHistoryId) {
            pageStateByAccount.set(accountEmail, {
              historyId: deltaHistoryId,
              nextPageToken: storedState?.nextPageToken,
            });
          }
          return;
        }

        // History named the dirty set: reorder via a cheap threads.list, but
        // metadata-fetch only dirty / brand-new ids (not the whole first page).
        if (dirtyIds && dirtyIds.size > 0 && priorForAccount?.size && !q) {
          const page = await listRecentThreads(
            token,
            query,
            PER_ACCOUNT_MESSAGES,
            pageTokens?.[accountEmail],
            { includeSpamTrash }
          );
          if (page.nextPageToken) {
            nextTokens[accountEmail] = page.nextPageToken;
          }
          const listed = page.threads;
          const listSnippetById = new Map<string, string>();
          const idsToFetch: string[] = [];

          for (const item of listed) {
            const listSnippet = decodeSnippet(item.snippet);
            listSnippetById.set(item.id, listSnippet);
            const prior = priorForAccount.get(item.id);
            if (!prior || dirtyIds.has(item.id)) {
              idsToFetch.push(item.id);
            }
          }

          const fetchedById = new Map<
            string,
            {
              summary: MailThreadSummary;
              latestRfcId: string;
              latestReferences?: string;
            }
          >();
          if (idsToFetch.length) {
            const threads = await mapWithConcurrency(idsToFetch, (id) =>
              getThreadMetadata(token, id, METADATA_HEADERS)
            );
            for (const thread of threads) {
              if (!thread?.id) continue;
              const entry = await summarizeGmailThread({
                token,
                accountEmail,
                thread,
                classifier,
              });
              if (entry) fetchedById.set(thread.id, entry);
            }
          }

          // Emit in list order so the first page stays newest-first.
          for (const item of listed) {
            const fetched = fetchedById.get(item.id);
            if (fetched) {
              summaries.push(fetched);
              continue;
            }
            const prior = priorForAccount.get(item.id);
            if (prior && !dirtyIds.has(item.id)) {
              const { chat: _chat, ...rest } = prior.summary;
              summaries.push({
                summary: rest,
                latestRfcId: prior.latestRfcId,
                latestReferences: prior.latestReferences,
              });
            }
          }

          gmailListSnippetsByAccount.set(accountEmail, listSnippetById);
          let pageHistoryId = deltaHistoryId;
          for (const item of listed) {
            pageHistoryId = newerHistoryId(pageHistoryId, item.historyId);
          }
          if (pageHistoryId) {
            pageStateByAccount.set(accountEmail, {
              historyId: pageHistoryId,
              nextPageToken: nextTokens[accountEmail],
            });
          }
          return;
        }

        // History unavailable: reused rows can't see read-state changes (they
        // don't alter list snippets), so reconcile unread via a cheap
        // ids-only unread listing, fetched alongside the main list.
        const unreadIdsPromise =
          priorForAccount?.size && dirtyIds == null
            ? listRecentThreads(
                token,
                `${query} is:unread`,
                PER_ACCOUNT_MESSAGES,
                undefined,
                { includeSpamTrash }
              )
                .then((p) => new Set(p.threads.map((t) => t.id)))
                .catch(() => null)
            : Promise.resolve(null);
        const focusByThread = new Map<string, string>();
        let listed: { id: string; snippet: string; historyId?: string }[] =
          [];

        if (q) {
          const page = await listRecentMessages(
            token,
            query,
            PER_ACCOUNT_MESSAGES,
            pageTokens?.[accountEmail]
          );
          if (page.nextPageToken) {
            nextTokens[accountEmail] = page.nextPageToken;
          }
          for (const m of page.messages) {
            if (focusByThread.has(m.threadId)) continue;
            focusByThread.set(m.threadId, m.id);
            listed.push({ id: m.threadId, snippet: "" });
          }
        } else {
          const page = await listRecentThreads(
            token,
            query,
            PER_ACCOUNT_MESSAGES,
            pageTokens?.[accountEmail],
            { includeSpamTrash }
          );
          if (page.nextPageToken) {
            nextTokens[accountEmail] = page.nextPageToken;
          }
          listed = page.threads;
        }

        // Incremental list-diff: reuse prior metadata when the list snippet
        // is unchanged. Search / labels / load-more always take the full path.
        const unreadIds = await unreadIdsPromise;
        const idsToFetch: string[] = [];
        /** list snippet per thread id (for prior-page cache after build). */
        const listSnippetById = new Map<string, string>();

        for (const item of listed) {
          const listSnippet = decodeSnippet(item.snippet);
          listSnippetById.set(item.id, listSnippet);
          const prior = priorForAccount?.get(item.id);
          if (prior && prior.listSnippet === listSnippet) {
            const { chat: _chat, ...rest } = prior.summary;
            if (unreadIds) rest.unread = unreadIds.has(item.id);
            summaries.push({
              summary: rest,
              latestRfcId: prior.latestRfcId,
              latestReferences: prior.latestReferences,
            });
          } else {
            idsToFetch.push(item.id);
          }
        }

        if (idsToFetch.length) {
          const threads = await mapWithConcurrency(idsToFetch, (id) =>
            getThreadMetadata(token, id, METADATA_HEADERS)
          );
          for (const thread of threads) {
            if (!thread?.id) continue;
            const entry = await summarizeGmailThread({
              token,
              accountEmail,
              thread,
              classifier,
              focusMessageId: focusByThread.get(thread.id),
            });
            if (entry) summaries.push(entry);
          }
        }

        // Remember list snippets on this account's rows for the next cheap poll.
        gmailListSnippetsByAccount.set(accountEmail, listSnippetById);
        // Snapshot the history position for the next delta poll (page max —
        // replaying a change twice is harmless, so a floor is fine).
        let pageHistoryId = deltaHistoryId;
        for (const item of listed) {
          pageHistoryId = newerHistoryId(pageHistoryId, item.historyId);
        }
        if (pageHistoryId) {
          pageStateByAccount.set(accountEmail, {
            historyId: pageHistoryId,
            nextPageToken: nextTokens[accountEmail],
          });
        }
      } catch (err) {
        accountFetchFailures += 1;
        // Auth failures already log a one-liner in accessTokenFor — no stack dump.
        const msg = err instanceof Error ? err.message : String(err);
        if (!firstFetchFailure) firstFetchFailure = msg;
        if (!/needs reconnect|invalid_grant/i.test(msg)) {
          console.warn(`[mail] inbox fetch failed for ${accountEmail}: ${msg}`);
        }
      }
    })
  );

  if (
    accountFetchAttempts > 0 &&
    accountFetchFailures === accountFetchAttempts
  ) {
    // With the reason: "from any connected account" on its own told the
    // reader nothing, and the line at the top of the list repeats this.
    throw new PlanError(
      firstFetchFailure
        ? `Couldn't load inbox: ${firstFetchFailure}`
        : "Couldn't load inbox from any connected account",
      502
    );
  }

  // The same conversation often lands in several of our mailboxes (cc'd
  // copies); keep one row per conversation, identified by the newest
  // message's RFC 822 id. Any copy being unread keeps the row unread.
  // Hold back snoozed rows — or wake them, when the thread has moved on.
  summaries.sort(
    (a, b) => Date.parse(b.summary.lastAt) - Date.parse(a.summary.lastAt)
  );
  const seen = new Map<string, MailThreadSummary>();
  const deduped: MailThreadSummary[] = [];
  /** Snoozes ended early by a new reply; removed from the store below. */
  const wokenByReply = new Set<string>();
  /** References of each row's newest message, for split adoption below. */
  const adoptHints = new Map<string, string>();
  for (const { summary, latestRfcId, latestReferences } of summaries) {
    const tipKey = normalizeRfcMessageId(latestRfcId);
    const snoozeKey = `${summary.account}|${summary.threadId}`;
    const storedTip = snoozedByKey.get(snoozeKey);
    if (snoozedByKey.has(snoozeKey)) {
      /*
       * A new reply wakes the thread: its tip is no longer the message
       * that was put to sleep. Waiting quietly through "urgent, call me
       * now" is not what anybody meant by snooze — and Gmail and Outlook
       * both wake on reply, so this is also what the same gesture does
       * everywhere else. A snooze whose tip was never learned cannot
       * tell a reply from silence, so it sleeps to its timer.
       */
      if (storedTip && tipKey && tipKey !== storedTip) {
        wokenByReply.add(snoozeKey);
      } else if (hasSearchQuery) {
        // A search finds what is asleep too — the booking put off until
        // Friday is still the booking being looked for — and the row
        // says when it wakes, so it is not taken for an inbox row.
        summary.snoozedUntil = wakeByKey.get(snoozeKey);
      } else {
        continue;
      }
    } else if (tipKey && snoozedTipIds.has(tipKey)) {
      // A copy of a snoozed thread in another mailbox, still on the tip
      // that was put to sleep — it sleeps with it.
      if (!hasSearchQuery) continue;
      summary.snoozedUntil = wakeByTip.get(tipKey);
    }
    if (tipKey) summary.tipId = tipKey;
    const key = latestRfcId || `${summary.account}|${summary.threadId}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, summary);
      deduped.push(summary);
      if (latestReferences) {
        adoptHints.set(
          `${summary.account}|${summary.threadId}`,
          latestReferences
        );
      }
    } else {
      if (summary.unread) existing.unread = true;
      if (summary.hasCalendarInvite) existing.hasCalendarInvite = true;
      if (summary.hasAttachments) existing.hasAttachments = true;
      if (summary.calendarInviteWhen && !existing.calendarInviteWhen) {
        existing.calendarInviteWhen = summary.calendarInviteWhen;
      }
    }
  }
  // The store hears about the wakes, so the Snoozed tab and the next
  // fetch agree with what this one just showed.
  if (wokenByReply.size) {
    await Promise.all(
      [...wokenByReply].map((key) => {
        const sep = key.indexOf("|");
        return mailStore()
          .snoozes.remove(key.slice(0, sep), key.slice(sep + 1))
          .catch(() => {});
      })
    );
  }

  // Dedupe keeps insertion order, but re-sort so the list is always
  // newest-first (important for search, where Gmail's hit order is relevance).
  deduped.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));

  const chatByThread = await getChatsForThreads(
    deduped.map((t) => ({ account: t.account, threadId: t.threadId }))
  );
  for (const t of deduped) {
    const chat = chatByThread.get(`${t.account}|${t.threadId}`);
    if (chat) t.chat = chat;
  }

  // A provider split arrives as a new, unbound thread. Adopt it into its
  // conversation here in the list, so it never presents as a stranger. Only
  // the plain inbox: Sent, Trash and search answer different questions.
  // Capped, because splits are rare and the next refresh catches stragglers.
  // `folder` always holds a view name — it defaults to "inbox" above — so
  // the test is for that name. `!folder` was never true, and this ran for
  // nobody between August 13 and the day that was noticed.
  if (!q && !label && folder === "inbox") {
    let attempts = 0;
    for (const t of deduped) {
      if (attempts >= 8) break;
      if (t.chat) continue;
      const refs = adoptHints.get(`${t.account}|${t.threadId}`);
      const referencedIds = refs?.match(/<[^>]+>/g) ?? [];
      if (!referencedIds.length) continue;
      attempts += 1;
      const adopted = await adoptSplitThread({
        account: t.account,
        threadId: t.threadId,
        subject: t.subject,
        referencedIds,
        counterpartEmails: (t.externalParticipants ?? []).map((p) => p.email),
      }).catch(() => null);
      if (adopted) {
        t.chat = {
          chatId: adopted.chatId,
          title: adopted.title,
          partIndex: adopted.partIndex,
          partCount: adopted.partCount,
          subject: adopted.subject,
          isOpenPart: adopted.isOpenPart,
          noQuote: adopted.noQuote,
        };
      }
    }
  }

  // One row per conversation. Parts are transport, and the reader has one
  // chat — showing each part is showing the plumbing. The newest row stays,
  // and it inherits the signals a dropped row carried.
  const rowByChat = new Map<string, MailThreadSummary>();
  const collapsed: MailThreadSummary[] = [];
  for (const t of deduped) {
    const chatId = t.chat?.chatId;
    if (!chatId) {
      collapsed.push(t);
      continue;
    }
    const kept = rowByChat.get(chatId);
    if (!kept) {
      rowByChat.set(chatId, t);
      collapsed.push(t);
      continue;
    }
    if (t.unread) kept.unread = true;
    if (t.hasCalendarInvite) kept.hasCalendarInvite = true;
    if (t.hasAttachments) kept.hasAttachments = true;
  }

  const nextCursor = encodeMailListCursor(nextTokens);
  if (!isContinuation) {
    inboxCache.set(cacheKey, {
      value: { threads: collapsed, nextCursor },
      expiresAt: Date.now() + 30 * 1000,
    });

    // Persist Gmail first-page rows for the next incremental poll. Key by the
    // pre-dedupe account copies so each mailbox can reuse its own metadata.
    if (!q && !label && gmailListSnippetsByAccount.size) {
      const prior: GmailPriorPage = new Map();
      for (const { summary, latestRfcId, latestReferences } of summaries) {
        if (providerByEmail.get(summary.account) !== "gmail") continue;
        const listSnippet = gmailListSnippetsByAccount
          .get(summary.account)
          ?.get(summary.threadId);
        if (listSnippet == null) continue;
        let byThread = prior.get(summary.account);
        if (!byThread) {
          byThread = new Map();
          prior.set(summary.account, byThread);
        }
        const { chat: _chat, ...rest } = summary;
        byThread.set(summary.threadId, {
          listSnippet,
          summary: rest,
          latestRfcId,
          latestReferences,
        });
      }
      if (prior.size) gmailPriorPages.set(cacheKey, prior);
      if (pageStateByAccount.size) {
        let byAccount = gmailPriorHistoryIds.get(cacheKey);
        if (!byAccount) {
          byAccount = new Map();
          gmailPriorHistoryIds.set(cacheKey, byAccount);
        }
        for (const [email, state] of pageStateByAccount) {
          byAccount.set(email, state);
        }
      }

      // Mirror to Postgres so the next poll starts warm on any process. One
      // store is one client on the team hosts, so write mailboxes in turn. An
      // unchanged page only moves the history id.
      const states = gmailPriorHistoryIds.get(cacheKey);
      for (const [email, byThread] of prior) {
        const rows: MailListSyncRow[] = [];
        for (const [threadId, row] of byThread) {
          rows.push({
            threadId,
            listSnippet: row.listSnippet,
            latestRfcId: row.latestRfcId,
            latestReferences: row.latestReferences,
            summary: row.summary,
          });
        }
        const state = states?.get(email);
        await mailStore().listSync.save(options.clerkUserId, folder, email, {
          rows,
          historyId: state?.historyId ?? null,
          nextPageToken: state?.nextPageToken ?? null,
        });
      }
    }
  }

  return {
    accounts: allAccounts.map((a) => a.email),
    threads: collapsed,
    nextCursor,
  };
}

// ---------------------------------------------------------------------------
// Thread detail
// ---------------------------------------------------------------------------

function emptyThreadDetail(
  account: string,
  threadId: string
): MailThreadDetail {
  return {
    account,
    threadId,
    subject: "(no subject)",
    participants: [],
    messages: [],
    hasOlder: false,
    hasNewer: false,
    reply: {
      inReplyTo: "",
      references: "",
      to: [],
      cc: [],
      allTo: [],
      allCc: [],
    },
  };
}

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

  let start = 0;
  let endExclusive = allIds.length;
  let hasOlder = false;
  let hasNewer = false;

  if (options?.around) {
    const idx = allIds.indexOf(options.around);
    if (idx < 0) {
      // Unknown hit id — fall through to newest page.
      start = Math.max(0, allIds.length - limit);
      endExclusive = allIds.length;
      hasOlder = start > 0;
    } else {
      start = Math.max(0, idx - THREAD_AROUND_RADIUS);
      endExclusive = Math.min(allIds.length, idx + THREAD_AROUND_RADIUS + 1);
      hasOlder = start > 0;
      hasNewer = endExclusive < allIds.length;
    }
  } else if (options?.after) {
    const idx = allIds.indexOf(options.after);
    if (idx < 0 || idx >= allIds.length - 1) {
      return emptyThreadDetail(account, threadId);
    }
    start = idx + 1;
    endExclusive = Math.min(allIds.length, start + limit);
    hasOlder = start > 0;
    hasNewer = endExclusive < allIds.length;
  } else if (options?.oldest) {
    start = 0;
    endExclusive = Math.min(allIds.length, limit);
    hasOlder = false;
    hasNewer = endExclusive < allIds.length;
  } else if (options?.before) {
    const idx = allIds.indexOf(options.before);
    if (idx <= 0) {
      return emptyThreadDetail(account, threadId);
    }
    endExclusive = idx;
    start = Math.max(0, endExclusive - limit);
    hasOlder = start > 0;
    hasNewer = endExclusive < allIds.length;
  } else {
    start = Math.max(0, allIds.length - limit);
    endExclusive = allIds.length;
    hasOlder = start > 0;
    hasNewer = false;
  }

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

  const lastFrom = last
    ? parseAddressList(headerValue(last, "From"))[0]
    : undefined;
  const lastTo = last
    ? parseAddressList(headerValue(last, "To")).map((p) => p.email)
    : [];
  const lastCc = last
    ? parseAddressList(headerValue(last, "Cc")).map((p) => p.email)
    : [];
  // Not "from an address of mine" — from *this* mailbox. See the note on
  // `sentFromThisMailbox`; the difference is a thread with yourself.
  const sentByUs = sentFromThisMailbox({
    from: lastFrom?.email ?? "",
    account,
    to: lastTo,
    cc: lastCc,
  });
  const accountKey = normalizeEmail(account);
  /**
   * Dedupe (ignoring case and Gmail dot/+tag variants) and drop the mailbox
   * we're sending from, so a reply never lands back in this inbox. A
   * reply-all also drops the reader's other addresses: see
   * `replyAllRecipients`.
   */
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

  // Replying to our own last message keeps whoever we addressed it to,
  // rather than addressing the reply to ourselves.
  const replyTo = sentByUs ? lastTo : [lastFrom?.email ?? ""];
  const replyAll = replyAllRecipients({
    from: lastFrom?.email ?? "",
    to: lastTo,
    cc: lastCc,
    account,
    sentByUs,
  });

  const references = last
    ? [
        headerValue(last, "References").trim(),
        headerValue(last, "Message-ID").trim(),
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  // Participant names, "You" standing in for all own addresses.
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

  // An unbound thread that references a conversation's messages is that
  // conversation, split by the provider. Adopt it as the next part. The
  // References header survives the split — the grouping changed, not the
  // headers — so this is where a Gmail split finds its way home.
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
      chat = await adoptSplitThread({
        account,
        threadId,
        subject,
        referencedIds,
        counterpartEmails,
      }).catch(() => null);
    }
  }

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
      // Self-addressed threads (notes to yourself) would otherwise strip down
      // to nobody — replying to yourself is legitimate, so keep the mailbox.
      to: withSelfFallback(recipients(replyTo), account),
      cc: [],
      allTo: replyAll.to,
      allCc: replyAll.cc,
    },
  };
}

/** Reply recipients drop the sending mailbox; a self-thread keeps it. */
function withSelfFallback(list: string[], account: string): string[] {
  return list.length ? list : [account];
}

// ---------------------------------------------------------------------------
// Actions: send / archive / snooze
// ---------------------------------------------------------------------------

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

  const appendixHtml = input.forward
    ? forwardedHtml(input.forward)
    : input.quote
      ? quotedHtml(input.quote)
      : (input.appendix?.html ?? "");

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
    appendixHtml: appendixHtml || undefined,
  });
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
    const outlookAppendix = input.forward
      ? forwardedHtml(input.forward)
      : input.quote
        ? quotedHtml(input.quote)
        : (input.appendix?.html ?? "");
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

  const signature =
    input.includeSignature === false
      ? ""
      : (await getMailSignatureSettings(input.account)).signature;
  const noteWithSignature = signature
    ? `${input.body.replace(/\s+$/, "")}\n\n${signaturePlainText(signature)}`
    : input.body;
  const plainAppendix = input.forward
    ? forwardedPlainText(input.forward)
    : input.quote
      ? quotedPlainText(input.quote)
      : (input.appendix?.text ?? "");
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
    `To: ${input.to.join(", ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.join(", ")}`] : []),
    ...(input.bcc?.length ? [`Bcc: ${input.bcc.join(", ")}`] : []),
    `Subject: ${encodeSubject(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references ? [`References: ${input.references}`] : []),
    "MIME-Version: 1.0",
  ];

  const buildAlternative = (): { headers: string[]; body: string } => {
    if (input.html || input.forward || input.quote || input.appendix) {
      const htmlAppendix = input.forward
        ? forwardedHtml(input.forward)
        : input.quote
          ? quotedHtml(input.quote)
          : (input.appendix?.html ?? "");
      // 12pt matches Outlook's default, so replies don't render smaller than
      // the rest of the thread (for us and for recipients).
      const htmlBody = `<div style="font-family:Helvetica,Arial,sans-serif;font-size:12pt;line-height:1.6;color:#222">${input.html ?? ""}${
        signature ? signatureHtml(signature) : ""
      }${htmlAppendix}</div>`;
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

  let raw: string;
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
    raw = parts.join("\r\n");
  } else {
    const alt = buildRelated();
    raw = [...headers, ...alt.headers, "", alt.body].join("\r\n");
  }

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

/**
 * Throw away the Gmail draft this reply came from.
 *
 * Never fatal. The mail is already sent, and telling the reader their message
 * failed because a leftover draft could not be tidied would be a lie.
 */
async function discardGmailDraft(
  token: string,
  messageId: string,
  threadId?: string
): Promise<void> {
  try {
    const draftId = await findGmailDraftIdForMessage(
      token,
      messageId,
      threadId
    );
    if (draftId) {
      await deleteGmailDraft(token, draftId);
      return;
    }
    // Nothing matched, so Gmail keeps an unsent copy of a message that has
    // gone out — and the reader sees it offered back to them next time they
    // open the thread. Not fatal, but never silent again.
    console.warn(
      `[mail] no Gmail draft matched ${messageId} (thread ${threadId ?? "?"}) — it was not discarded`
    );
  } catch (err) {
    console.warn("[mail] could not discard the Gmail draft:", err);
  }
}

/** The same, for Outlook, where the draft is deleted by its message id. */
async function discardOutlookDraft(
  account: string,
  messageId: string
): Promise<void> {
  try {
    const token = await outlookAccessTokenFor(account);
    await deleteOutlookMessage(token, messageId);
  } catch (err) {
    console.warn("[mail] could not discard the Outlook draft:", err);
  }
}

/**
 * Throw away the draft the provider is holding for a thread.
 *
 * Called when the reader discards a reply here, after the undo window has
 * closed — never during it. A Gmail draft cannot be un-deleted, so the only
 * honest way to offer Undo is to have not done anything yet.
 *
 * `ref` is the draft's message id, as `getMailThread` reported it. Gmail
 * hands a draft a new message id every time it saves, so `threadId` is passed
 * as the second way in — see `findGmailDraftIdForMessage`.
 */
export async function discardProviderDraft(input: {
  account: string;
  ref: string;
  threadId?: string;
}): Promise<void> {
  if ((await resolveMailProvider(input.account)) === "outlook") {
    await discardOutlookDraft(input.account, input.ref);
    invalidateInboxCache();
    return;
  }
  if (await queueLocalAction(input.account, input.threadId ?? "", "discardDraft", { messageId: input.ref })) {
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(input.account);
  await discardGmailDraft(token, input.ref, input.threadId);
  invalidateInboxCache();
}

/** A long list of forgotten drafts is not a list anyone reads. */
const MAX_DRAFT_ROWS = 50;

/**
 * The unsent messages a provider is holding, for the Drafts view.
 *
 * Local drafts are not here: they live in the browser, and the view adds them.
 * This is only the half that needs the network.
 */
export async function listProviderDrafts(
  account: string
): Promise<MailDraftRow[]> {
  if ((await resolveMailProvider(account)) === "outlook") {
    const token = await outlookAccessTokenFor(account);
    const drafts = await listOutlookDraftMessages(token, MAX_DRAFT_ROWS);
    return drafts.map((m) => ({
      id: m.id,
      origin: "outlook" as const,
      account,
      threadId: m.conversationId ?? null,
      subject: (m.subject || "").trim() || "(no subject)",
      snippet: (m.bodyPreview || "").trim(),
      to: (m.toRecipients ?? [])
        .map((r) => r.emailAddress?.address ?? "")
        .filter(Boolean),
      updatedAt: m.lastModifiedDateTime || m.sentDateTime || null,
    }));
  }

  // The copy holds the drafts too: they sit in All Mail with the draft
  // label. One query, no reads.
  if (await localStoreServes(account)) {
    const page = await mailStore().messages.list({ accounts: [account], view: "drafts", limit: MAX_DRAFT_ROWS });
    return page.threads.map((t) => ({
      id: t.latest.messageId,
      origin: "gmail" as const,
      account,
      threadId: t.threadId,
      subject: t.subject.trim() || "(no subject)",
      snippet: t.latest.snippet,
      to: t.latest.to.map((a) => a.email),
      updatedAt: t.latest.sentAt ? new Date(t.latest.sentAt).toISOString() : null,
    }));
  }

  const token = await accessTokenFor(account);
  const { ids } = await listMessageIds(token, "in:drafts");
  const rows = await mapWithConcurrency(
    ids.slice(0, MAX_DRAFT_ROWS),
    async (id) => {
      const m = await getMessageMetadata(token, id, METADATA_HEADERS);
      return {
        id: m.id,
        origin: "gmail" as const,
        account,
        threadId: m.threadId ?? null,
        subject: headerValue(m, "Subject").trim() || "(no subject)",
        snippet: decodeSnippet(m.snippet ?? ""),
        to: parseAddressList(headerValue(m, "To")).map((p) => p.email),
        updatedAt: messageDate(m)
          ? new Date(messageDate(m)).toISOString()
          : null,
      };
    }
  );
  return rows;
}

/** Streamable attachment bytes for preview/download. */
/*
  Files already read, kept for the life of the window.

  A file in a message never changes, and the same one is asked for again
  and again: once for the small picture in the thread, once more to look
  at it, and once more to save it. Each time was a new read from the
  mailbox — for a four-megabyte photograph, five megabytes of base64 over
  IMAP, after a connection that may have to be opened first. The download
  button therefore took as long as the thumbnail had, to fetch what the
  page was already showing.

  Only in the desktop app, where this memory is the reader's own. A server
  would be keeping people's files in a process they share.

  Newest last. When the sum goes over the cap, the oldest go. A read that is
  still on its way is shared too, so two askers make one request.
*/
const ATTACHMENT_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const attachmentCache = new Map<string, Uint8Array>();
const attachmentReads = new Map<string, Promise<{ bytes: Uint8Array }>>();
let attachmentCacheBytes = 0;

function rememberAttachment(key: string, bytes: Uint8Array): void {
  // One file over the cap would push everything else out and then itself.
  if (bytes.length > ATTACHMENT_CACHE_MAX_BYTES / 2) return;
  const had = attachmentCache.get(key);
  if (had) {
    attachmentCacheBytes -= had.length;
    attachmentCache.delete(key);
  }
  attachmentCache.set(key, bytes);
  attachmentCacheBytes += bytes.length;
  for (const [oldKey, oldBytes] of attachmentCache) {
    if (attachmentCacheBytes <= ATTACHMENT_CACHE_MAX_BYTES) break;
    attachmentCache.delete(oldKey);
    attachmentCacheBytes -= oldBytes.length;
  }
}

export async function fetchMailAttachment(input: {
  account: string;
  messageId: string;
  attachmentId: string;
}): Promise<{ bytes: Uint8Array }> {
  if (!tauriInvoke()) return readMailAttachment(input);
  const key = `${input.account.trim().toLowerCase()}|${input.messageId}|${input.attachmentId}`;
  const kept = attachmentCache.get(key);
  if (kept) {
    // Asked for again: it is the newest once more.
    attachmentCache.delete(key);
    attachmentCache.set(key, kept);
    return { bytes: kept };
  }
  const running = attachmentReads.get(key);
  if (running) return running;
  const read = readMailAttachment(input)
    .then((result) => {
      rememberAttachment(key, result.bytes);
      return result;
    })
    .finally(() => attachmentReads.delete(key));
  attachmentReads.set(key, read);
  return read;
}

async function readMailAttachment(input: {
  account: string;
  messageId: string;
  attachmentId: string;
}): Promise<{ bytes: Uint8Array }> {
  if ((await resolveMailProvider(input.account)) === "outlook") {
    return fetchOutlookMailAttachment(input);
  }
  // A file the copy named by its IMAP section: fetched by that section.
  if (input.attachmentId.startsWith(IMAP_ATTACHMENT_PREFIX)) {
    const invoke = tauriInvoke();
    if (!invoke) throw new PlanError("This file is read from the local copy, which needs the desktop app", 501);
    const part = (await invoke("mail_sync_fetch_part", {
      account: input.account,
      messageId: input.messageId,
      section: input.attachmentId.slice(IMAP_ATTACHMENT_PREFIX.length),
    })) as { bytesBase64: string };
    return { bytes: base64ToBytes(part.bytesBase64) };
  }
  const token = await accessTokenFor(input.account);
  const { data } = await getGmailAttachment(
    token,
    input.messageId,
    input.attachmentId
  );
  const bytes = base64UrlToBytes(data);
  return { bytes };
}

/**
 * The RFC 5322 source of one message, for "Show original" and the .eml.
 *
 * Bytes, not text: a message is not always UTF-8, and the download should
 * be the message as it came, not as it was decoded.
 */
export async function fetchMailMessageSource(input: {
  account: string;
  messageId: string;
}): Promise<{ bytes: Uint8Array }> {
  if ((await resolveMailProvider(input.account)) === "outlook") {
    return fetchOutlookMessageSource(input);
  }
  if (await localStoreServes(input.account)) {
    const invoke = tauriInvoke();
    if (invoke) {
      const encoded = (await invoke("mail_sync_fetch_source", {
        account: input.account,
        messageId: input.messageId,
      })) as string;
      return { bytes: base64ToBytes(encoded) };
    }
  }
  const token = await accessTokenFor(input.account);
  const raw = await getMessageRaw(token, input.messageId);
  return { bytes: base64UrlToBytes(raw) };
}

export async function archiveMailThread(
  account: string,
  threadId: string,
  /** Owner of the stored list page, so the row can be dropped from it too. */
  clerkUserId?: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "archive")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await archiveOutlookThread(account, threadId);
    await applyLocalAction(account, threadId, "archive");
    wakeOutlookSync(account);
    if (clerkUserId) {
      await forgetThreadInStoredPages(clerkUserId, account, threadId);
    }
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await modifyThreadLabels(token, threadId, {
      removeLabelIds: ["INBOX", "UNREAD"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  if (clerkUserId) {
    await forgetThreadInStoredPages(clerkUserId, account, threadId);
  }
  invalidateInboxCache();
}

/** Undo of archive: put the thread back in the inbox. */
export async function unarchiveMailThread(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "unarchive")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await unarchiveOutlookThread(account, threadId);
    await applyLocalAction(account, threadId, "unarchive");
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    // Spam and Trash come off with it. Gmail hides a thread that still
    // carries either, whatever else it is labelled, so "back to the inbox"
    // from Junk added the inbox label and left the thread in Junk.
    await modifyThreadLabels(token, threadId, {
      addLabelIds: ["INBOX"],
      removeLabelIds: ["SPAM", "TRASH"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/**
 * Put the newest message of a thread back to unread.
 *
 * The newest, not the whole thread. Someone marking an eleven-message thread
 * unread wants the last one back in front of them, not the ten they have
 * already read. Outlook has always worked this way; Gmail marked all of them
 * until August 2026, because a thread-level modify is the obvious call and the
 * difference does not show in the list.
 */
export async function markMailThreadUnread(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "unread")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await markOutlookThreadUnread(account, threadId);
    await applyLocalAction(account, threadId, "unread");
    wakeOutlookSync(account, "inbox");
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    const thread = await getThreadMinimal(token, threadId);
    const newest = thread.messages?.[thread.messages.length - 1];
    if (newest?.id) {
      await modifyMessageLabels(token, newest.id, { addLabelIds: ["UNREAD"] });
    } else {
      // No message list came back; the thread label is better than nothing.
      await modifyThreadLabels(token, threadId, { addLabelIds: ["UNREAD"] });
    }
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/**
 * Mark every message in a thread read.
 *
 * The whole thread here, which is the mirror of the above: "I have dealt with
 * this" is about the conversation, not about its last line.
 */
export async function markMailThreadRead(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "read")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await markOutlookThreadRead(account, threadId);
    await applyLocalAction(account, threadId, "read");
    wakeOutlookSync(account, "inbox");
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await modifyThreadLabels(token, threadId, {
      removeLabelIds: ["UNREAD"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/**
 * File a conversation as junk, on whichever provider holds it.
 *
 * Filing, not reporting. Neither API exposes the signal the web buttons send
 * to train the provider's filter, so this puts the mail in Junk everywhere
 * the reader looks and teaches Gmail and Outlook nothing. The next message
 * from the same sender arrives exactly as before, which is why the button
 * says "Move to Junk" rather than "Report spam".
 */
export async function markMailThreadJunk(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "junk")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    const token = await outlookAccessTokenFor(account);
    await moveOutlookConversation(token, threadId, "junkemail");
    await applyLocalAction(account, threadId, "junk");
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await modifyThreadLabels(token, threadId, {
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/** Take it back out again — the half that stops a Junk view being a dead end. */
export async function markMailThreadNotJunk(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "notjunk")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    const token = await outlookAccessTokenFor(account);
    await moveOutlookConversation(token, threadId, "inbox");
    await applyLocalAction(account, threadId, "notjunk");
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await modifyThreadLabels(token, threadId, {
      addLabelIds: ["INBOX"],
      removeLabelIds: ["SPAM"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

export async function trashMailThread(
  account: string,
  threadId: string,
  /** Owner of the stored list page, so the row can be dropped from it too. */
  clerkUserId?: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "trash")) {
    invalidateInboxCache();
    return;
  }
  const forget = async () => {
    if (clerkUserId) {
      await forgetThreadInStoredPages(clerkUserId, account, threadId);
    }
  };
  if ((await resolveMailProvider(account)) === "outlook") {
    await trashOutlookThread(account, threadId);
    await applyLocalAction(account, threadId, "trash");
    wakeOutlookSync(account);
    await forget();
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await trashThread(token, threadId);
  } catch (err) {
    translateGmailError(err, account);
  }
  await forget();
  invalidateInboxCache();
}

/** Undo of trash: restore the thread and put it back in the inbox. */
export async function untrashMailThread(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "untrash")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await untrashOutlookThread(account, threadId);
    await applyLocalAction(account, threadId, "untrash");
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await untrashThread(token, threadId);
    // Untrash alone doesn't re-add INBOX, so the thread would end up
    // archived rather than back where the user deleted it from.
    await modifyThreadLabels(token, threadId, { addLabelIds: ["INBOX"] });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/** Best-effort tip Message-ID so sibling mailbox copies stay snoozed too. */
async function tipMessageIdForThread(
  account: string,
  threadId: string
): Promise<string | null> {
  try {
    if ((await resolveMailProvider(account)) === "outlook") {
      const token = await outlookAccessTokenFor(account);
      const tipPage = await listConversationMessages(token, threadId, {
        top: 1,
      });
      const tip = tipPage.messages[tipPage.messages.length - 1];
      return normalizeRfcMessageId(tip?.internetMessageId);
    }
    const token = await accessTokenFor(account);
    const thread = await getThreadMetadata(token, threadId, ["Message-ID"]);
    const messages = [...(thread.messages ?? [])];
    if (!messages.length) return null;
    messages.sort((a, b) => messageDate(a) - messageDate(b));
    const latest = messages[messages.length - 1];
    return normalizeRfcMessageId(headerValue(latest, "Message-ID"));
  } catch (err) {
    console.warn(`[mail] tip Message-ID for snooze failed (${account}):`, err);
    return null;
  }
}

export async function snoozeMailThread(
  account: string,
  threadId: string,
  untilIso: string
): Promise<void> {
  const until = new Date(untilIso);
  if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) {
    throw new PlanError("Snooze time must be in the future", 400);
  }
  const tipMessageId = await tipMessageIdForThread(account, threadId);
  await mailStore().snoozes.set({
    accountEmail: account,
    threadId,
    snoozedUntil: until.toISOString(),
    tipMessageId,
  });
  invalidateInboxCache();
}

export async function unsnoozeMailThread(
  account: string,
  threadId: string
): Promise<void> {
  await mailStore().snoozes.remove(account, threadId);
  invalidateInboxCache();
}

export { countActiveSnoozes } from "@/lib/mail/mail-snooze-count";

/** Active snoozes as list rows, soonest wake first. */
export async function listSnoozedThreads(options: {
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
  /** Words typed in the search box; only rows with all of them come back. */
  q?: string;
}): Promise<{ accounts: string[]; threads: MailThreadSummary[] }> {
  const scope = options.scope ?? "all";
  const allAccounts = filterAccountsForScope(
    await listConnectedMailAccounts(options.clerkUserId),
    scope
  );
  const accountEmails = new Set(
    allAccounts
      .map((a) => a.email)
      .filter((email) => !options.account || email === options.account)
  );
  const providerByEmail = new Map(
    allAccounts.map((a) => [a.email, a.provider] as const)
  );

  const snoozed = await mailStore().snoozes.listActive(100);
  const rows = snoozed.filter((r) => accountEmails.has(r.accountEmail));
  if (!rows.length) {
    return { accounts: allAccounts.map((a) => a.email), threads: [] };
  }

  const classifier = await getClassifier(options.clerkUserId);
  const built = await mapWithConcurrency(
    rows,
    async (row): Promise<MailThreadSummary | null> => {
      const accountEmail = row.accountEmail;
      const threadId = row.threadId;
      const snoozedUntil = row.snoozedUntil;
      const provider = providerByEmail.get(accountEmail) ?? "gmail";
      try {
        if (provider === "outlook") {
          // One message is enough for a row. The list rule runs on that
          // message's envelope, the same rule the inbox applies to Graph's
          // newest message.
          const detail = await getOutlookMailThread(accountEmail, threadId, {
            limit: 1,
            markRead: false,
          });
          const latest = detail.messages[detail.messages.length - 1];
          const from = latest
            ? { name: latest.fromName, email: latest.fromEmail }
            : undefined;
          const to = (latest?.toEmails ?? []).map((email) => ({
            name: "",
            email,
          }));
          const cc = (latest?.ccEmails ?? []).map((email) => ({
            name: "",
            email,
          }));
          const { tab, counterpart, externalParticipants } = classifyThread({
            accountEmail,
            participants: [...(from ? [from] : []), ...to, ...cc],
            senders: from ? [from] : [],
            latestFrom: from,
            latestTo: to,
            classifier,
          });
          return {
            account: accountEmail,
            threadId,
            subject: detail.subject,
            fromName: displayName(counterpart),
            fromEmail: counterpart.email,
            snippet: latest?.bodyText?.slice(0, 160) ?? "",
            lastAt: latest?.sentAt ?? snoozedUntil,
            unread: false,
            messageCount: detail.messages.length,
            tab,
            externalParticipants,
            crmName: crmNameFor(counterpart.email, classifier),
            crmLogoUrl: crmLogoFor(counterpart.email, classifier),
            snoozedUntil,
          };
        }

        // The same row the inbox builds, minus the invite probe: a snoozed
        // row is a reminder, and the chip is not worth a payload per thread.
        const token = await accessTokenFor(accountEmail);
        const thread = await getThreadMetadata(
          token,
          threadId,
          METADATA_HEADERS
        );
        const built = await summarizeGmailThread({
          token,
          accountEmail,
          thread,
          classifier,
          resolveCalendar: false,
          snoozedUntil,
        });
        return built?.summary ?? null;
      } catch (err) {
        console.warn(
          `[mail] snoozed thread fetch failed for ${accountEmail}/${threadId}:`,
          err
        );
        return null;
      }
    }
  );

  // The Snoozed list is short and already in hand, so a search over it
  // is a look at each row: sender, subject, and the first words, with
  // the words the rows would mark. Filters such as has:attachment name
  // no text and leave every row in.
  const terms = searchHighlightTerms(options.q ?? "");
  const threads = built.filter((t): t is MailThreadSummary => t != null);
  const matching = terms.length
    ? threads.filter((t) => {
        const hay = [t.fromName, t.fromEmail, t.subject, t.snippet].filter(Boolean).join(" ");
        return terms.every((term) => highlightRanges(hay, [term]).length > 0);
      })
    : threads;
  return {
    accounts: allAccounts.map((a) => a.email),
    threads: matching,
  };
}

export type { MailAutoReply } from "@/lib/mail/mail-autoreply";
export {
  listMailAutoReplies,
  setMailAutoReply,
} from "@/lib/mail/mail-autoreply";
