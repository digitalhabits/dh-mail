import "server-only";

import { decodeHtmlEntities } from "@/lib/html-entities";
import { bodyTextFromParts } from "@/lib/mail/html-to-text";
import { base64UrlToUtf8, utf8ToBase64Url } from "@/lib/base64";
import type { GmailSendAs } from "@/lib/mail/sender-name";

/** Minimal Gmail REST API client (readonly scope) using fetch, no SDK. */

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export type GmailHeader = { name: string; value: string };

export type GmailMessagePart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailMessagePart;
};

/**
 * Gmail says "too many requests" with a 403, not a 429.
 *
 * Every account has a quota per second, and one message read costs several
 * units of it. A mailbox refresh reads many messages at once, and two
 * mailboxes refresh together, so a burst can go over the line — and the
 * answer comes back 403 with a reason inside it. Read as a plain refusal
 * that failed the whole refresh, which is the "couldn't refresh" the reader
 * saw now and then, with nothing on screen to say why.
 *
 * The remedy Google asks for is to wait and try again, a little longer each
 * time, with some jitter so a burst that failed together does not return
 * together.
 *
 * Two budgets, two waits. The per-second one is a moving average and comes
 * back in under a second, so three short waits are enough. The per-minute
 * one, named in the refusal as "Units per minute per user", comes back as
 * the minute turns: a mailbox rebuild spends it in one go, and the next
 * read of a thread met it, waited three seconds, and failed. That read now
 * waits most of a minute before it gives up.
 */
const RATE_LIMIT_REASON =
  /rateLimitExceeded|userRateLimitExceeded|quotaExceeded|backendError|Too Many Requests/i;
const PER_MINUTE_LIMIT = /per minute/i;

const RETRY_WAITS_MS = [400, 900, 2000];

/*
  A mailbox over its minute is left alone for the minute.

  The per-minute budget used to be met with retries: each refused request
  waited and asked again, three times over. A refresh asks for a hundred
  threads, eight at a time, and Live polls add more — so a mailbox that
  had gone over the line was asked a few hundred more times inside the
  same minute, and the budget never had a quiet minute to come back in.
  The reader saw every mailbox call fail for an hour, opening a message
  included, with the console full of 403s.

  Now the first per-minute refusal mutes the mailbox: every request for it
  in the next minute is refused here, at once, without going to Google,
  with the same error the callers already know. The list says which
  mailbox is over its limit and that it clears within a minute, the next
  poll after the mute asks again, and the budget is spent on nothing in
  between. Keyed by token, which is what a mailbox is here.
*/
const MUTE_MS = 60_000;
const mutedUntilByToken = new Map<string, number>();

/*
  And before that: the minute's budget is kept here, so the line is not
  crossed in the first place.

  Google charges each call in units and allows so many per mailbox per
  minute — 6,000 on this project since Google lowered it from 15,000.
  A refresh of a hundred threads is a thousand, a search another, the
  sent-mail scan for contacts two and a half thousand on its own. Spent
  without looking, the minute ran out and everything after it was refused.

  Every call now declares what it costs, and a call that would take the
  mailbox past this minute's allowance waits for the next minute instead
  of being sent. The allowance sits under Google's so that a unit counted
  differently on their side does not tip it over. A caller sees a slower
  answer rather than a refusal, and the slow part is never the whole
  list — the list is incremental, and the big spenders pace themselves.
*/
const MINUTE_BUDGET_UNITS = 5_000;
type MinuteSpend = { windowStart: number; units: number; warned: boolean };
const spendByToken = new Map<string, MinuteSpend>();

/**
 * What Google charges for a call, from the published unit table. Unknown
 * calls are taken as a message read, the commonest and a middling cost.
 */
export function estimateGmailUnits(method: string, path: string): number {
  const p = path.split("?")[0];
  const verb = method.toUpperCase();
  if (p.includes("/history")) return 2;
  if (p.endsWith("/profile")) return 1;
  if (p.includes("/watch")) return 100;
  if (p.endsWith("/stop")) return 50;
  if (p.includes("/labels")) return verb === "GET" ? 1 : 5;
  if (p.includes("/settings")) return verb === "GET" ? 1 : 50;
  if (p.includes("/attachments/")) return 5;
  if (p.includes("/drafts")) {
    if (p.endsWith("/drafts/send")) return 100;
    if (verb === "GET") return 5;
    if (verb === "PUT" || verb === "PATCH") return 15;
    return 10;
  }
  if (p.includes("/messages")) {
    if (p.endsWith("/send")) return 100;
    if (p.endsWith("/import") || (verb === "POST" && p.endsWith("/messages"))) return 25;
    if (p.endsWith("/batchModify") || p.endsWith("/batchDelete")) return 50;
    if (verb === "DELETE") return 10;
    return 5;
  }
  if (p.includes("/threads")) {
    if (verb === "DELETE") return 20;
    return 10;
  }
  return 5;
}

