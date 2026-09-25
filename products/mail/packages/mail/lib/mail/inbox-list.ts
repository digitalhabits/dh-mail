/*
 * The unified list: every mailbox's page of threads, from Outlook, the
 * local copy or the Gmail API, merged into one list with snoozes, copies
 * and chats folded in, behind a short cache.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */

import "server-only";

import { localStoreServes, localStoreServesFolder } from "@/lib/mail/local-store";
import type { MailStoredThread, MailStoredView } from "@/lib/mail/store/types";
import { decodeSnippet, getThreadMetadata, gmailLabelSearchQuery, listGmailHistory, listRecentMessages, listRecentThreads } from "@/lib/gmail/api";
import {
  filterAccountsForScope,
  type MailAccountScope,
} from "@/lib/mail/account-scope";
import { mailStore } from "@/lib/mail/store";
import type { MailListSyncRow } from "@/lib/mail/store/types";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import {
  expandMailSearchQuery,
  parenthesizeSearchQuery,
} from "@/lib/mail/expand-search-query";
import { adoptSplitThread, getChatsForThreads } from "@/lib/mail/chats";
import { listOutlookAccountThreads } from "@/lib/mail/outlook-inbox";
import { listConnectedMailAccounts } from "@/lib/mail/providers";
import type { MailThreadSummary, MailProvider } from "@/lib/mail/types";
import { type Classifier, classifyThread, crmLogoFor, crmNameFor, displayName } from "@/lib/mail/thread-classify";
import { registerInboxListCacheClear } from "@/lib/mail/inbox-cache";
import { PlanError } from "@/lib/plan/errors";
import { base64UrlToUtf8, utf8ToBase64Url } from "@/lib/base64";
import { METADATA_HEADERS, getClassifier, mapWithConcurrency, normalizeRfcMessageId, summarizeGmailThread } from "@/lib/mail/inbox-gmail-common";
import { type GmailPriorPage, type GmailPriorPageState, type GmailPriorRow, gmailPriorHistoryIds, gmailPriorPages, newerHistoryId } from "@/lib/mail/inbox-gmail-pages";

const PER_ACCOUNT_MESSAGES = 100;
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

type InboxCacheEntry = {
  value: { threads: MailThreadSummary[]; nextCursor: string | null };
  expiresAt: number;
};

const inboxCache = new Map<string, InboxCacheEntry>();
registerInboxListCacheClear(() => {
  inboxCache.clear();
});

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
  const {
    includeSpamTrash,
    q,
    query,
    rawQ,
  } = gmailListQuery({
    folder,
    label,
    options,
  });
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

  await restorePriorPages({
    cacheKey,
    fetchEmails,
    folder,
    options,
    useGmailIncremental,
  });

  const {
    snoozedByKey,
    snoozedTipIds,
    wakeByKey,
    wakeByTip,
  } = await readSnoozes();

  const nextTokens: Record<string, string> = {};
  const summaries: SummaryEntry[] = [];
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

        await listGmailApiAccountThreads({
          accountEmail,
          cacheKey,
          classifier,
          q,
          query,
          includeSpamTrash,
          useGmailIncremental,
          pageTokens,
          summaries,
          nextTokens,
          gmailListSnippetsByAccount,
          pageStateByAccount,
        });
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

  const {
    adoptHints,
    deduped,
  } = await foldCopiesAndSnoozes({
    hasSearchQuery,
    snoozedByKey,
    snoozedTipIds,
    summaries,
    wakeByKey,
    wakeByTip,
  });

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

  const {
    collapsed,
  } = collapseChatParts({
    deduped,
  });

  const nextCursor = encodeMailListCursor(nextTokens);
  await rememberPriorPages({
    cacheKey,
    collapsed,
    folder,
    gmailListSnippetsByAccount,
    isContinuation,
    label,
    nextCursor,
    options,
    pageStateByAccount,
    providerByEmail,
    q,
    summaries,
  });

  return {
    accounts: allAccounts.map((a) => a.email),
    threads: collapsed,
    nextCursor,
  };
}

/**
 * One row per conversation across our mailboxes, and snoozes held back or
 * woken: a snoozed thread with a newer tip wakes, and the store is told.
 * Moved out of listUnifiedInbox.
 */
async function foldCopiesAndSnoozes({
  hasSearchQuery,
  snoozedByKey,
  snoozedTipIds,
  summaries,
  wakeByKey,
  wakeByTip,
}: {
  hasSearchQuery: boolean;
  snoozedByKey: Map<string, string | null>;
  snoozedTipIds: Set<string>;
  summaries: SummaryEntry[];
  wakeByKey: Map<string, string>;
  wakeByTip: Map<string, string>;
}) {
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

  return {
    adoptHints,
    deduped,
  };
}

/**
 * One row per conversation: parts of one chat collapse into the newest
 * row, which keeps the signals a dropped part carried. Moved out of
 * listUnifiedInbox.
 */
function collapseChatParts({
  deduped,
}: {
  deduped: MailThreadSummary[];
}) {
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

  return {
    collapsed,
  };
}

/**
 * After a first page, keep what the next poll needs: the page cached for
 * a short while, and each Gmail mailbox's rows and history position, in
 * memory and in the store. Moved out of listUnifiedInbox.
 */
