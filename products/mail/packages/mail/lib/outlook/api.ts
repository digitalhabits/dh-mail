import "server-only";
import { noteOutlookMove } from "@/lib/mail/outlook-moves";
import { base64ToBytes } from "@/lib/base64";
import { mailSay } from "@/lib/mail/i18n-strings";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export type GraphRecipient = {
  emailAddress?: { name?: string; address?: string };
};

export type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  bccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  internetMessageId?: string;
  parentFolderId?: string;
  isDraft?: boolean;
  lastModifiedDateTime?: string;
  /** Flagged for follow-up — Outlook's star. */
  flag?: { flagStatus?: string };
  /** Where this message opens on the web. Graph answers it on a create. */
  webLink?: string;
  /** Only present when asked for by `$expand` — see `deferredSendTimeOf`. */
  singleValueExtendedProperties?: { id: string; value?: string }[];
  /**
   * Sometimes present on `eventMessage` responses. Do not $select this on
   * `/messages` — personal Outlook.com Graph rejects it as unknown on Message.
   */
  meetingMessageType?:
    | "none"
    | "meetingRequest"
    | "meetingCancelled"
    | "meetingAccepted"
    | "meetingTentativelyAccepted"
    | "meetingDeclined"
    | string;
  "@odata.type"?: string;
};

export type GraphAttachment = {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string;
  "@odata.type"?: string;
};

/**
 * How many requests this app will have in the air for one mailbox at once.
 *
 * Graph allows four, and answers the fifth with 429 ApplicationThrottled —
 * "over its MailboxConcurrency limit". Three leaves room for the request the
 * reader is actually waiting on: a forward reads its attachments in parallel
 * and then sends, and it was the send that came back refused.
 */
const GRAPH_CONCURRENCY = 3;

/** Waiting room, one queue per mailbox. */
const graphQueues = new Map<string, { running: number; waiting: (() => void)[] }>();

async function withGraphSlot<T>(
  accessToken: string,
  run: () => Promise<T>
): Promise<T> {
  // Keyed by the token, which is per mailbox — the limit Graph counts by.
  // A refresh mid-flight opens a second queue for the same mailbox for a
  // moment. The retry below is what covers that; three plus three is over
  // the line, but only until the old token's work drains.
  const key = accessToken.slice(-32);
  const queue = graphQueues.get(key) ?? { running: 0, waiting: [] };
  graphQueues.set(key, queue);
  if (queue.running >= GRAPH_CONCURRENCY) {
    await new Promise<void>((resolve) => queue.waiting.push(resolve));
  }
  queue.running += 1;
  try {
    return await run();
  } finally {
    queue.running -= 1;
    queue.waiting.shift()?.();
    if (!queue.running && !queue.waiting.length) graphQueues.delete(key);
  }
}

/** Statuses Graph uses for "not now, ask again" rather than "no". */
const GRAPH_RETRY_STATUS = new Set([429, 503, 504]);
const GRAPH_ATTEMPTS = 3;
const GRAPH_MAX_WAIT_MS = 20_000;

function retryAfterMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  // Graph says how long in seconds. Without it, back off on our own.
  const wait = Number.isFinite(header) && header > 0 ? header * 1000 : 2 ** attempt * 700;
  return Math.min(wait, GRAPH_MAX_WAIT_MS);
}

async function graphFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  return withGraphSlot(accessToken, async () => {
    let lastThrottle: { status: number; text: string } | null = null;
    for (let attempt = 0; attempt < GRAPH_ATTEMPTS; attempt++) {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      if (res.ok) return data as T;

      /*
        Told to wait, rather than told no.

        Graph throttles per mailbox and says for how long. Waiting and asking
        again is what it asks for, and it is the difference between a send
        that takes three seconds and a send the reader is told failed.
      */
      if (GRAPH_RETRY_STATUS.has(res.status) && attempt < GRAPH_ATTEMPTS - 1) {
        lastThrottle = { status: res.status, text };
        await new Promise((resolve) =>
          setTimeout(resolve, retryAfterMs(res, attempt))
        );
        continue;
      }

      const throttled = GRAPH_RETRY_STATUS.has(res.status);
      const err = new Error(
        // A reader can do something about "wait a moment". Nobody can do
        // anything about a line of Graph's JSON, and this one reached the
        // screen of somebody forwarding a message.
        throttled
          ? mailSay("mailboxBusy")
          : `Graph ${init?.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`
      ) as Error & { status?: number; detail?: string };
      err.status = res.status;
      if (throttled) {
        err.detail = `Graph ${init?.method ?? "GET"} ${path} (${res.status}): ${text.slice(0, 300)}`;
      }
      throw err;
    }
    // Every attempt was throttled.
    const err = new Error(mailSay("mailboxBusy")) as Error & {
      status?: number;
      detail?: string;
    };
    err.status = lastThrottle?.status ?? 429;
    err.detail = lastThrottle?.text.slice(0, 300);
    throw err;
  });
}

export async function getOutlookProfile(
  accessToken: string
): Promise<{ mail: string; userPrincipalName: string }> {
  const me = await graphFetch<{
    mail?: string;
    userPrincipalName?: string;
  }>(accessToken, "/me?$select=mail,userPrincipalName");
  const mail = (me.mail || me.userPrincipalName || "").trim().toLowerCase();
  if (!mail) throw new Error("Microsoft profile returned no email address");
  return {
    mail,
    userPrincipalName: (me.userPrincipalName || mail).toLowerCase(),
  };
}