/** Take `cost` out of this minute's allowance, waiting for the next minute when it is spent. */
async function spendFromBudget(accessToken: string, cost: number, path: string): Promise<void> {
  for (;;) {
    const now = Date.now();
    let spend = spendByToken.get(accessToken);
    if (!spend || now - spend.windowStart >= 60_000) {
      spend = { windowStart: now, units: 0, warned: false };
      spendByToken.set(accessToken, spend);
    }
    if (spend.units + cost <= MINUTE_BUDGET_UNITS) {
      spend.units += cost;
      return;
    }
    const wait = spend.windowStart + 60_000 - now + 50;
    if (!spend.warned) {
      spend.warned = true;
      console.warn(
        `[gmail] ${path.split("?")[0]} would pass this minute's allowance (${spend.units} of ${MINUTE_BUDGET_UNITS} units spent) — waiting ${wait}ms for the next minute`
      );
    }
    await waitFor(wait);
  }
}

function refusedWhileMuted(path: string): Error {
  const err = new Error(
    `Gmail API ${path.split("?")[0]} failed (403, rateLimitExceeded): the mailbox is over its request limit for this minute`
  ) as Error & { status?: number; reason?: string };
  err.status = 403;
  err.reason = "rateLimitExceeded";
  return err;
}

/** A refusal that means "later", not "never". */
export function isGmailRateLimit(err: unknown): boolean {
  const reason = (err as Error & { reason?: string }).reason ?? "";
  const message = err instanceof Error ? err.message : String(err);
  return /rateLimitExceeded|userRateLimitExceeded|quota exceeded|too many requests|over its request limit/i.test(
    `${reason} ${message}`
  );
}