async function rememberPriorPages({
  cacheKey,
  collapsed,
  folder,
  gmailListSnippetsByAccount,
  isContinuation,
  label,
  nextCursor,
  options,
  pageStateByAccount,
  providerByEmail,
  q,
  summaries,
}: {
  cacheKey: string;
  collapsed: MailThreadSummary[];
  folder: "inbox" | "sent" | "trash" | "junk" | "archived";
  gmailListSnippetsByAccount: Map<string, Map<string, string>>;
  isContinuation: boolean;
  label: string;
  nextCursor: string | null;
  options: Parameters<typeof listUnifiedInbox>[0];
  pageStateByAccount: Map<string, GmailPriorPageState>;
  providerByEmail: Map<string, MailProvider>;
  q: string;
  summaries: SummaryEntry[];
}) {
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
}

/**
 * A cold process fills the Gmail pages kept between polls from the store,
 * so the first poll can still ask Gmail only what changed. Moved out of
 * listUnifiedInbox.
 */
async function restorePriorPages({
  cacheKey,
  fetchEmails,
  folder,
  options,
  useGmailIncremental,
}: {
  cacheKey: string;
  fetchEmails: string[];
  folder: "inbox" | "sent" | "trash" | "junk" | "archived";
  options: Parameters<typeof listUnifiedInbox>[0];
  useGmailIncremental: boolean;
}) {
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
}

/**
 * The active snoozes, indexed for the list: the tip each was put to sleep
 * on, by thread and by tip, and when each wakes. Moved out of
 * listUnifiedInbox.
 */
async function readSnoozes() {
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

  return {
    snoozedByKey,
    snoozedTipIds,
    wakeByKey,
    wakeByTip,
  };
}

/**
 * The Gmail search that lists a view: the folder or label, the reader's
 * words grown to match Gmail's whole-word search, and whether Spam and
 * Trash are asked for. Moved out of listUnifiedInbox.
 */
function gmailListQuery({
  folder,
  label,
  options,
}: {
  folder: "inbox" | "sent" | "trash" | "junk" | "archived";
  label: string;
  options: Parameters<typeof listUnifiedInbox>[0];
}) {
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


  return {
    includeSpamTrash,
    q,
    query,
    rawQ,
  };
}

/**
 * One Gmail mailbox's page of the list, read from the Gmail API: the path
 * for a mailbox the local copy does not serve. Moved out of
 * listUnifiedInbox, which now only chooses: Outlook, the local copy, or
 * this. The rows and tokens it finds go into the page being built, which
 * comes in as input.
 */
/** What one Gmail mailbox's part of the unified list reads and writes. */
type GmailListInput = {
  accountEmail: string;
  cacheKey: string;
  classifier: Classifier;
  q: string;
  query: string;
  includeSpamTrash: boolean;
  useGmailIncremental: boolean;
  pageTokens: Record<string, string> | null;
  summaries: SummaryEntry[];
  nextTokens: Record<string, string>;
  gmailListSnippetsByAccount: Map<string, Map<string, string>>;
  pageStateByAccount: Map<string, GmailPriorPageState>;
};

/** Nothing changed since the kept page: it is the answer as it stands. */
async function serveKeptPage(
  input: GmailListInput,
  kept: { priorForAccount: Map<string, GmailPriorRow>; storedState?: GmailPriorPageState; deltaHistoryId: string | null }
): Promise<void> {
  const { accountEmail, summaries, nextTokens, gmailListSnippetsByAccount, pageStateByAccount } = input;
  // Nothing changed — the prior page is authoritative as-is.
  const listSnippetById = new Map<string, string>();
  for (const [threadId, row] of kept.priorForAccount) {
    listSnippetById.set(threadId, row.listSnippet);
    const { chat: _chat, ...rest } = row.summary;
    summaries.push({ summary: rest, latestRfcId: row.latestRfcId });
  }
  if (kept.storedState?.nextPageToken) {
    nextTokens[accountEmail] = kept.storedState.nextPageToken;
  }
  gmailListSnippetsByAccount.set(accountEmail, listSnippetById);
  if (kept.deltaHistoryId) {
    pageStateByAccount.set(accountEmail, {
      historyId: kept.deltaHistoryId,
      nextPageToken: kept.storedState?.nextPageToken,
    });
  }
}

/**
 * Gmail's history named what changed: read the list again for its order,
 * and fetch only the changed and new threads.
 */
async function refreshChangedRows(
  input: GmailListInput,
  token: string,
  priorForAccount: Map<string, GmailPriorRow>,
  dirtyIds: Set<string>,
  deltaHistoryId: string | null
): Promise<void> {
  const { accountEmail, classifier, query, includeSpamTrash, pageTokens, summaries, nextTokens, gmailListSnippetsByAccount, pageStateByAccount } = input;
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
}

/**
 * No history to go by (expired, failed, or too long): read the list in
 * full, and reuse a kept row only when its snippet is unchanged.
 */
async function listPageInFull(
  input: GmailListInput,
  token: string,
  priorForAccount: Map<string, GmailPriorRow> | undefined,
  dirtyIds: Set<string> | null,
  deltaHistoryId: string | null
): Promise<void> {
  const { accountEmail, classifier, q, query, includeSpamTrash, pageTokens, summaries, nextTokens, gmailListSnippetsByAccount, pageStateByAccount } = input;
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
}

async function listGmailApiAccountThreads(input: GmailListInput): Promise<void> {
  const { accountEmail, cacheKey, q, useGmailIncremental } = input;
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
    return serveKeptPage(input, { priorForAccount, storedState, deltaHistoryId });
  }
  // History named the dirty set: reorder via a cheap threads.list, but
  // metadata-fetch only dirty / brand-new ids (not the whole first page).
  if (dirtyIds && dirtyIds.size > 0 && priorForAccount?.size && !q) {
    return refreshChangedRows(input, token, priorForAccount, dirtyIds, deltaHistoryId);
  }
  return listPageInFull(input, token, priorForAccount, dirtyIds, deltaHistoryId);
}