const MESSAGE_LIST_SELECT = [
  "id",
  "conversationId",
  "subject",
  "bodyPreview",
  "from",
  "toRecipients",
  "ccRecipients",
  "receivedDateTime",
  "sentDateTime",
  "isRead",
  "hasAttachments",
  "internetMessageId",
  "isDraft",
  "lastModifiedDateTime",
].join(",");

/**
 * List recent messages (one Graph page). `folder` is a well-known name
 * (`inbox`, `sentitems`) or omitted for a mailbox-wide search. `folderId`
 * names one user folder and wins over `folder`.
 */
export async function listOutlookMessages(
  accessToken: string,
  options: {
    /** A well-known folder name. `deleteditems` is Outlook's Trash. */
    folder?: "inbox" | "sentitems" | "deleteditems" | "junkemail" | "archive";
    /** Graph id of a user folder (from `listOutlookMailFolders`). */
    folderId?: string;
    q?: string;
    top?: number;
    /** Full @odata.nextLink from a previous response, or a skiptoken value. */
    pageToken?: string;
  }
): Promise<{ messages: GraphMessage[]; nextPageToken?: string }> {
  const top = Math.min(options.top ?? 50, 100);
  if (options.pageToken?.startsWith("http")) {
    const data = await graphFetch<{
      value?: GraphMessage[];
      "@odata.nextLink"?: string;
    }>(accessToken, options.pageToken);
    return {
      messages: data.value ?? [],
      nextPageToken: data["@odata.nextLink"],
    };
  }

  const params = new URLSearchParams();
  params.set("$top", String(top));
  params.set("$select", MESSAGE_LIST_SELECT);
  params.set("$orderby", "receivedDateTime desc");
  if (options.pageToken) params.set("$skiptoken", options.pageToken);

  let path: string;
  const q = options.q?.trim();
  if (options.folderId) {
    // One user folder. $search works on the folder-scoped collection, so a
    // query inside a folder stays inside it without the KQL prefix below.
    if (q) {
      params.set("$search", `"${q.replace(/"/g, "")}"`);
      params.delete("$orderby");
    }
    path = `/me/mailFolders/${options.folderId}/messages?${params.toString()}`;
  } else if (q) {
    // $search is mailbox-wide; folder scoping uses KQL when browsing folders.
    const search = options.folder
      ? `folder:${options.folder === "sentitems" ? "sentitems" : "inbox"} ${q}`
      : q;
    params.set("$search", `"${search.replace(/"/g, "")}"`);
    // $search cannot combine with $orderby on many tenants.
    params.delete("$orderby");
    path = `/me/messages?${params.toString()}`;
  } else if (options.folder) {
    path = `/me/mailFolders/${options.folder}/messages?${params.toString()}`;
  } else {
    path = `/me/messages?${params.toString()}`;
  }

  const data = await graphFetch<{
    value?: GraphMessage[];
    "@odata.nextLink"?: string;
  }>(accessToken, path);
  return {
    messages: data.value ?? [],
    nextPageToken: data["@odata.nextLink"],
  };
}

/**
 * Collect up to `maxConversations` distinct conversation ids from recent
 * messages (newest first), hydrating only what's needed for the list.
 */
export async function listOutlookConversationSummaries(
  accessToken: string,
  options: {
    /** A well-known folder name. `deleteditems` is Outlook's Trash. */
    folder?: "inbox" | "sentitems" | "deleteditems" | "junkemail" | "archive";
    /** Graph id of a user folder; wins over `folder`. */
    folderId?: string;
    q?: string;
    maxConversations: number;
    pageToken?: string;
  }
): Promise<{
  conversations: {
    conversationId: string;
    latest: GraphMessage;
    /** First message seen in this page (search relevance order). */
    focusMessageId: string;
    unread: boolean;
    messageCount: number;
  }[];
  nextPageToken?: string;
}> {
  const page = await listOutlookMessages(accessToken, {
    folder: options.folder,
    folderId: options.folderId,
    q: options.q,
    top: Math.min(options.maxConversations * 2, 100),
    pageToken: options.pageToken,
  });

  const byConv = new Map<
    string,
    {
      latest: GraphMessage;
      /** First message seen (search relevance order) for deep-link. */
      focusMessageId: string;
      unread: boolean;
      messageCount: number;
    }
  >();
  for (const m of page.messages) {
    if (m.isDraft) continue;
    const cid = m.conversationId || m.id;
    const existing = byConv.get(cid);
    if (!existing) {
      byConv.set(cid, {
        latest: m,
        focusMessageId: m.id,
        unread: m.isRead === false,
        messageCount: 1,
      });
    } else {
      existing.messageCount += 1;
      if (m.isRead === false) existing.unread = true;
      const existingAt = Date.parse(
        existing.latest.receivedDateTime || existing.latest.sentDateTime || ""
      );
      const nextAt = Date.parse(m.receivedDateTime || m.sentDateTime || "");
      if (nextAt > existingAt) existing.latest = m;
    }
    if (byConv.size >= options.maxConversations) break;
  }

  return {
    conversations: [...byConv.entries()].map(([conversationId, v]) => ({
      conversationId,
      ...v,
    })),
    nextPageToken: page.nextPageToken,
  };
}