function gmailReason(detail: string): string {
  const match = detail.match(/"reason"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? "";
}

function worthAnotherTry(
  status: number,
  detail: string,
  method: string
): boolean {
  if (status === 429) return true;
  if (status === 403) return RATE_LIMIT_REASON.test(detail);
  // A read that failed inside Google can be asked again; a write might have
  // landed already, and asking twice could send or delete twice.
  return status >= 500 && method === "GET";
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function gmailFetch<T>(
  accessToken: string,
  path: string,
  init?: { method?: "POST" | "PUT" | "PATCH" | "DELETE"; body?: unknown }
): Promise<T> {
  const method = init?.method ?? "GET";
  const mutedUntil = mutedUntilByToken.get(accessToken) ?? 0;
  if (mutedUntil > Date.now()) throw refusedWhileMuted(path);
  await spendFromBudget(accessToken, estimateGmailUnits(method, path), path);
  let res: Response;
  for (let attempt = 0; ; attempt += 1) {
    res = await fetch(`${GMAIL_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.body !== undefined
          ? { "Content-Type": "application/json" }
          : null),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    if (res.ok || res.status === 204) break;

    const detail = await res.text();
    if (
      (res.status === 403 || res.status === 429) &&
      RATE_LIMIT_REASON.test(detail) &&
      PER_MINUTE_LIMIT.test(detail)
    ) {
      mutedUntilByToken.set(accessToken, Date.now() + MUTE_MS);
      console.warn(
        `[gmail] ${path.split("?")[0]} 403 ${gmailReason(detail) || "rate limited"} — over the minute's budget, leaving this mailbox alone for a minute`
      );
      throw refusedWhileMuted(path);
    }
    const wait = RETRY_WAITS_MS[attempt];
    if (wait !== undefined && worthAnotherTry(res.status, detail, method)) {
      console.warn(
        `[gmail] ${path.split("?")[0]} ${res.status} ${
          gmailReason(detail) || "rate limited"
        } — waiting ${wait}ms and asking again`
      );
      await waitFor(wait + Math.floor(Math.random() * 250));
      continue;
    }
    const reason = gmailReason(detail);
    const err = new Error(
      `Gmail API ${path.split("?")[0]} failed (${res.status}${
        reason ? `, ${reason}` : ""
      }): ${detail.slice(0, 300)}`
    ) as Error & { status?: number; reason?: string };
    err.status = res.status;
    if (reason) err.reason = reason;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export async function getGmailProfile(
  accessToken: string
): Promise<{ emailAddress: string; historyId: string }> {
  const data = await gmailFetch<{ emailAddress?: string; historyId?: string }>(
    accessToken,
    "/profile"
  );
  if (!data.emailAddress || !data.historyId) {
    throw new Error("Gmail profile response was incomplete");
  }
  return { emailAddress: data.emailAddress, historyId: data.historyId };
}

/** Gmail vacation responder (out-of-office). Times are epoch-ms strings. */
export type GmailVacationSettings = {
  enableAutoReply?: boolean;
  responseSubject?: string;
  responseBodyPlainText?: string;
  responseBodyHtml?: string;
  restrictToContacts?: boolean;
  restrictToDomain?: boolean;
  startTime?: string;
  endTime?: string;
};

export async function getVacationSettings(
  accessToken: string
): Promise<GmailVacationSettings> {
  return gmailFetch<GmailVacationSettings>(accessToken, "/settings/vacation");
}

/**
 * The addresses this account may send as, and the name Gmail puts on each.
 *
 * The same `gmail.settings.basic` scope as the out-of-office reply, so this
 * asks for nothing new. It answers "what name do this person's colleagues
 * already see on their mail" without us having to ask them.
 */
export async function listGmailSendAs(
  accessToken: string
): Promise<GmailSendAs[]> {
  const data = await gmailFetch<{ sendAs?: GmailSendAs[] }>(
    accessToken,
    "/settings/sendAs"
  );
  return data.sendAs ?? [];
}

export async function updateVacationSettings(
  accessToken: string,
  settings: GmailVacationSettings
): Promise<GmailVacationSettings> {
  return gmailFetch<GmailVacationSettings>(accessToken, "/settings/vacation", {
    method: "PUT",
    body: settings,
  });
}

export async function listMessageIds(
  accessToken: string,
  query: string,
  pageToken?: string
): Promise<{
  ids: string[];
  nextPageToken?: string;
  /** Gmail's rough match count for the query (first page only; often approximate). */
  resultSizeEstimate?: number;
}> {
  const params = new URLSearchParams({ q: query, maxResults: "500" });
  if (pageToken) params.set("pageToken", pageToken);
  const data = await gmailFetch<{
    messages?: { id: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  }>(accessToken, `/messages?${params.toString()}`);
  return {
    ids: (data.messages ?? []).map((m) => m.id),
    nextPageToken: data.nextPageToken,
    resultSizeEstimate: data.resultSizeEstimate,
  };
}

export async function getMessageFull(
  accessToken: string,
  messageId: string
): Promise<GmailMessage> {
  return gmailFetch<GmailMessage>(accessToken, `/messages/${messageId}?format=full`);
}

/**
 * The message as it arrived, headers and all: the RFC 5322 source, as
 * Gmail hands it over — base64url. The caller decodes it.
 */
export async function getMessageRaw(
  accessToken: string,
  messageId: string
): Promise<string> {
  const data = await gmailFetch<{ raw?: string }>(
    accessToken,
    `/messages/${messageId}?format=raw`
  );
  if (!data.raw) throw new Error("Gmail sent the message without its source");
  return data.raw;
}

/** True when Gmail still classifies the message as a draft (never sent). */
export function isGmailDraft(message: Pick<GmailMessage, "labelIds">): boolean {
  return (message.labelIds ?? []).includes("DRAFT");
}

export type GmailDraftRef = {
  id: string;
  message?: { id?: string; threadId?: string };
};

/**
 * Which draft on one page answers to a message, and which to its thread.
 *
 * Two answers rather than one because they rank differently across pages: an
 * exact message id on the last page still beats a thread match on the first.
 */
export function matchGmailDraftPage(
  drafts: GmailDraftRef[],
  messageId: string,
  threadId?: string
): { exact: string | null; byThread: string | null } {
  return {
    exact: drafts.find((d) => d.message?.id === messageId)?.id ?? null,
    byThread: threadId
      ? (drafts.find((d) => d.message?.threadId === threadId)?.id ?? null)
      : null,
  };
}

/**
 * The id of the draft that owns a message, or null.
 *
 * A Gmail draft and its message are two different objects with two different
 * ids, and only the draft id can be deleted. The thread gives us the message,
 * so the draft has to be looked up — which is why this is done when the reply
 * is sent rather than every time a thread is opened.
 *
 * `threadId` is a second way in, and it matters. Gmail gives a draft a new
 * message id every time it saves it, and it saves on a keystroke — so the id
 * read when the thread was opened is stale as soon as the reader touches that
 * draft in Gmail, which they can be doing in another window while the reply
 * goes out from here. The thread is what does not change. A thread holds at
 * most one draft in practice, so falling back to it is not a guess.
 */
export async function findGmailDraftIdForMessage(
  accessToken: string,
  messageId: string,
  threadId?: string
): Promise<string | null> {
  let pageToken: string | undefined;
  let byThread: string | null = null;
  // A mailbox full of forgotten drafts should not turn into an endless walk.
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await gmailFetch<{
      drafts?: GmailDraftRef[];
      nextPageToken?: string;
    }>(accessToken, `/drafts?${params.toString()}`);
    const found = matchGmailDraftPage(data.drafts ?? [], messageId, threadId);
    if (found.exact) return found.exact;
    byThread = byThread ?? found.byThread;
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return byThread;
}

/** Remove a draft from Gmail. */
export async function deleteGmailDraft(
  accessToken: string,
  draftId: string
): Promise<void> {
  await gmailFetch(accessToken, `/drafts/${draftId}`, { method: "DELETE" });
}

/** True when the message appears in Sent (actually delivered outbound). */
export function isGmailSent(message: Pick<GmailMessage, "labelIds">): boolean {
  return (message.labelIds ?? []).includes("SENT");
}

/**
 * Message ids currently in Drafts that match the query (used to scrub
 * previously-imported draft rows out of client_emails).
 */
export async function listDraftMessageIds(
  accessToken: string,
  query: string
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listMessageIds(accessToken, `in:drafts ${query}`, pageToken);
    ids.push(...page.ids);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return ids;
}

/**
 * Incremental sync: message ids added since `startHistoryId`.
 * Throws with status 404 when the historyId has expired (caller should re-backfill).
 */
export async function listHistoryAddedMessageIds(
  accessToken: string,
  startHistoryId: string
): Promise<{ ids: string[]; latestHistoryId: string | null }> {
  const ids = new Set<string>();
  let latestHistoryId: string | null = null;
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      historyTypes: "messageAdded",
      maxResults: "500",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await gmailFetch<{
      history?: { messagesAdded?: { message?: { id?: string } }[] }[];
      historyId?: string;
      nextPageToken?: string;
    }>(accessToken, `/history?${params.toString()}`);

    for (const entry of data.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if (added.message?.id) ids.add(added.message.id);
      }
    }
    if (data.historyId) latestHistoryId = data.historyId;
    pageToken = data.nextPageToken;
  } while (pageToken);

  return { ids: [...ids], latestHistoryId };
}

// ---------------------------------------------------------------------------
// Inbox / thread / write helpers (Mail tab)
// ---------------------------------------------------------------------------

/** Message ids matching `query`, capped at `maxResults` (single page). */
export async function listRecentMessageIds(
  accessToken: string,
  query: string,
  maxResults: number
): Promise<string[]> {
  const page = await listRecentMessages(accessToken, query, maxResults);
  return page.messages.map((m) => m.id);
}

/**
 * Messages matching `query` (id + threadId). Used for search so we can deep-link
 * into the hit message inside each thread.
 */
export async function listRecentMessages(
  accessToken: string,
  query: string,
  maxResults: number,
  pageToken?: string
): Promise<{
  messages: { id: string; threadId: string }[];
  nextPageToken?: string;
}> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  });
  if (pageToken) params.set("pageToken", pageToken);
  const data = await gmailFetch<{
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
  }>(accessToken, `/messages?${params.toString()}`);
  return {
    messages: (data.messages ?? []).filter(
      (m): m is { id: string; threadId: string } => Boolean(m.id && m.threadId)
    ),
    nextPageToken: data.nextPageToken,
  };
}

