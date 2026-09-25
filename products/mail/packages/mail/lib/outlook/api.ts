/*
 * The Outlook mailbox through Microsoft Graph: messages and conversations,
 * drafts, delete, read and unread, moves, folders, the delta a sync reads,
 * automatic replies, and contacts.
 *
 * The parts beside this one:
 *
 *   graph.ts        one request: a few at a time per mailbox, with retries
 *   attachments.ts  a message's files, its inline pictures, its source
 *   send.ts         drafts sent, messages sent now or at a time
 */

import "server-only";
import { noteOutlookMove } from "@/lib/mail/outlook-moves";
import { graphFetch } from "@/lib/outlook/graph";

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

export const MESSAGE_LIST_SELECT = [
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