/**
 * Page of messages in a conversation (always returned oldest → newest).
 * - Default: newest `top`
 * - `beforeReceivedAt`: older page strictly before that timestamp
 *
 * There is no forward option here, on purpose. Graph answers this query
 * newest first and will not be told otherwise, so a "newer than X" filter
 * returns the newest page rather than the page above X. `listConversationAfter`
 * reaches forward by walking backward instead.
 */
function messageSortTime(m: GraphMessage): number {
  return Date.parse(m.receivedDateTime || m.sentDateTime || "") || 0;
}

/** Timestamps only. The walk below reads thousands of these; bodies wait. */
const CONVERSATION_TIME_SELECT = "id,receivedDateTime,sentDateTime,isDraft";

/**
 * One window of a conversation, newest first.
 *
 * Graph will not order a conversation query — `$orderby` beside a
 * `conversationId` filter is refused as an inefficient filter — and it answers
 * newest first. So a window is exact only when it is bounded from above:
 * `lt U` gives precisely the page below U. `gt X` gives the newest page, not
 * the page above X.
 */
async function conversationWindow(
  accessToken: string,
  conversationId: string,
  options: { gt?: string; lt?: string; top: number; withBody?: boolean }
): Promise<{ messages: GraphMessage[]; more: boolean }> {
  const escaped = conversationId.replace(/'/g, "''");
  const filters = [`conversationId eq '${escaped}'`];
  if (options.gt) {
    filters.push(`receivedDateTime gt ${options.gt.replace(/'/g, "")}`);
  }
  if (options.lt) {
    filters.push(`receivedDateTime lt ${options.lt.replace(/'/g, "")}`);
  }
  const params = new URLSearchParams({
    $filter: filters.join(" and "),
    $select: options.withBody
      ? `${MESSAGE_LIST_SELECT},body`
      : CONVERSATION_TIME_SELECT,
    $top: String(options.top + 1),
  });
  const data = await graphFetch<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?${params.toString()}`
  );
  const batch = (data.value ?? []).filter((m) => !m.isDraft);
  batch.sort((a, b) => messageSortTime(b) - messageSortTime(a));
  return { messages: batch.slice(0, options.top), more: batch.length > options.top };
}

/** How far forward paging will walk before it gives up. 100 per step. */
const FORWARD_WALK_STEPS = 20;

/**
 * The page of a conversation immediately after a timestamp.
 *
 * Asking Graph for "newer than X" returns the newest page of the
 * conversation, not the page above X, so on anything long it skips the
 * middle entirely. This reaches forward by walking backward, which is the
 * one direction Graph answers exactly.
 *
 * The walk carries timestamps only and stops as soon as a step reports
 * nothing further, which is the point where every message newer than X is
 * in hand. The oldest of those are the answer, and one last window — bounded
 * above by the first message we do not want — fetches them with their bodies.
 *
 * A conversation too long to walk raises rather than answering with a gap.
 */
export async function listConversationAfter(
  accessToken: string,
  conversationId: string,
  afterReceivedAt: string,
  top: number
): Promise<{ messages: GraphMessage[]; hasNewer: boolean }> {
  const want = Math.min(Math.max(top, 1), 100);
  const seen: GraphMessage[] = [];
  let upper: string | undefined;

  for (let step = 0; step < FORWARD_WALK_STEPS; step++) {
    const page = await conversationWindow(accessToken, conversationId, {
      gt: afterReceivedAt,
      lt: upper,
      top: 100,
    });
    seen.push(...page.messages);
    if (!page.more) {
      const ascending = seen.sort(
        (a, b) => messageSortTime(a) - messageSortTime(b)
      );
      if (!ascending.length) return { messages: [], hasNewer: false };
      // Bound the body fetch above by the first message we do not want, so
      // the window holds exactly the answer.
      const excluded = ascending[want];
      const boundary = excluded
        ? excluded.receivedDateTime || excluded.sentDateTime || undefined
        : undefined;
      const filled = await conversationWindow(accessToken, conversationId, {
        gt: afterReceivedAt,
        lt: boundary,
        top: want,
        withBody: true,
      });
      filled.messages.sort(
        (a, b) => messageSortTime(a) - messageSortTime(b)
      );
      return {
        messages: filled.messages,
        hasNewer: ascending.length > want,
      };
    }
    const oldest = page.messages[page.messages.length - 1];
    const mark = oldest?.receivedDateTime || oldest?.sentDateTime;
    if (!mark || mark === upper) break;
    upper = mark;
  }

  throw new Error(
    "This Outlook conversation is too long to page forward from here"
  );
}

export async function listConversationMessages(
  accessToken: string,
  conversationId: string,
  options?: {
    top?: number;
    beforeReceivedAt?: string;
  }
): Promise<{ messages: GraphMessage[]; hasOlder: boolean; hasNewer: boolean }> {
  const top = Math.min(Math.max(options?.top ?? 50, 1), 100);
  // Filter values with single quotes need doubling.
  const escaped = conversationId.replace(/'/g, "''");
  const filters = [`conversationId eq '${escaped}'`];
  if (options?.beforeReceivedAt) {
    const iso = options.beforeReceivedAt.replace(/'/g, "");
    filters.push(`receivedDateTime lt ${iso}`);
  }
  const params = new URLSearchParams({
    $filter: filters.join(" and "),
    $select: `${MESSAGE_LIST_SELECT},body`,
    $top: String(top + 1),
  });
  // Graph rejects $orderby together with conversationId ($filter) as
  // InefficientFilter — sort the page locally instead.
  const data = await graphFetch<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?${params.toString()}`
  );
  // A draft is not part of the conversation as it reads — it is the reply the
  // reader has not sent. `listOutlookConversationDrafts` asks for those.
  const batch = (data.value ?? []).filter((m) => !m.isDraft);
  batch.sort((a, b) => messageSortTime(b) - messageSortTime(a));
  const hasOlder = batch.length > top;
  const page = batch.slice(0, top);
  page.reverse();
  return { messages: page, hasOlder, hasNewer: false };
}