/** One row from `threads.list` — id plus list snippet (no per-thread get). */
export type GmailThreadListItem = {
  id: string;
  /** Raw snippet from the list payload (may be HTML-entity encoded). */
  snippet: string;
  /** Thread's history position — the page max seeds history delta polls. */
  historyId?: string;
};

/**
 * Threads matching `query`, one page of up to `maxResults` (Gmail max 500).
 * Spam and Trash need `includeSpamTrash` — see the option.
 * Includes list snippets so callers can skip `threads.get` when unchanged.
 * Pass `pageToken` from a previous response to continue without re-listing.
 */
export async function listRecentThreads(
  accessToken: string,
  query: string,
  maxResults: number,
  pageToken?: string,
  options?: {
    /**
     * Gmail leaves Spam and Trash out of `threads.list` unless this is set,
     * whatever the query says. So `in:spam` and `in:trash` come back empty
     * without it, and quietly — an empty list, not an error.
     */
    includeSpamTrash?: boolean;
  }
): Promise<{ threads: GmailThreadListItem[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  });
  if (options?.includeSpamTrash) params.set("includeSpamTrash", "true");
  if (pageToken) params.set("pageToken", pageToken);
  const data = await gmailFetch<{
    threads?: { id: string; snippet?: string; historyId?: string }[];
    nextPageToken?: string;
  }>(accessToken, `/threads?${params.toString()}`);
  return {
    threads: (data.threads ?? []).map((t) => ({
      id: t.id,
      snippet: t.snippet ?? "",
      historyId: t.historyId,
    })),
    nextPageToken: data.nextPageToken,
  };
}

export type GmailHistoryDelta = {
  /** Threads touched since startHistoryId (adds/deletes/label changes). */
  changedThreadIds: Set<string>;
  /** Mailbox history position to store for the next delta poll. */
  historyId: string;
  /** Change log too long to walk — callers should do a full diff instead. */
  incomplete: boolean;
};