/**
 * Every unsent message in the mailbox, newest first.
 *
 * For the Drafts view. Capped: a mailbox with hundreds of abandoned drafts is
 * a list nobody reads, and the count beside it says how many there are.
 */
export async function listOutlookDraftMessages(
  accessToken: string,
  limit: number
): Promise<GraphMessage[]> {
  const params = new URLSearchParams({
    $filter: "isDraft eq true",
    $select: MESSAGE_LIST_SELECT,
    $orderby: "lastModifiedDateTime desc",
    $top: String(Math.min(Math.max(limit, 1), 100)),
  });
  const data = await graphFetch<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?${params.toString()}`
  );
  return data.value ?? [];
}

/**
 * The unsent replies Outlook holds for a conversation, newest last.
 *
 * Asked for on its own rather than picked out of a page of messages: a draft
 * only turns up in a page that happens to cover it, and the reader's draft is
 * not something to find by luck.
 */
export async function listOutlookConversationDrafts(
  accessToken: string,
  conversationId: string
): Promise<GraphMessage[]> {
  const escaped = conversationId.replace(/'/g, "''");
  const params = new URLSearchParams({
    $filter: `conversationId eq '${escaped}' and isDraft eq true`,
    $select: `${MESSAGE_LIST_SELECT},body`,
    $top: "10",
  });
  const data = await graphFetch<{ value?: GraphMessage[] }>(
    accessToken,
    `/me/messages?${params.toString()}`
  );
  return (data.value ?? []).sort(
    (a, b) => messageSortTime(a) - messageSortTime(b)
  );
}

/**
 * Delete a message. Used for a draft the reader has now sent from here, so
 * Outlook does not keep an unsent copy of a message that went out.
 */
export async function deleteOutlookMessage(
  accessToken: string,
  messageId: string
): Promise<void> {
  await graphFetch(accessToken, `/me/messages/${messageId}`, {
    method: "DELETE",
  });
}

/**
 * Delete a message for good. `DELETE` on a message only moves it to the
 * mailbox's recoverable items; `permanentDelete` removes it.
 */
export async function permanentlyDeleteOutlookMessage(
  accessToken: string,
  messageId: string
): Promise<void> {
  await graphFetch(accessToken, `/me/messages/${messageId}/permanentDelete`, {
    method: "POST",
  });
}

/**
 * Delete for good the messages of one conversation that are in one folder.
 * The folder is asked for by name, so a message of the same conversation
 * that is in another folder is never touched. Returns how many went. A
 * message already gone (404) is not a failure.
 *
 * The conversation is required. Without the filter this would list the whole
 * folder, and there is no "empty the folder" in this app on purpose.
 */
export async function purgeOutlookConversation(
  accessToken: string,
  folder: "deleteditems" | "junkemail",
  conversationId: string
): Promise<number> {
  if (!conversationId.trim()) throw new Error("A conversation is required");
  let removed = 0;
  const tried = new Set<string>();
  for (;;) {
    const params = new URLSearchParams({
      $select: "id",
      $top: "50",
      $filter: `conversationId eq '${conversationId.replace(/'/g, "''")}'`,
    });
    // Always the first page: what was deleted is no longer in it.
    const page = await graphFetch<{ value?: { id: string }[] }>(
      accessToken,
      `/me/mailFolders/${folder}/messages?${params.toString()}`
    );
    // A listing can lag behind a delete. An id that was tried once is not
    // tried again, so a slow listing ends the loop and cannot spin it.
    const ids = (page.value ?? []).map((m) => m.id).filter((id) => !tried.has(id));
    if (!ids.length) return removed;
    for (const id of ids) tried.add(id);
    const results = await Promise.allSettled(
      ids.map((id) => permanentlyDeleteOutlookMessage(accessToken, id))
    );
    const failed = results.filter(
      (r) =>
        r.status === "rejected" &&
        (r.reason as { status?: number } | null)?.status !== 404
    ).length;
    if (failed) {
      throw new Error(`Could not delete ${failed} of ${ids.length} messages`);
    }
    removed += ids.length;
  }
}

/** Single message with body (for centering a search hit). */
export async function getOutlookMessageFull(
  accessToken: string,
  messageId: string
): Promise<GraphMessage> {
  return graphFetch(
    accessToken,
    `/me/messages/${messageId}?$select=${MESSAGE_LIST_SELECT},body`
  );
}

/**
 * Out of office, as Graph models it.
 *
 * Two messages, not one: Outlook sends a different reply inside and outside
 * the organization, and can be told to send nothing outside at all. Gmail has
 * one message and a contacts-only switch, so the two do not map exactly — see
 * the conversion in `@/lib/mail/outlook-inbox`.
 *
 * Times carry their own zone. Graph rejects a bare timestamp.
 */