/**
 * Change log since a prior historyId — Gmail's official incremental sync.
 * Gmail keeps roughly a week of history; an expired/invalid startHistoryId
 * fails with HTTP 404 (surfaced via the error's `status`), in which case
 * callers must fall back to a full listing.
 */
export async function listGmailHistory(
  accessToken: string,
  startHistoryId: string
): Promise<GmailHistoryDelta> {
  const changedThreadIds = new Set<string>();
  let historyId = startHistoryId;
  let pageToken: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const params = new URLSearchParams({
      startHistoryId,
      maxResults: "500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await gmailFetch<{
      history?: {
        messagesAdded?: { message?: { threadId?: string } }[];
        messagesDeleted?: { message?: { threadId?: string } }[];
        labelsAdded?: { message?: { threadId?: string } }[];
        labelsRemoved?: { message?: { threadId?: string } }[];
      }[];
      historyId?: string;
      nextPageToken?: string;
    }>(accessToken, `/history?${params.toString()}`);
    if (data.historyId) historyId = data.historyId;
    // Every kind of change names its thread the same way.
    const records = (data.history ?? []).flatMap((entry) => [
      ...(entry.messagesAdded ?? []),
      ...(entry.messagesDeleted ?? []),
      ...(entry.labelsAdded ?? []),
      ...(entry.labelsRemoved ?? []),
    ]);
    for (const record of records) {
      const threadId = record.message?.threadId;
      if (threadId) changedThreadIds.add(threadId);
    }
    pageToken = data.nextPageToken;
    if (!pageToken) {
      return { changedThreadIds, historyId, incomplete: false };
    }
  }
  return { changedThreadIds, historyId, incomplete: true };
}

/**
 * Thread ids matching `query`, one page of up to `maxResults` (Gmail max 500).
 * Pass `pageToken` from a previous response to continue without re-listing.
 */
export async function listRecentThreadIds(
  accessToken: string,
  query: string,
  maxResults: number,
  pageToken?: string
): Promise<{ ids: string[]; nextPageToken?: string }> {
  const page = await listRecentThreads(
    accessToken,
    query,
    maxResults,
    pageToken
  );
  return {
    ids: page.threads.map((t) => t.id),
    nextPageToken: page.nextPageToken,
  };
}

/** Lightweight fetch: labels/snippet plus only the named headers. */
export async function getMessageMetadata(
  accessToken: string,
  messageId: string,
  headers: string[]
): Promise<GmailMessage> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of headers) params.append("metadataHeaders", h);
  return gmailFetch<GmailMessage>(
    accessToken,
    `/messages/${messageId}?${params.toString()}`
  );
}

export type GmailThread = { id: string; messages?: GmailMessage[] };

/** All messages in a thread with labels/snippet + named headers (no bodies). */
export async function getThreadMetadata(
  accessToken: string,
  threadId: string,
  headers: string[]
): Promise<GmailThread> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of headers) params.append("metadataHeaders", h);
  return gmailFetch<GmailThread>(
    accessToken,
    `/threads/${threadId}?${params.toString()}`
  );
}

export async function getThreadFull(
  accessToken: string,
  threadId: string
): Promise<GmailThread> {
  return gmailFetch<GmailThread>(accessToken, `/threads/${threadId}?format=full`);
}

/** Message ids + labels only (cheap). Ordered oldest → newest by Gmail. */
export async function getThreadMinimal(
  accessToken: string,
  threadId: string
): Promise<{ id: string; messages?: { id: string; labelIds?: string[] }[] }> {
  return gmailFetch(
    accessToken,
    `/threads/${threadId}?format=minimal`
  );
}

/** Add/remove labels on every message in a thread (archive, mark read, …). */
export async function modifyThreadLabels(
  accessToken: string,
  threadId: string,
  change: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<void> {
  await gmailFetch(accessToken, `/threads/${threadId}/modify`, {
    method: "POST",
    body: {
      addLabelIds: change.addLabelIds ?? [],
      removeLabelIds: change.removeLabelIds ?? [],
    },
  });
}

/**
 * Labels on one message, rather than on every message in its thread.
 *
 * Marking a thread unread makes all of it unread, which is not what "unread"
 * means to a reader: they want the newest message back, not the eleven they
 * already read. Outlook works that way already.
 */
export async function modifyMessageLabels(
  accessToken: string,
  messageId: string,
  change: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<void> {
  await gmailFetch(accessToken, `/messages/${messageId}/modify`, {
    method: "POST",
    body: {
      addLabelIds: change.addLabelIds ?? [],
      removeLabelIds: change.removeLabelIds ?? [],
    },
  });
}

/** User-created Gmail labels (our “folders”). System labels are filtered out. */
export type GmailLabel = {
  id: string;
  name: string;
  type?: "system" | "user";
  threadsTotal?: number;
  threadsUnread?: number;
  messagesTotal?: number;
  messagesUnread?: number;
};

export async function listGmailLabels(
  accessToken: string
): Promise<GmailLabel[]> {
  const data = await gmailFetch<{ labels?: GmailLabel[] }>(
    accessToken,
    "/labels"
  );
  return data.labels ?? [];
}

/** Full label (list endpoint omits thread/message counts). */
export async function getGmailLabel(
  accessToken: string,
  labelId: string
): Promise<GmailLabel> {
  return gmailFetch<GmailLabel>(
    accessToken,
    `/labels/${encodeURIComponent(labelId)}`
  );
}

/**
 * How many threads a label holds, counting only what a search can reach.
 *
 * Not `threadsTotal` from the label itself. That counts a thread wherever it
 * is, Spam and Trash included, while every list in this app leaves those out —
 * so a folder advertised 225 and opened on 1. A number nobody can click
 * through to is worse than no number.
 *
 * Capped: past the cap the exact figure stops being useful, and the list it
 * describes is capped too.
 */
export async function countThreadsForLabel(
  accessToken: string,
  labelName: string,
  cap: number
): Promise<{ count: number; atCap: boolean }> {
  const query = gmailLabelSearchQuery(labelName);
  if (!query) return { count: 0, atCap: false };
  const page = await listRecentThreads(accessToken, query, cap);
  return {
    count: page.threads.length,
    atCap: Boolean(page.nextPageToken),
  };
}

export async function createGmailLabel(
  accessToken: string,
  name: string
): Promise<GmailLabel> {
  return gmailFetch<GmailLabel>(accessToken, "/labels", {
    method: "POST",
    body: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
}

export async function renameGmailLabel(
  accessToken: string,
  labelId: string,
  name: string
): Promise<GmailLabel> {
  return gmailFetch<GmailLabel>(
    accessToken,
    `/labels/${encodeURIComponent(labelId)}`,
    {
      method: "PATCH",
      body: { id: labelId, name },
    }
  );
}

export async function deleteGmailLabel(
  accessToken: string,
  labelId: string
): Promise<void> {
  await gmailFetch(accessToken, `/labels/${encodeURIComponent(labelId)}`, {
    method: "DELETE",
  });
}

/** Gmail search clause for a user label (quotes names with spaces). */
export function gmailLabelSearchQuery(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  if (/[\s"()]/.test(trimmed)) {
    return `label:"${trimmed.replace(/"/g, "")}"`;
  }
  return `label:${trimmed}`;
}

/** Move a thread to Trash (recoverable for ~30 days in Gmail). */
export async function trashThread(
  accessToken: string,
  threadId: string
): Promise<void> {
  await gmailFetch(accessToken, `/threads/${threadId}/trash`, {
    method: "POST",
    body: {},
  });
}

/** Restore a thread from Trash (does not re-add INBOX by itself). */
export async function untrashThread(
  accessToken: string,
  threadId: string
): Promise<void> {
  await gmailFetch(accessToken, `/threads/${threadId}/untrash`, {
    method: "POST",
    body: {},
  });
}

/**
 * Delete messages for good. They do not go to Trash and cannot be restored.
 *
 * This is the one call in this file that needs the `https://mail.google.com/`
 * scope: Gmail refuses it with `gmail.modify`. It takes message ids and not a
 * thread id on purpose. `DELETE /threads/{id}` removes every message of the
 * thread, and a thread can have one message in Trash and the others in the
 * inbox.
 */
export async function deleteMessagesForever(
  accessToken: string,
  messageIds: string[]
): Promise<void> {
  // batchDelete takes 1000 ids a call.
  for (let i = 0; i < messageIds.length; i += 1000) {
    await gmailFetch(accessToken, "/messages/batchDelete", {
      method: "POST",
      body: { ids: messageIds.slice(i, i + 1000) },
    });
  }
}

/** The messages of a thread that are in Trash ("TRASH") or Junk ("SPAM"). */
export async function threadMessageIdsWithLabel(
  accessToken: string,
  threadId: string,
  label: "TRASH" | "SPAM"
): Promise<string[]> {
  const thread = await getThreadMinimal(accessToken, threadId);
  return (thread.messages ?? [])
    .filter((m) => (m.labelIds ?? []).includes(label))
    .map((m) => m.id);
}

/** Send a raw RFC 2822 message; threadId keeps replies in their conversation. */
export async function sendRawMessage(
  accessToken: string,
  rawRfc822: string,
  threadId?: string
): Promise<{ id: string; threadId?: string }> {
  const raw = utf8ToBase64Url(rawRfc822);
  return gmailFetch<{ id: string; threadId?: string }>(
    accessToken,
    "/messages/send",
    { method: "POST", body: threadId ? { raw, threadId } : { raw } }
  );
}

// ---------------------------------------------------------------------------
// Message parsing helpers
// ---------------------------------------------------------------------------

export function headerValue(message: GmailMessage, name: string): string {
  const header = message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? "";
}

/** Parse "Jane Doe <jane@x.org>, bob@y.com" into lowercase addresses. */
export function parseAddressList(raw: string): { email: string; name: string }[] {
  if (!raw.trim()) return [];
  const results: { email: string; name: string }[] = [];
  // Split on commas that are not inside quoted display names.
  const parts = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const part of parts) {
    const angled = part.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
    if (angled) {
      // Outlook and Exchange write <'ann@x.org'>; the quotes are not part of
      // the address, and a reply that keeps them is refused.
      const email = angled[2].trim().replace(/^'(.*)'$/, "$1").trim().toLowerCase();
      if (email.includes("@")) {
        results.push({ email, name: angled[1].trim() });
      }
      continue;
    }
    const bare = part.match(/[\w.+'-]+@[\w-]+\.[\w.-]+/);
    if (bare) {
      results.push({ email: bare[0].replace(/^'/, "").toLowerCase(), name: "" });
    }
  }
  return results;
}

function decodeBase64Url(data: string): string {
  return base64UrlToUtf8(data);
}


/** Gmail snippets arrive HTML-escaped (e.g. &#39; for apostrophes). */
export function decodeSnippet(snippet: string): string {
  return decodeHtmlEntities(snippet);
}

/** Extract readable body text, preferring text/plain over stripped HTML. */
export function extractBodyText(message: GmailMessage): string {
  let plain = "";
  let html = "";

  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return;
    if (part.body?.data && !part.filename) {
      if (part.mimeType === "text/plain" && !plain) {
        plain = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && !html) {
        html = decodeBase64Url(part.body.data);
      }
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);

  const text = bodyTextFromParts(plain, html);
  // Cap stored bodies; long threads repeat quoted history anyway.
  return text.length > 20_000 ? `${text.slice(0, 20_000)}\n[truncated]` : text;
}

const MAX_INLINE_IMAGE_BYTES = 1_500_000; // per image
const MAX_INLINE_TOTAL_BYTES = 5_000_000; // per message

/**
 * Resolve the message's cid-referenced inline images (newsletter badges,
 * embedded photos) to data: URIs keyed by Content-ID, so the client can
 * substitute them into the HTML body. Oversized or broken parts are skipped.
 */
export async function resolveInlineImages(
  accessToken: string,
  message: GmailMessage,
  bodyHtml: string
): Promise<Record<string, string>> {
  type InlineRef = {
    cid: string;
    mimeType: string;
    size: number;
    data?: string;
    attachmentId?: string;
  };
  const refs: InlineRef[] = [];
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return;
    const mimeType = part.mimeType ?? "";
    if (mimeType.startsWith("image/")) {
      const rawCid = part.headers?.find(
        (h) => h.name.toLowerCase() === "content-id"
      )?.value;
      const cid = rawCid?.trim().replace(/^<|>$/g, "");
      if (cid && bodyHtml.includes(`cid:${cid}`)) {
        refs.push({
          cid,
          mimeType,
          size: part.body?.size ?? 0,
          data: part.body?.data,
          attachmentId: part.body?.attachmentId,
        });
      }
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);

  const out: Record<string, string> = {};
  let total = 0;
  await Promise.all(
    refs.map(async (ref) => {
      if (ref.size > MAX_INLINE_IMAGE_BYTES) return;
      try {
        const data =
          ref.data ??
          (ref.attachmentId
            ? (
                await gmailFetch<{ data?: string }>(
                  accessToken,
                  `/messages/${message.id}/attachments/${ref.attachmentId}`
                )
              ).data
            : undefined);
        if (!data) return;
        const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
        if (total + b64.length > MAX_INLINE_TOTAL_BYTES) return;
        total += b64.length;
        out[ref.cid] = `data:${ref.mimeType};base64,${b64}`;
      } catch {
        // A missing attachment just leaves that image out.
      }
    })
  );
  return out;
}

/**
 * Extract the raw text/html body for rich display. Returns "" when the
 * message has no HTML part. The client sanitizes before rendering.
 */
export function extractBodyHtml(message: GmailMessage): string {
  let html = "";
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part || html) return;
    if (part.body?.data && !part.filename && part.mimeType === "text/html") {
      html = decodeBase64Url(part.body.data);
      return;
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);
  // Cap so a pathological newsletter can't balloon the thread payload.
  return html.length > 500_000 ? "" : html.trim();
}

export type GmailAttachmentMeta = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

function partFilename(part: GmailMessagePart): string {
  const direct = part.filename?.trim();
  if (direct) return direct;
  const disposition =
    part.headers?.find((h) => h.name.toLowerCase() === "content-disposition")
      ?.value ?? "";
  const fromDisp =
    /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;\s]+)/i.exec(
      disposition
    );
  if (fromDisp) {
    const raw = fromDisp[1] || fromDisp[2] || fromDisp[3] || "";
    try {
      return decodeURIComponent(raw.replace(/^\s*"|"\s*$/g, "")).trim();
    } catch {
      return raw.replace(/^\s*"|"\s*$/g, "").trim();
    }
  }
  const contentType =
    part.headers?.find((h) => h.name.toLowerCase() === "content-type")?.value ??
    "";
  const fromType = /name="([^"]+)"|name=([^;\s]+)/i.exec(contentType);
  if (fromType) return (fromType[1] || fromType[2] || "").trim();
  return "";
}

/**
 * Named file parts that are real attachments (not cid: images already shown
 * inline in the HTML body). Prefers attachmentId for on-demand fetch; falls
 * back to a synthetic id when Gmail inlined the bytes on the part.
 */
export function extractAttachments(
  message: GmailMessage,
  bodyHtml = ""
): GmailAttachmentMeta[] {
  const out: GmailAttachmentMeta[] = [];
  let dataPartIndex = 0;
  const walk = (part: GmailMessagePart | undefined) => {
    if (!part) return;
    const mimeType = part.mimeType || "application/octet-stream";
    const isCalendar =
      mimeType.toLowerCase().startsWith("text/calendar") ||
      mimeType.toLowerCase() === "application/ics";
    const filename =
      partFilename(part) || (isCalendar ? "invite.ics" : "");
    const attachmentId = part.body?.attachmentId;
    const hasInlineData = Boolean(part.body?.data);
    if (filename && (attachmentId || hasInlineData)) {
      const rawCid = part.headers?.find(
        (h) => h.name.toLowerCase() === "content-id"
      )?.value;
      const cid = rawCid?.trim().replace(/^<|>$/g, "");
      const disposition =
        part.headers
          ?.find((h) => h.name.toLowerCase() === "content-disposition")
          ?.value?.toLowerCase() ?? "";
      /**
       * A part the sender marked as an attachment is one, whatever else is
       * true of it.
       *
       * Without this, a picture that carries a Content-ID — which a mail
       * client gives every image it sends, referenced or not — was dropped
       * as an inline image whenever the same id appeared anywhere in the
       * HTML. A forward quotes the message it forwards, so the quoted
       * history carried the cid and swallowed the file: the list said the
       * thread had attachments, because it applies this test without a body
       * to check against, and the reader showed none.
       */
      const attached = disposition.includes("attachment");
      const inlineImage =
        !attached &&
        Boolean(cid) &&
        mimeType.startsWith("image/") &&
        (bodyHtml.includes(`cid:${cid}`) || disposition.includes("inline"));
      if (!inlineImage) {
        out.push({
          attachmentId: attachmentId || `data:${dataPartIndex++}:${filename}`,
          filename,
          mimeType,
          size: part.body?.size ?? 0,
        });
      }
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(message.payload);
  return out;
}

/**
 * Fetch raw attachment bytes from Gmail (base64url in the response).
 * Synthetic ids from extractAttachments (`data:N:filename`) read the inlined
 * part body when Gmail didn't assign an attachmentId.
 */
export async function getGmailAttachment(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<{ data: string; size: number }> {
  const dataMatch = /^data:(\d+):/.exec(attachmentId);
  if (dataMatch) {
    const targetIndex = Number(dataMatch[1]);
    const message = await getMessageFull(accessToken, messageId);
    let dataPartIndex = 0;
    let found: string | undefined;
    const walk = (part: GmailMessagePart | undefined) => {
      if (!part || found) return;
      const mimeType = part.mimeType || "application/octet-stream";
      const isCalendar =
        mimeType.toLowerCase().startsWith("text/calendar") ||
        mimeType.toLowerCase() === "application/ics";
      const filename =
        partFilename(part) || (isCalendar ? "invite.ics" : "");
      if (filename && part.body?.data && !part.body.attachmentId) {
        if (dataPartIndex === targetIndex) found = part.body.data;
        dataPartIndex += 1;
      }
      for (const child of part.parts ?? []) walk(child);
    };
    walk(message.payload);
    if (!found) throw new Error("Attachment data missing");
    return { data: found, size: found.length };
  }

  const data = await gmailFetch<{ data?: string; size?: number }>(
    accessToken,
    `/messages/${messageId}/attachments/${attachmentId}`
  );
  if (!data.data) throw new Error("Attachment data missing");
  return { data: data.data, size: data.size ?? 0 };
}