export type GraphAutomaticReplies = {
  status?: "disabled" | "alwaysEnabled" | "scheduled";
  externalAudience?: "none" | "contactsOnly" | "all";
  internalReplyMessage?: string;
  externalReplyMessage?: string;
  scheduledStartDateTime?: { dateTime: string; timeZone: string };
  scheduledEndDateTime?: { dateTime: string; timeZone: string };
};

export async function getOutlookAutomaticReplies(
  accessToken: string
): Promise<GraphAutomaticReplies> {
  const settings = await graphFetch<{
    automaticRepliesSetting?: GraphAutomaticReplies;
  }>(accessToken, "/me/mailboxSettings");
  return settings.automaticRepliesSetting ?? {};
}

export async function updateOutlookAutomaticReplies(
  accessToken: string,
  setting: GraphAutomaticReplies
): Promise<GraphAutomaticReplies> {
  const updated = await graphFetch<{
    automaticRepliesSetting?: GraphAutomaticReplies;
  }>(accessToken, "/me/mailboxSettings", {
    method: "PATCH",
    body: JSON.stringify({ automaticRepliesSetting: setting }),
  });
  return updated.automaticRepliesSetting ?? setting;
}

/**
 * Whether a conversation reads as unread.
 *
 * One unread message is enough. This is the rule the thread list is built on
 * — see the rollup in `listOutlookConversationSummaries` — and it is written
 * here so the rule that clears it can be checked against the same words.
 */
export function conversationIsUnread(
  messages: { isRead?: boolean }[]
): boolean {
  return messages.some((m) => m.isRead === false);
}

/** The messages that have to be patched before that rule reads false. */
export function unreadMessageIds<T extends { id: string; isRead?: boolean }>(
  messages: T[]
): string[] {
  return messages.filter((m) => m.isRead === false).map((m) => m.id);
}

export async function markOutlookMessageRead(
  accessToken: string,
  messageId: string,
  isRead = true
): Promise<void> {
  await graphFetch(accessToken, `/me/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ isRead }),
  });
}

/**
 * Move one message. Graph gives it a new id in the folder it goes to, and
 * answers with the moved message, so the new id comes back from here. The
 * move is noted for the sync: see `lib/mail/outlook-moves.ts`.
 */
export async function moveOutlookMessage(
  accessToken: string,
  messageId: string,
  destinationId: string
): Promise<string | null> {
  const moved = await graphFetch<{ id?: string } | undefined>(
    accessToken,
    `/me/messages/${messageId}/move`,
    {
      method: "POST",
      body: JSON.stringify({ destinationId }),
    }
  );
  const newId = moved?.id ?? null;
  noteOutlookMove(messageId, newId);
  return newId;
}

export type GraphMailFolder = {
  id: string;
  displayName?: string;
  parentFolderId?: string;
  childFolderCount?: number;
  totalItemCount?: number;
  /** Locale-independent name of a folder Outlook manages (`inbox`, `sentitems`, …). */
  wellKnownName?: string | null;
};

const MAIL_FOLDER_SELECT =
  "id,displayName,parentFolderId,childFolderCount,totalItemCount,wellKnownName";
/** Personal Outlook.com mailboxes reject `wellKnownName` in a $select. */
const MAIL_FOLDER_SELECT_BASIC =
  "id,displayName,parentFolderId,childFolderCount,totalItemCount";
/** Stop walking absurd trees rather than issue unbounded Graph requests. */
const MAIL_FOLDER_LIMIT = 1000;
/** Graph throttles a burst, and a mailbox can have many folders per level. */
const MAIL_FOLDER_CONCURRENCY = 4;

async function readFolderPages(
  accessToken: string,
  firstPath: string
): Promise<GraphMailFolder[]> {
  const out: GraphMailFolder[] = [];
  let next: string | undefined = firstPath;
  while (next) {
    const data: {
      value?: GraphMailFolder[];
      "@odata.nextLink"?: string;
    } = await graphFetch(accessToken, next);
    out.push(...(data.value ?? []));
    next = data["@odata.nextLink"];
  }
  return out;
}

/**
 * Every mail folder in the mailbox, parents before children.
 *
 * Graph cannot expand a folder tree to arbitrary depth, so this walks it one
 * level at a time. Hidden folders are left out (Graph omits them unless asked).
 */
/**
 * Mailboxes that have already refused `wellKnownName`.
 *
 * A personal outlook.com mailbox answers a `$select` naming it with 400. That
 * is handled — the retry drops the field — but the refusal was forgotten as
 * soon as the call returned, so every rebuild of the folder tree asked again
 * and put another red 400 in the console. Nothing was wrong, which is the
 * problem: a console with a standing error in it is one nobody reads.
 */
const noWellKnownName = new Set<string>();

export async function listOutlookMailFolders(
  accessToken: string,
  /** Which mailbox, so its answer is remembered rather than asked again. */
  accountKey?: string
): Promise<GraphMailFolder[]> {
  const mailbox = accountKey?.trim().toLowerCase() || "";
  let select =
    mailbox && noWellKnownName.has(mailbox)
      ? MAIL_FOLDER_SELECT_BASIC
      : MAIL_FOLDER_SELECT;

  const childrenOf = async (
    parentId: string | null
  ): Promise<GraphMailFolder[]> => {
    const base = parentId
      ? `/me/mailFolders/${parentId}/childFolders`
      : "/me/mailFolders";
    try {
      return await readFolderPages(
        accessToken,
        `${base}?$top=100&$select=${select}`
      );
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status !== 400 || select === MAIL_FOLDER_SELECT_BASIC) throw err;
      select = MAIL_FOLDER_SELECT_BASIC;
      if (mailbox) noWellKnownName.add(mailbox);
      return readFolderPages(
        accessToken,
        `${base}?$top=100&$select=${select}`
      );
    }
  };

  const all: GraphMailFolder[] = [];
  let level = await childrenOf(null);
  while (level.length) {
    all.push(...level);
    if (all.length >= MAIL_FOLDER_LIMIT) {
      console.warn(
        `[mail] Outlook folder tree hit the ${MAIL_FOLDER_LIMIT} folder limit — deeper folders are not listed.`
      );
      break;
    }
    const parents = level.filter((f) => (f.childFolderCount ?? 0) > 0);
    const nested: GraphMailFolder[] = [];
    for (let i = 0; i < parents.length; i += MAIL_FOLDER_CONCURRENCY) {
      const batch = parents.slice(i, i + MAIL_FOLDER_CONCURRENCY);
      const pages = await Promise.all(batch.map((f) => childrenOf(f.id)));
      nested.push(...pages.flat());
    }
    level = nested;
  }
  return all;
}

/** One folder by id, or by well-known name (`inbox`, `sentitems`, …). */
export async function getOutlookMailFolder(
  accessToken: string,
  idOrWellKnownName: string
): Promise<GraphMailFolder> {
  return graphFetch(
    accessToken,
    `/me/mailFolders/${idOrWellKnownName}?$select=${MAIL_FOLDER_SELECT_BASIC}`
  );
}

export async function createOutlookMailFolder(
  accessToken: string,
  displayName: string,
  parentFolderId?: string
): Promise<GraphMailFolder> {
  const base = parentFolderId
    ? `/me/mailFolders/${parentFolderId}/childFolders`
    : "/me/mailFolders";
  return graphFetch(accessToken, base, {
    method: "POST",
    body: JSON.stringify({ displayName }),
  });
}

export async function renameOutlookMailFolder(
  accessToken: string,
  folderId: string,
  displayName: string
): Promise<GraphMailFolder> {
  return graphFetch(accessToken, `/me/mailFolders/${folderId}`, {
    method: "PATCH",
    body: JSON.stringify({ displayName }),
  });
}

/**
 * Delete a folder.
 *
 * Graph puts it in Deleted Items with everything inside it — its mail and
 * its child folders — rather than destroying any of it. Which is the one
 * real difference from Gmail, where a label is only a name and taking it
 * off leaves every conversation where it was.
 */
export async function deleteOutlookMailFolder(
  accessToken: string,
  folderId: string
): Promise<void> {
  await graphFetch(accessToken, `/me/mailFolders/${folderId}`, {
    method: "DELETE",
  });
}

/** Re-parent a folder (Graph moves its children and mail with it). */
export async function moveOutlookMailFolder(
  accessToken: string,
  folderId: string,
  destinationId: string
): Promise<GraphMailFolder> {
  return graphFetch(accessToken, `/me/mailFolders/${folderId}/move`, {
    method: "POST",
    body: JSON.stringify({ destinationId }),
  });
}

export async function getOutlookMessageTimes(
  accessToken: string,
  messageId: string
): Promise<{ receivedDateTime?: string; sentDateTime?: string }> {
  return graphFetch(
    accessToken,
    `/me/messages/${messageId}?$select=receivedDateTime,sentDateTime`
  );
}

/**
 * Move every message in a conversation (best-effort per message).
 * `destinationId` is a well-known name or a user folder id.
 */
export async function moveOutlookConversation(
  accessToken: string,
  conversationId: string,
  destinationId: string
): Promise<void> {
  let beforeReceivedAt: string | undefined;
  /*
    A move that failed must be said to have failed.

    Every per-message error was swallowed here, so a conversation whose
    messages all refused to move still resolved — the app said "moved to
    Trash", forgot the thread, and the mailbox had not changed. The reader
    found the mail back on the next open and rightly stopped trusting the
    button. A message already gone (404) is not a failure: a retried or
    half-done move finds some messages moved by the earlier attempt.
  */
  let failed = 0;
  let total = 0;
  for (;;) {
    const page = await listConversationMessages(accessToken, conversationId, {
      top: 50,
      beforeReceivedAt,
    });
    total += page.messages.length;
    const results = await Promise.allSettled(
      page.messages.map((m) =>
        moveOutlookMessage(accessToken, m.id, destinationId)
      )
    );
    for (const r of results) {
      if (r.status === "rejected") {
        const status = (r.reason as { status?: number } | null)?.status;
        if (status !== 404) failed += 1;
      }
    }
    if (!page.hasOlder || page.messages.length === 0) break;
    beforeReceivedAt =
      page.messages[0].receivedDateTime || page.messages[0].sentDateTime;
    if (!beforeReceivedAt) break;
  }
  if (failed) {
    throw new Error(
      `Could not move ${failed} of ${total} messages in the conversation`
    );
  }
}

/**
 * What a message carries, without the bytes.
 *
 * `contentId` is deliberately not asked for, however much the inline pictures
 * want it. Graph types this collection as `attachment`, and `contentId`
 * belongs to `fileAttachment` underneath it, so naming it in a `$select` is
 * answered with 400 — "Could not find a property named 'contentId' on type
 * 'microsoft.graph.attachment'". Both readers of this caught that and carried
 * on with nothing, so an Outlook mail with a file showed no file and one with
 * a picture in the body showed a gap. Asking for no `$select` at all works and
 * returns `contentBytes` with every attachment, which is a megabyte a message
 * for the privilege. `resolveOutlookInlineImages` reads the content id off the
 * one request that has to fetch the bytes anyway.
 */
const ATTACHMENT_META_SELECT = "id,name,contentType,size,isInline";

/** A message in a folder's delta reply, or the id of one that left it. */
export type GraphDeltaEntry =
  | { kind: "message"; message: GraphMessage }
  | { kind: "removed"; id: string };

/**
 * One page of a folder's changes since the last delta link, or its whole
 * contents the first time. Bodies come as HTML. The reply ends with either
 * a next link (more pages) or a delta link (done; keep it for next time).
 */
export async function listOutlookFolderDelta(
  accessToken: string,
  folderId: string,
  link?: string | null
): Promise<{ entries: GraphDeltaEntry[]; nextLink?: string; deltaLink?: string }> {
  const select = [
    "id",
    "conversationId",
    "subject",
    "bodyPreview",
    "body",
    "from",
    "toRecipients",
    "ccRecipients",
    "bccRecipients",
    "receivedDateTime",
    "sentDateTime",
    "isRead",
    "hasAttachments",
    "internetMessageId",
    "parentFolderId",
    "isDraft",
    "lastModifiedDateTime",
    "flag",
  ].join(",");
  const path =
    link && link.startsWith("http")
      ? link
      : `/me/mailFolders/${encodeURIComponent(folderId)}/messages/delta?$select=${select}&$top=100`;
  const data = await graphFetch<{
    value?: (GraphMessage & { "@removed"?: { reason?: string }; flag?: { flagStatus?: string } })[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
  }>(accessToken, path, { headers: { Prefer: 'outlook.body-content-type="html"' } });
  const entries: GraphDeltaEntry[] = (data.value ?? []).map((m) =>
    m["@removed"] ? { kind: "removed", id: m.id } : { kind: "message", message: m }
  );
  return { entries, nextLink: data["@odata.nextLink"], deltaLink: data["@odata.deltaLink"] };
}

export async function listOutlookAttachmentMeta(
  accessToken: string,
  messageId: string
): Promise<GraphAttachment[]> {
  const data = await graphFetch<{ value?: GraphAttachment[] }>(
    accessToken,
    `/me/messages/${messageId}/attachments?$select=${ATTACHMENT_META_SELECT}`
  );
  return data.value ?? [];
}

export async function listOutlookFileAttachments(
  accessToken: string,
  messageId: string
): Promise<GraphAttachment[]> {
  const all = await listOutlookAttachmentMeta(accessToken, messageId);
  // Inline parts are the pictures inside the body, not files to list beside
  // it. `resolveOutlookInlineImages` is what puts those back in the body.
  return all.filter((a) => !a.isInline);
}

/** The query these two send, so a suite can hold it to what Graph accepts. */
export const OUTLOOK_ATTACHMENT_META_QUERY = `$select=${ATTACHMENT_META_SELECT}`;

/** Per image, and per message. The same limits the Gmail side applies. */
const MAX_INLINE_IMAGE_BYTES = 1_500_000;
const MAX_INLINE_TOTAL_BYTES = 5_000_000;

/** A content id without the angle brackets Graph sometimes keeps. */
export function contentIdOf(attachment: GraphAttachment): string | null {
  const cid = attachment.contentId?.trim().replace(/^<|>$/g, "");
  return cid ? cid : null;
}

/**
 * Every content id a body asks for, read out of its `src` attributes.
 *
 * Looking for the whole `cid:something` as a substring is not the same thing,
 * and got both ends wrong. `cid:abc` is a substring of `cid:abc123`, so a
 * picture could be matched to the wrong part; and the scheme is written in
 * whatever case the sending client felt like, while a plain `includes` only
 * ever accepted lower case.
 */
export function referencedContentIds(bodyHtml: string): Set<string> {
  const out = new Set<string>();
  // `originalsrc` as well as `src`: Outlook moves the content id there when it
  // puts its own blob URL in `src`, so a body that has plainly got a picture
  // in it can have no `src="cid:…"` anywhere.
  const pattern =
    /\b(?:original)?src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  for (const match of bodyHtml.matchAll(pattern)) {
    const src = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const cid = /^cid:(.+)$/i.exec(src)?.[1];
    if (cid) out.add(cid.replace(/^<|>$/g, ""));
  }
  return out;
}

/** True when a body has a picture in it that has to be fetched separately. */
export function bodyHasInlineImage(bodyHtml: string | undefined): boolean {
  if (!bodyHtml) return false;
  return referencedContentIds(bodyHtml).size > 0;
}

/**
 * The inline pictures a body actually asks for.
 *
 * An inline part nothing references is a file rather than a picture, and the
 * attachment list already carries it — fetching it here would download it
 * twice and show it in two places.
 */
export function inlineImagesReferencedBy(
  attachments: GraphAttachment[],
  bodyHtml: string
): GraphAttachment[] {
  const wanted = referencedContentIds(bodyHtml);
  // Content ids are case-sensitive in the standard and not always in practice.
  const lower = new Set([...wanted].map((c) => c.toLowerCase()));
  return attachments.filter((attachment) => {
    if (!attachment.isInline) return false;
    if (!attachment.contentType?.startsWith("image/")) return false;
    const cid = contentIdOf(attachment);
    if (!cid) return false;
    return wanted.has(cid) || lower.has(cid.toLowerCase());
  });
}

/**
 * The pictures embedded in an Outlook message body, as data URLs by their
 * content id.
 *
 * A body writes `<img src="cid:something">` and the bytes arrive as a separate
 * inline attachment. Without this the reader sanitizes the body, finds no
 * picture behind the cid, and drops the img — which is a message with a hole
 * in it. A forwarded phone photo is the common case.
 *
 * Resolving these is privacy-safe, unlike remote images: the bytes are already
 * in the message, and fetching them tells nobody anything.
 */
export async function resolveOutlookInlineImages(
  accessToken: string,
  messageId: string,
  bodyHtml: string,
  /** Already listed by the caller, so one message needs one listing. */
  knownMeta?: GraphAttachment[]
): Promise<Record<string, string>> {
  const all = knownMeta ?? (await listOutlookAttachmentMeta(accessToken, messageId));

  /**
   * Every inline picture small enough to carry, before we know which the body
   * asks for. The content id says that, and it only arrives with the bytes —
   * so a picture the body never mentions is fetched and then dropped. The
   * per-picture ceiling is what keeps that from mattering; an inline part
   * nothing references is rare, and a wasted request is better than the hole
   * the reader used to see.
   */
  const candidates = all.filter(
    (a) =>
      a.isInline &&
      a.contentType?.startsWith("image/") &&
      (a.size ?? 0) <= MAX_INLINE_IMAGE_BYTES
  );

  const fetched = await Promise.all(
    candidates.map(async (attachment) => {
      try {
        const full = await graphFetch<{
          contentBytes?: string;
          contentId?: string;
        }>(accessToken, `/me/messages/${messageId}/attachments/${attachment.id}`);
        if (!full.contentBytes) return null;
        return {
          ...attachment,
          contentId: full.contentId,
          contentBytes: full.contentBytes,
        };
      } catch {
        // A missing attachment just leaves that one picture out.
        return null;
      }
    })
  );

  const wanted = inlineImagesReferencedBy(
    fetched.filter((a): a is NonNullable<typeof a> => a !== null),
    bodyHtml
  );

  const out: Record<string, string> = {};
  let total = 0;
  for (const attachment of wanted) {
    const base64 = (attachment as { contentBytes?: string }).contentBytes;
    const cid = contentIdOf(attachment);
    if (!base64 || !cid) continue;
    if (total + base64.length > MAX_INLINE_TOTAL_BYTES) continue;
    total += base64.length;
    out[cid] = `data:${attachment.contentType};base64,${base64}`;
  }
  return out;
}

export async function getOutlookAttachmentBytes(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<Uint8Array> {
  const data = await graphFetch<{ contentBytes?: string }>(
    accessToken,
    `/me/messages/${messageId}/attachments/${attachmentId}`
  );
  if (!data.contentBytes) throw new Error("Attachment had no content");
  return base64ToBytes(data.contentBytes);
}

/**
 * The message as MIME text: Graph's `$value`. It is not JSON, so graphFetch
 * hands it over under `raw`.
 */
export async function getOutlookMessageSource(
  accessToken: string,
  messageId: string
): Promise<string> {
  const data = await graphFetch<{ raw?: string } | string | undefined>(
    accessToken,
    `/me/messages/${messageId}/$value`,
    { headers: { Accept: "text/plain, */*" } }
  );
  const text = typeof data === "string" ? data : data?.raw;
  if (!text) throw new Error("Outlook sent the message without its source");
  return text;
}

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

export function graphAddress(r?: GraphRecipient): {
  email: string;
  name: string;
} {
  const email = (r?.emailAddress?.address ?? "").trim().toLowerCase();
  const name = (r?.emailAddress?.name ?? "").trim();
  return { email, name };
}

export function graphAddresses(list?: GraphRecipient[]): {
  email: string;
  name: string;
}[] {
  return (list ?? []).map(graphAddress).filter((a) => a.email);
}

// ---------------------------------------------------------------------------
// Contacts (read-only mirror for compose suggestions; needs Contacts.Read)
// ---------------------------------------------------------------------------

export type GraphContact = {
  /** Graph's id for the contact: the card two addresses may share. */
  id?: string;
  displayName?: string;
  emailAddresses?: { address?: string; name?: string }[];
};

/** One page of the account's Outlook contacts. */
export async function listOutlookContacts(
  accessToken: string,
  pageToken?: string
): Promise<{ contacts: GraphContact[]; nextPageToken?: string }> {
  const path =
    pageToken ??
    `/me/contacts?${new URLSearchParams({
      $select: "id,displayName,emailAddresses",
      $top: "100",
    }).toString()}`;
  const data = await graphFetch<{
    value?: GraphContact[];
    "@odata.nextLink"?: string;
  }>(accessToken, path);
  return {
    contacts: data.value ?? [],
    nextPageToken: data["@odata.nextLink"],
  };
}
