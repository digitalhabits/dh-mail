/**
 * Answers `/api/mail/*` inside the app, with no server.
 *
 * The planner serves these paths from Next route handlers. This product has no
 * server, so the same paths route straight to the mail core running in this
 * webview. To-Do does the same thing in `standalone-api.ts`.
 *
 * The paths are the contract, not an implementation detail: the user interface
 * calls the same strings on every host, and only the transport differs.
 */

import { trackMailWrite } from "./pending-writes";
import {
  archiveMailThread,
  getMailThread,
  listSnoozedThreads,
  listUnifiedInbox,
  markMailThreadUnread,
  snoozeMailThread,
  trashMailThread,
  unarchiveMailThread,
  unsnoozeMailThread,
  untrashMailThread,
  deleteMailThreadForever,
} from "@/lib/mail/inbox";
import { discardProviderDraft, markMailThreadRead } from "@/lib/mail/inbox";
import {
  listMailAutoReplies,
  setMailAutoReply,
} from "@/lib/mail/mail-autoreply";
import { countActiveSnoozes } from "@/lib/mail/mail-snooze-count";
import {
  createMailFolder,
  deleteMailFolder,
  listMailFolders,
  renameMailFolder,
  moveMailThreadToFolder,
  unmoveMailThreadFromFolder,
} from "@/lib/mail/folders";
import { asMailFolderView } from "@/lib/mail/folder-views";
import {
  createMailContactList,
  deleteMailContactList,
  listMailContactLists,
  updateMailContactList,
} from "@/lib/mail/contact-lists";
import {
  hasStaleCopyHistory,
  hasUnsyncedContactSources,
  hideHistorySuggestion,
  listContactSourceStatuses,
  listMergedMailContacts,
  setContactSourceEnabled,
  syncAllContactSources,
} from "@/lib/mail/contact-sources";
import { fetchMailAttachment, fetchMailMessageSource } from "@/lib/mail/inbox";
import { mailStore } from "@/lib/mail/store";
import {
  ATTACHMENT_SNIFF_HEADERS,
  attachmentContentDisposition,
  safeAttachmentMimeType,
} from "@/lib/mail/attachment-mime";
import {
  getSenderNameSettings,
} from "@/lib/mail/sender-identity";
import {
  getMailSignatureSettings,
  setMailSignatureSettings,
} from "@/lib/mail/settings";
import {
  ensureThreadConversation,
  getChatForThread,
  listChatParts,
  prepareChatSend,
  recordChatSend,
  setThreadChatStyle,
} from "@/lib/mail/chats";
import { chatTitleFromCounterpart } from "@/lib/mail/chat-types";
import {
  listProviderDrafts,
  markMailThreadJunk,
  markMailThreadNotJunk,
  draftMailInOutlook,
  sendMailMessage,
  listScheduledMailMessages,
  listAllScheduledMailMessages,
  cancelScheduledMailMessage,
  sendScheduledMailMessageNow,
} from "@/lib/mail/inbox";
import { listConnectedMailAccounts } from "@/lib/mail/providers";
import { invalidateMailCaches, invalidateInboxCache } from "@/lib/mail/inbox-cache";
import {
  deleteGmailAccount,
  listGmailAccounts,
  reorderGmailAccounts,
  setAccountInMailTab,
} from "@/lib/gmail/accounts";
import {
  deleteOutlookAccount,
  listOutlookAccounts,
  reorderOutlookAccounts,
  setOutlookAccountInMailTab,
} from "@/lib/outlook/accounts";
import {
  MAIL_PUBLIC_AI_DISABLED_MESSAGE,
  MAIL_PUBLIC_CRM_DISABLED_MESSAGE,
  mailOrgAiAllowed,
  mailUsesCrmPeople,
} from "@/lib/mail/product-flavor";
import { PlanError } from "@/lib/plan/errors";

import { loadCachedMailThread } from "@/lib/mail/thread-cache";
import { connectConfigError } from "./oauth-config";
import { plannerJson } from "./planner-api";
import { stopLocalStoreSync } from "./local-store";

/** Single user, so every call is for the same owner. */
const OWNER_ID = "local";

/**
 * The thread as the planner's CRM functions read it. The pane holds the
 * thread; the planner has no mailbox token to load one with, so it goes in
 * the request. Bodies are cut: the server cuts them again for the model, and
 * an attachment-heavy thread should not travel whole.
 *
 * The copy on screen first. A thread that is open, or was warmed for the
 * list, is in the thread cache, and that copy is what the reader is looking
 * at when they ask. This used to go to the provider again, twice for one
 * proposal, and after a mailbox rebuild that was the request that met
 * Gmail's per-minute quota and failed the whole dialog. The provider is
 * asked only when the cache has nothing.
 */
async function threadForPlanner(account: string, threadId: string) {
  const cached = await loadCachedMailThread(account, threadId);
  const thread =
    cached?.thread ??
    (await getMailThread(account, threadId, { limit: 50, markRead: false }));
  return {
    subject: thread.subject,
    messages: thread.messages.map((m) => ({
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      toEmails: m.toEmails,
      ccEmails: m.ccEmails,
      sentAt: m.sentAt,
      own: m.own,
      bodyText: (m.bodyText || "").slice(0, 8000),
    })),
  };
}

/** What the composer sends. Mirrors the planner route's schema. */
type SendInput = {
  account: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  html?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  includeSignature?: boolean;
  messageCount?: number;
  noQuote?: boolean;
  chatMode?: boolean;
  startChat?: boolean;
  forward?: Parameters<typeof sendMailMessage>[0]["forward"];
  quote?: Parameters<typeof sendMailMessage>[0]["quote"];
  appendix?: Parameters<typeof sendMailMessage>[0]["appendix"];
  attachments?: Parameters<typeof sendMailMessage>[0]["attachments"];
  /** A provider draft this send replaces; discarded once the mail is away. */
  discardProviderDraft?: string;
  /** Hold until this time (ISO 8601). Outlook only — see sendMailMessage. */
  sendAt?: string;
  /** Put a note on the matching CRM records after the send. Team layer only. */
  updateCrmNotes?: boolean;
};

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * An error, with the status the core meant.
 *
 * The core says what went wrong by throwing a PlanError carrying a status, and
 * the planner's route helper passes it through. Flattening every one of those
 * to 500 would turn "not found" and "not allowed" into "something broke".
 */
function failed(error: unknown, status?: number): Response {
  const message = error instanceof Error ? error.message : String(error);
  const fromError =
    error instanceof PlanError && error.status >= 400 ? error.status : undefined;
  return new Response(JSON.stringify({ error: message }), {
    status: status ?? fromError ?? 500,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Routes one path to the core. Unknown paths say so, with the path.
 *
 * A mutating call is counted while it runs, so the shell can hold a
 * closing window until the mailbox has actually been told. See
 * `pending-writes.ts`.
 */
export function handleStandaloneMailApi(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const work = routeStandaloneMailApi(path, init);
  return method === "GET" ? work : trackMailWrite(work);
}

/** What a route gets: the request, taken apart once. */
type RouteContext = {
  url: URL;
  q: URLSearchParams;
  method: string;
  init?: RequestInit;
  /** The JSON body, or an empty object when there is none. */
  body: <T>() => Promise<T>;
};

type Route = (ctx: RouteContext) => Promise<Response>;

async function routeStandaloneMailApi(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(path, "http://local.invalid");
  const q = url.searchParams;
  const method = (init?.method ?? "GET").toUpperCase();
  const body = async <T>(): Promise<T> =>
    init?.body ? (JSON.parse(String(init.body)) as T) : ({} as T);

  const route = STANDALONE_MAIL_ROUTES[url.pathname];
  if (!route) return failed(`No local handler for ${url.pathname} yet`, 501);
  // Awaited, so that a route's error comes back as a failed answer, as the
  // switch did.
  try {
    return await route({ url, q, method, init, body });
  } catch (error) {
    return failed(error);
  }
}

async function threads({ q }: RouteContext): Promise<Response> {
  const result = await listUnifiedInbox({
    clerkUserId: OWNER_ID,
    account: q.get("account") ?? undefined,
    // The closed set lives in one place now — see folder-views.
    folder: asMailFolderView(q.get("folder")),
    label: q.get("label") ?? undefined,
    q: q.get("q") ?? undefined,
    includeDeleted: q.get("includeDeleted") === "1",
    cursor: q.get("cursor") ?? undefined,
    fresh: q.get("fresh") === "1",
    incremental: q.get("incremental") === "1",
  });
  return ok({ success: true, ...result });
}

async function thread({ q }: RouteContext): Promise<Response> {
  const account = q.get("account");
  const id = q.get("id");
  if (!account || !id) return failed("account and id are required", 400);
  const count = Number(q.get("count"));
  const rawLimit = Number(q.get("limit"));
  const thread = await getMailThread(account, id, {
    before: q.get("before") ?? undefined,
    after: q.get("after") ?? undefined,
    around: q.get("around") ?? undefined,
    // The oldest page, for the header's "started" peek and the jump.
    oldest: q.get("oldest") === "1",
    limit:
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 100)
        : undefined,
    markRead: q.get("markRead") !== "0",
    messageCountHint:
      Number.isFinite(count) && count > 0 ? count : undefined,
  });
  return ok({ success: true, thread });
}

/** Messages the provider is holding for a thread, and the two ways out. */
async function scheduled({ q, method, body }: RouteContext): Promise<Response> {
  if (method === "GET") {
    const account = q.get("account");
    const threadId = q.get("threadId");
    // No account named: everything held, for the group at the top of
    // the list. One thread named: just that conversation.
    const messages = account
      ? await listScheduledMailMessages({
          account,
          threadId: threadId ?? undefined,
        })
      : await listAllScheduledMailMessages({ clerkUserId: OWNER_ID });
    return ok({ success: true, messages });
  }
  if (method === "POST") {
    const input = await body<{
      account?: string;
      id?: string;
      action?: "cancel" | "sendNow";
    }>();
    if (!input.account || !input.id) {
      return failed("account and id are required", 400);
    }
    if (input.action === "sendNow") {
      await sendScheduledMailMessageNow({
        account: input.account,
        id: input.id,
      });
    } else {
      await cancelScheduledMailMessage({
        account: input.account,
        id: input.id,
      });
    }
    return ok({ success: true });
  }
  return failed("method not allowed", 405);
}

async function folders({ q, method, body }: RouteContext): Promise<Response> {
  // The provider work is in the core and is the same for both hosts —
  // Gmail renames the label, Graph renames the folder. Only the wiring
  // was missing here, which is why Rename looked available and was not.
  if (method === "POST") {
    const input = await body<{ name?: string; account?: string }>();
    if (!input.name?.trim()) {
      return failed("A folder name is required", 400);
    }
    const folder = await createMailFolder({
      name: input.name,
      account: input.account,
      clerkUserId: OWNER_ID,
    });
    return ok({ folder });
  }
  if (method === "PATCH") {
    const input = await body<{
      name?: string;
      newName?: string;
      account?: string;
    }>();
    if (!input.name?.trim() || !input.newName?.trim()) {
      return failed("Both the old and the new name are required", 400);
    }
    const folder = await renameMailFolder({
      name: input.name,
      newName: input.newName,
      account: input.account,
      clerkUserId: OWNER_ID,
    });
    return ok({ folder });
  }
  if (method === "DELETE") {
    const input = await body<{ name?: string; account?: string }>();
    if (!input.name?.trim()) {
      return failed("A folder name is required", 400);
    }
    // Named account only, the way the rename is: a row in the rail
    // stands under one heading, and means that mailbox's folder.
    // The two providers differ in what deleting means, and the core
    // knows which is which — Gmail takes a label off its
    // conversations and leaves them in All Mail, Graph moves the
    // folder into Deleted Items with everything inside it.
    const deleted = await deleteMailFolder({
      name: input.name,
      account: input.account,
      clerkUserId: OWNER_ID,
    });
    return ok(deleted);
  }
  if (method !== "GET") {
    return failed(`${method} on folders is not built yet`, 501);
  }
  const folders = await listMailFolders({
    clerkUserId: OWNER_ID,
    account: q.get("account") ?? undefined,
  });
  return ok({ folders });
}

async function drafts({ q, method }: RouteContext): Promise<Response> {
  if (method !== "GET") {
    return failed(`${method} on drafts is not built yet`, 501);
  }
  const only = q.get("account");
  const accounts = only
    ? [only]
    : (await listConnectedMailAccounts(OWNER_ID)).map((a) => a.email);
  // One unreachable mailbox must not empty the whole list.
  const perAccount = await Promise.all(
    accounts.map((account) =>
      listProviderDrafts(account).catch((err) => {
        console.warn(`[mail] drafts failed for ${account}:`, err);
        return [];
      })
    )
  );
  const drafts = perAccount
    .flat()
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return ok({ drafts });
}

/** /api/mail/archive, /api/mail/unarchive, /api/mail/trash, /api/mail/untrash, /api/mail/junk, /api/mail/not-junk, /api/mail/unread. */
async function moveThread({ url, body }: RouteContext): Promise<Response> {
  const input = await body<{ account: string; threadId: string }>();
  if (!input.account || !input.threadId) {
    return failed("account and threadId are required", 400);
  }
  const act = {
    "/api/mail/archive": archiveMailThread,
    "/api/mail/unarchive": unarchiveMailThread,
    "/api/mail/trash": trashMailThread,
    "/api/mail/untrash": untrashMailThread,
    "/api/mail/junk": markMailThreadJunk,
    "/api/mail/not-junk": markMailThreadNotJunk,
    "/api/mail/unread": markMailThreadUnread,
  }[url.pathname]!;
  // The owner is passed so the ones that take a thread out of the inbox
  // can drop it from the stored list page too. The others ignore it.
  await act(input.account, input.threadId, OWNER_ID);
  return ok({ success: true });
}

// Not undoable. The page asks the reader before it calls this.
async function deleteForever({ body }: RouteContext): Promise<Response> {
  const input = await body<{ account: string; threadId: string; from: string }>();
  if (!input.account || !input.threadId) {
    return failed("account and threadId are required", 400);
  }
  if (input.from !== "trash" && input.from !== "junk") {
    return failed("from must be trash or junk", 400);
  }
  await deleteMailThreadForever(input.account, input.threadId, input.from);
  return ok({ success: true });
}

async function snooze({ body }: RouteContext): Promise<Response> {
  const input = await body<{
    account: string;
    threadId: string;
    until: string;
  }>();
  await snoozeMailThread(input.account, input.threadId, input.until);
  return ok({ success: true });
}

async function unsnooze({ body }: RouteContext): Promise<Response> {
  const input = await body<{ account: string; threadId: string }>();
  await unsnoozeMailThread(input.account, input.threadId);
  return ok({ success: true });
}

async function snoozed({ q }: RouteContext): Promise<Response> {
  if (q.get("countOnly") === "1") {
    const count = await countActiveSnoozes({
      clerkUserId: OWNER_ID,
      account: q.get("account") ?? undefined,
    });
    return ok({ success: true, count });
  }
  const result = await listSnoozedThreads({
    clerkUserId: OWNER_ID,
    account: q.get("account") ?? undefined,
    q: q.get("q") ?? undefined,
  });
  return ok({ success: true, ...result });
}

async function contacts(_: RouteContext): Promise<Response> {
  const contacts = await listMergedMailContacts(OWNER_ID);
  return ok({ contacts, sources: [] });
}

async function signature({ q, method, body }: RouteContext): Promise<Response> {
  if (method === "GET") {
    const account = q.get("account");
    if (!account) return failed("account is required", 400);
    return ok(await getMailSignatureSettings(account));
  }
  const { account, ...settings } = await body<{
    account: string;
    signature: string;
    includeOnNew: boolean;
    onReplies: "never" | "first" | "every";
  }>();
  await setMailSignatureSettings(account, settings);
  return ok({ ok: true });
}

// Read only: the provider owns the name, and Mail keeps none of its own.
async function senderName({ q }: RouteContext): Promise<Response> {
  const account = q.get("account");
  if (!account) return failed("account is required", 400);
  return ok(await getSenderNameSettings(account));
}

/**
* Sending, mirroring the planner route step for step.
*
* The one thing left out is the CRM note it writes afterwards, which
* belongs to a layer this build does not have.
*
* A conversation binding can rotate to a new provider thread mid-send, so
* the thread the message goes to is the one prepareChatSend names, not
* the one the composer started from.
*/
/*
Finish this one in Outlook.

The draft is made in the mailbox rather than in a file: a file handed
to Outlook opens as a preview of a message, not as a message being
written. In Drafts it is editable, formatted, and in the conversation
it answers — and Outlook is already watching that folder.
*/
async function outlookDraft({ body }: RouteContext): Promise<Response> {
  const input = await body<SendInput>();
  // To, Cc or Bcc — a message addressed only in Bcc is a message,
  // and it is the one a course list is sent as.
  if (
    !input.account ||
    !(input.to?.length || input.cc?.length || input.bcc?.length)
  ) {
    return failed("account and at least one recipient are required", 400);
  }
  const draft = await draftMailInOutlook({
    account: input.account,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    html: input.html,
    includeSignature: input.includeSignature,
    threadId: input.threadId,
    appendix: input.appendix,
    attachments: input.attachments,
  });
  return ok({ draft });
}

async function send({ body }: RouteContext): Promise<Response> {
  const input = await body<SendInput>();
  // To, Cc or Bcc — a message addressed only in Bcc is a message,
  // and it is the one a course list is sent as.
  if (
    !input.account ||
    !(input.to?.length || input.cc?.length || input.bcc?.length)
  ) {
    return failed("account and at least one recipient are required", 400);
  }
  const wantNoQuote = Boolean(
    input.noQuote || input.chatMode || input.startChat
  );

  // A new message with chat style on: send it, then remember the
  // choice. A chat is a conversation with somebody named on it, so a
  // message with nobody in To goes as an ordinary one.
  if (input.startChat && input.to?.length) {
    const counterpartEmail = input.to[0]!;
    const title = chatTitleFromCounterpart("", counterpartEmail);
    const sent = await sendMailMessage({
      account: input.account,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject,
      body: input.body,
      html: input.html,
      attachments: input.attachments,
      discardProviderDraft: input.discardProviderDraft,
      includeSignature: false,
    });
    if (!sent.threadId) {
      return ok({ success: true, chat: null, rotated: false });
    }
    const chat = await ensureThreadConversation({
      account: input.account,
      threadId: sent.threadId,
      title,
      subject: input.subject,
      counterpartName: title,
      counterpartEmail,
      participantEmails: input.to,
      messageCount: 1,
      noQuote: true,
    });
    return ok({
      success: true,
      chat,
      threadId: sent.threadId,
      messageId: sent.messageId,
      rotated: false,
    });
  }

  if (input.threadId) {
    let bound = await getChatForThread(input.account, input.threadId);
    // A thread long enough to need parts gets bound even without chat
    // style, so it can rotate before it becomes slow in every client.
    const shouldBindForParts = !bound && (input.messageCount ?? 0) >= 1000;
    if (!bound && (wantNoQuote || shouldBindForParts)) {
      bound = await ensureThreadConversation({
        account: input.account,
        threadId: input.threadId,
        subject: input.subject,
        counterpartName: "",
        counterpartEmail: input.to[0] ?? "",
        participantEmails: input.to,
        messageCount: input.messageCount,
        noQuote: wantNoQuote,
      });
    }

    if (bound) {
      const prep = await prepareChatSend({
        account: input.account,
        threadId: input.threadId,
      });
      const noQuote = wantNoQuote || prep.chat.noQuote;
      const sent = await sendMailMessage({
        account: input.account,
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: prep.subject,
        body: input.body,
        html: input.html,
        forward: input.forward,
        attachments: input.attachments,
        discardProviderDraft: input.discardProviderDraft,
        quote: noQuote ? undefined : input.quote,
        appendix: noQuote ? undefined : input.appendix,
        threadId: prep.sendThreadId ?? undefined,
        inReplyTo: prep.sendThreadId ? input.inReplyTo : undefined,
        references: prep.sendThreadId ? input.references : undefined,
        // Whatever the composer asked for. Chat style used to force the
    // signature off here, which quietly undid the composer's own
    // choice: leaving the history out says nothing about signing.
    includeSignature: input.includeSignature,
      });
      const bindThreadId = sent.threadId || prep.sendThreadId;
      if (!bindThreadId) {
        return ok({
          success: true,
          chat: prep.chat,
          rotated: prep.rotated,
        });
      }
      const chat = await recordChatSend({
        account: input.account,
        chatId: prep.chat.chatId,
        subject: prep.subject,
        providerThreadId: bindThreadId,
        tipMessageId: sent.messageId,
      });
      return ok({
        success: true,
        chat,
        threadId: bindThreadId,
        messageId: sent.messageId,
        rotated: prep.rotated,
      });
    }
  }

  await sendMailMessage({
    account: input.account,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    html: input.html,
    threadId: input.threadId,
    inReplyTo: input.inReplyTo,
    references: input.references,
    forward: input.forward,
    attachments: input.attachments,
    discardProviderDraft: input.discardProviderDraft,
    quote: wantNoQuote ? undefined : input.quote,
    appendix: wantNoQuote ? undefined : input.appendix,
    includeSignature: input.includeSignature,
    sendAt: input.sendAt,
  });
  // The composer's "propose CRM updates" switch. The planner reads the
  // thread and the message just sent, and proposes; the interface
  // shows the proposals and applies the ones the reader keeps.
  let crmProposal: unknown;
  if (input.updateCrmNotes && mailUsesCrmPeople()) {
    try {
      const thread = input.threadId
        ? await threadForPlanner(input.account, input.threadId)
        : { subject: input.subject, messages: [] };
      thread.messages.push({
        fromEmail: input.account,
        fromName: "",
        toEmails: input.to,
        ccEmails: input.cc ?? [],
        sentAt: new Date().toISOString(),
        own: true,
        bodyText: input.body.slice(0, 8000),
      });
      crmProposal = await plannerJson<Record<string, unknown>>("/api/agent/mail/propose", {
        method: "POST",
        body: { account: input.account, thread },
      });
    } catch (err) {
      crmProposal = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return ok({ success: true, crmProposal });
}

async function chatStyle({ body }: RouteContext): Promise<Response> {
  const input = await body<{
    account: string;
    threadId: string;
    noQuote: boolean;
    title?: string;
    subject?: string;
    participantEmails?: string[];
    counterpartName?: string;
    counterpartEmail?: string;
    messageCount?: number;
  }>();
  return ok({ success: true, chat: await setThreadChatStyle(input) });
}

async function foldersMove({ body }: RouteContext): Promise<Response> {
  const input = await body<{
    account: string;
    threadId: string;
    folderName: string;
    create?: boolean;
  }>();
  return ok({ success: true, ...(await moveMailThreadToFolder(input)) });
}

async function foldersUnmove({ body }: RouteContext): Promise<Response> {
  const input = await body<{
    account: string;
    threadId: string;
    folderName: string;
  }>();
  await unmoveMailThreadFromFolder(input);
  return ok({ success: true });
}

async function contactLists({ q, method, body }: RouteContext): Promise<Response> {
  if (method === "GET") {
    return ok({ lists: await listMailContactLists() });
  }
  if (method === "DELETE") {
    const id = q.get("id")?.trim();
    if (!id) return failed("id is required", 400);
    await deleteMailContactList(id);
    return ok({ success: true });
  }
  if (method === "PATCH") {
    const input = await body<{
      id: string;
      name?: string;
      members?: { email: string; name?: string; initials?: string }[];
    }>();
    return ok({ list: await updateMailContactList(input) });
  }
  const input = await body<{
    name: string;
    members: { email: string; name?: string; initials?: string }[];
  }>();
  return ok({ list: await createMailContactList(input) });
}

/** /api/gmail/accounts, /api/outlook/accounts. */
async function accounts({ url, q, method, body }: RouteContext): Promise<Response> {
  const provider =
    url.pathname === "/api/outlook/accounts" ? "outlook" : "gmail";
  const owner = { clerkUserId: OWNER_ID };

  if (method === "GET") {
    const accounts =
      provider === "gmail"
        ? await listGmailAccounts(owner)
        : await listOutlookAccounts(owner);
    return ok({
      success: true,
      accounts,
      configError: connectConfigError(provider),
    });
  }

  if (method === "PATCH") {
    const input = await body<{
      order?: string[];
      email?: string;
      inMailTab?: boolean;
    }>();
    if (Array.isArray(input.order)) {
      if (provider === "gmail") {
        await reorderGmailAccounts(input.order, OWNER_ID);
      } else {
        await reorderOutlookAccounts(input.order, OWNER_ID);
      }
      return ok({ ok: true, success: true });
    }
    if (!input.email || typeof input.inMailTab !== "boolean") {
      return failed("email and inMailTab required", 400);
    }
    if (provider === "gmail") {
      await setAccountInMailTab(input.email, input.inMailTab, OWNER_ID);
    } else {
      await setOutlookAccountInMailTab(
        input.email,
        input.inMailTab,
        OWNER_ID
      );
    }
    // Drop list caches so the next read omits a hidden mailbox.
    invalidateInboxCache();
    return ok({ ok: true, success: true });
  }

  if (method === "DELETE") {
    const email = q.get("email")?.trim();
    if (!email) return failed("email required", 400);
    const removed =
      provider === "gmail"
        ? await deleteGmailAccount(email, OWNER_ID)
        : await deleteOutlookAccount(email, OWNER_ID);
    if (!removed) return failed("Account not found", 404);
    invalidateInboxCache();
    // The local copy goes with the grant: the worker is told to stop,
    // and the rows it wrote are dropped. Nothing on the provider's
    // side changes; the mail is still there to sync again.
    await stopLocalStoreSync(email).catch(() => {});
    await mailStore().messages.removeAccount(email).catch(() => {});
    return ok({ ok: true, success: true });
  }

  return failed(`${method} is not allowed here`, 405);
}

/**
* Out of office.
*
* Not a team-layer feature: it is the provider's own vacation setting,
* and this build asks for `gmail.settings.basic` already — the scope the
* signature needs covers it. Only the button that writes the message
* with AI is absent, and the interface hides that one.
*/
async function autoreply({ method, body }: RouteContext): Promise<Response> {
  if (method === "GET") {
    return ok({ autoReplies: await listMailAutoReplies("all", OWNER_ID) });
  }
  const input = await body<Parameters<typeof setMailAutoReply>[0]>();
  return ok({ autoReply: await setMailAutoReply(input) });
}

async function read({ body }: RouteContext): Promise<Response> {
  const input = await body<{ account: string; threadId: string }>();
  await markMailThreadRead(input.account, input.threadId);
  return ok({ success: true });
}

async function draftsDiscard({ body }: RouteContext): Promise<Response> {
  const input = await body<{
    account: string;
    ref: string;
    threadId?: string;
  }>();
  if (!input.account || !input.ref) {
    return failed("account and ref are required", 400);
  }
  await discardProviderDraft(input);
  return ok({ success: true });
}

async function messageSource({ q }: RouteContext): Promise<Response> {
  const account = q.get("account");
  const messageId = q.get("messageId");
  if (!account || !messageId) {
    return failed("account and messageId are required", 400);
  }
  const { bytes } = await fetchMailMessageSource({ account, messageId });
  const download = q.get("download") === "1";
  const filename = (q.get("filename") || "message.eml").replace(/["\r\n]/g, "");
  // Not JSON: the sheet reads this as text, and the download as bytes.
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "message/rfc822; charset=utf-8",
      ...(download
        ? { "Content-Disposition": `attachment; filename="${filename}"` }
        : {}),
    },
  });
}

async function attachment({ q }: RouteContext): Promise<Response> {
  const account = q.get("account");
  const messageId = q.get("messageId");
  const attachmentId = q.get("attachmentId");
  if (!account || !messageId || !attachmentId) {
    return failed(
      "account, messageId, and attachmentId are required",
      400
    );
  }
  const { bytes } = await fetchMailAttachment({
    account,
    messageId,
    attachmentId,
  });
  const filename = q.get("filename") || "attachment";
  const download = q.get("download") === "1";
  const body = new Uint8Array(bytes);
  // Not JSON: the caller reads this as bytes or points an element at it.
  return new Response(body, {
    status: 200,
    headers: {
      // The sender chose both of these. See @/lib/mail/attachment-mime.
      "Content-Type": safeAttachmentMimeType(q.get("mimeType"), {
        download,
        bytes: body,
      }),
      "Content-Length": String(bytes.length),
      "Content-Disposition": attachmentContentDisposition(filename, {
        download,
      }),
      ...ATTACHMENT_SNIFF_HEADERS,
    },
  });
}

async function contactSources({ method, body }: RouteContext): Promise<Response> {
  if (method === "GET") {
    return ok({ sources: await listContactSourceStatuses(OWNER_ID) });
  }
  const input = await body<{
    hideEmail?: string;
    key?: string;
    enabled?: boolean;
  }>();
  if (input.hideEmail) {
    await hideHistorySuggestion(input.hideEmail);
    return ok({ ok: true });
  }
  if (!input.key) return failed("key is required", 400);
  // The panel replaces its list from the answer, so the answer carries
  // the list. Settings alone left it with nothing to render.
  const settings = await setContactSourceEnabled(
    input.key,
    input.enabled !== false
  );
  return ok({
    settings,
    sources: await listContactSourceStatuses(OWNER_ID),
  });
}

async function contactSourcesSync({ q }: RouteContext): Promise<Response> {
  /*
    Two reasons to sync behind a reader who is starting a message.

    A source that never synced is the first run, and it takes
    everything, the scan of sent mail over the provider's API
    included. History the copy can refresh is the other, and it takes
    one query per mailbox — so `includeHistory` is false there, which
    holds the slow scan back and lets the cheap one through.

    Neither reason, and nothing runs. Before this there was only the
    first, so once every source had synced once the pass never ran
    again and the history rows stopped moving.
  */
  const ifStale = q.get("ifStale") === "1";
  const firstRun = ifStale && (await hasUnsyncedContactSources(OWNER_ID));
  const staleCopy =
    ifStale && !firstRun && (await hasStaleCopyHistory(OWNER_ID));
  if (ifStale && !firstRun && !staleCopy) {
    return ok({ skipped: true, results: [] });
  }
  const results = await syncAllContactSources({
    clerkUserId: OWNER_ID,
    // Stale copy history on its own is one query per mailbox. It must
    // never pull the scan of sent mail over the API in with it.
    includeHistory: !staleCopy,
  });
  // The classifier holds its index for minutes. Without this, contacts
  // that just arrived are not treated as contacts until it expires.
  invalidateMailCaches();
  return ok({ skipped: false, results });
}

async function chatParts({ q }: RouteContext): Promise<Response> {
  const account = q.get("account");
  const chatId = q.get("chatId");
  if (!account || !chatId) {
    return failed("account and chatId are required", 400);
  }
  return ok({ parts: await listChatParts(account, chatId) });
}

/*
* The team layer, over the planner API. The CRM and the organization's
* model key are on the planner server; mail is here. The pane sends
* the thread it holds and gets the same answer the planner route gave.
* The public flavor never gets here: the interface hides these
* actions, and the answer says why if it asks anyway.
*/
async function updateCrm({ body }: RouteContext): Promise<Response> {
  if (!mailUsesCrmPeople()) return failed(MAIL_PUBLIC_CRM_DISABLED_MESSAGE, 403);
  const input = await body<{ account: string; threadId: string; phase?: string }>();
  if (!input.account || !input.threadId) {
    return failed("account and threadId are required", 400);
  }
  const answer = await plannerJson<{ crmNotes: unknown }>("/api/agent/mail/update-crm", {
    method: "POST",
    body: {
      account: input.account,
      thread: await threadForPlanner(input.account, input.threadId),
      phase: input.phase,
    },
  });
  return ok({ success: true, crmNotes: answer.crmNotes });
}

/*
* The AI proposes; the reader applies. crm-propose sends the thread
* (and, after a send, the message just sent, which the provider may
* not list yet) to the planner and gets candidate records and proposed
* tool calls back. crm-apply runs the ones the reader kept.
*/
async function crmPropose({ body }: RouteContext): Promise<Response> {
  if (!mailUsesCrmPeople()) return failed(MAIL_PUBLIC_CRM_DISABLED_MESSAGE, 403);
  const input = await body<{
    account: string;
    threadId?: string;
    hint?: string;
    phase?: "match" | "propose";
    sent?: { to: string[]; cc?: string[]; subject: string; body: string };
    attachments?: { filename: string; text: string }[];
  }>();
  if (!input.account) return failed("account is required", 400);
  const thread = input.threadId
    ? await threadForPlanner(input.account, input.threadId)
    : { subject: input.sent?.subject ?? "", messages: [] };
  if (input.sent) {
    thread.messages.push({
      fromEmail: input.account,
      fromName: "",
      toEmails: input.sent.to,
      ccEmails: input.sent.cc ?? [],
      sentAt: new Date().toISOString(),
      own: true,
      bodyText: input.sent.body.slice(0, 8000),
    });
    if (!thread.subject) thread.subject = input.sent.subject;
  }
  const answer = await plannerJson<Record<string, unknown>>("/api/agent/mail/propose", {
    method: "POST",
    body: {
      account: input.account,
      thread,
      hint: input.hint,
      phase: input.phase,
      attachments: input.attachments,
    },
  });
  return ok(answer);
}

/*
* A reply, drafted by the planner from the thread, the CRM records it
* matches and the mail we exchanged with them before. The pane sends
* the thread it holds; the planner has no mailbox token to load one.
* Nothing is stored or sent — the draft goes into the composer.
*/
async function replyDraft({ body }: RouteContext): Promise<Response> {
  if (!mailUsesCrmPeople()) return failed(MAIL_PUBLIC_CRM_DISABLED_MESSAGE, 403);
  const input = await body<{
    account: string;
    threadId?: string;
    /** A new message: the people and the subject, and no thread. */
    compose?: { to: string[]; cc?: string[]; subject: string };
    hint?: string;
    /** What was already in the box — the brief for the draft. */
    notes?: string;
    phase?: "match" | "draft";
  }>();
  if (!input.account) return failed("account is required", 400);
  const composing = Boolean(input.compose) && !input.threadId;
  if (!input.threadId && !input.compose) {
    return failed("threadId or compose is required", 400);
  }
  const thread = composing
    ? {
        subject: input.compose!.subject,
        messages: [
          {
            fromEmail: input.account,
            fromName: "",
            toEmails: input.compose!.to,
            ccEmails: input.compose!.cc ?? [],
            sentAt: null,
            own: true,
            bodyText: (input.notes || "").slice(0, 8000),
          },
        ],
      }
    : await threadForPlanner(input.account, input.threadId!);
  const answer = await plannerJson<Record<string, unknown>>("/api/agent/mail/reply-draft", {
    method: "POST",
    body: {
      account: input.account,
      kind: composing ? "compose" : "reply",
      thread,
      hint: input.hint,
      notes: input.notes,
      phase: input.phase,
    },
  });
  return ok(answer);
}

async function crmFindLogo({ body }: RouteContext): Promise<Response> {
  if (!mailUsesCrmPeople()) return failed(MAIL_PUBLIC_CRM_DISABLED_MESSAGE, 403);
  const input = await body<{ site: string }>();
  return ok(
    await plannerJson<Record<string, unknown>>("/api/agent/mail/find-logo", {
      method: "POST",
      body: { site: input.site },
    })
  );
}

/*
* The same two steps for the reader's own diary, and none of the CRM:
* the planner reads the thread and says what it fixes to a date and a
* place, and the second call writes the ones the reader kept. The
* thread is loaded here, as it is for a proposal, because the mailbox
* is local and the planner has no way to fetch it.
*/
async function diaryPropose({ body }: RouteContext): Promise<Response> {
  if (!mailOrgAiAllowed()) return failed(MAIL_PUBLIC_AI_DISABLED_MESSAGE, 403);
  const input = await body<{
    account: string;
    threadId: string;
    hint?: string;
    attachments?: { filename: string; text: string }[];
  }>();
  if (!input.account) return failed("account is required", 400);
  if (!input.threadId) return failed("threadId is required", 400);
  const thread = await threadForPlanner(input.account, input.threadId);
  return ok(
    await plannerJson<Record<string, unknown>>("/api/agent/mail/diary-propose", {
      method: "POST",
      body: {
        thread,
        hint: input.hint,
        attachments: input.attachments,
        today: new Date().toISOString().slice(0, 10),
      },
    })
  );
}

async function diaryApply({ body }: RouteContext): Promise<Response> {
  if (!mailOrgAiAllowed()) return failed(MAIL_PUBLIC_AI_DISABLED_MESSAGE, 403);
  const input = await body<{ entries: unknown[]; calendarName?: string }>();
  return ok(
    await plannerJson<Record<string, unknown>>("/api/agent/mail/diary-apply", {
      method: "POST",
      body: { entries: input.entries, calendarName: input.calendarName },
    })
  );
}

async function crmApply({ body }: RouteContext): Promise<Response> {
  if (!mailUsesCrmPeople()) return failed(MAIL_PUBLIC_CRM_DISABLED_MESSAGE, 403);
  const input = await body<{ proposals: unknown[] }>();
  const answer = await plannerJson<Record<string, unknown>>("/api/agent/mail/apply", {
    method: "POST",
    body: { proposals: input.proposals },
  });
  invalidateMailCaches();
  return ok(answer);
}

async function autoreplyDraft({ body }: RouteContext): Promise<Response> {
  if (!mailOrgAiAllowed()) return failed(MAIL_PUBLIC_AI_DISABLED_MESSAGE, 403);
  const input = await body<Record<string, unknown>>();
  const answer = await plannerJson<{ draft: unknown }>("/api/agent/mail/autoreply-draft", {
    method: "POST",
    body: input,
  });
  return ok({ draft: answer.draft });
}

/**
 * Every path this build answers, and the route that answers it. A path
 * that is not here answers 501, by name.
 */
export const STANDALONE_MAIL_ROUTES: Record<string, Route> = {
  "/api/mail/threads": threads,
  "/api/mail/thread": thread,
  "/api/mail/scheduled": scheduled,
  "/api/mail/folders": folders,
  "/api/mail/drafts": drafts,
  "/api/mail/archive": moveThread,
  "/api/mail/unarchive": moveThread,
  "/api/mail/trash": moveThread,
  "/api/mail/untrash": moveThread,
  "/api/mail/junk": moveThread,
  "/api/mail/not-junk": moveThread,
  "/api/mail/unread": moveThread,
  "/api/mail/delete-forever": deleteForever,
  "/api/mail/snooze": snooze,
  "/api/mail/unsnooze": unsnooze,
  "/api/mail/snoozed": snoozed,
  "/api/mail/contacts": contacts,
  "/api/mail/signature": signature,
  "/api/mail/sender-name": senderName,
  "/api/mail/outlook-draft": outlookDraft,
  "/api/mail/send": send,
  "/api/mail/chat-style": chatStyle,
  "/api/mail/folders/move": foldersMove,
  "/api/mail/folders/unmove": foldersUnmove,
  "/api/mail/contact-lists": contactLists,
  "/api/gmail/accounts": accounts,
  "/api/outlook/accounts": accounts,
  "/api/mail/autoreply": autoreply,
  "/api/mail/read": read,
  "/api/mail/drafts/discard": draftsDiscard,
  "/api/mail/message/source": messageSource,
  "/api/mail/attachment": attachment,
  "/api/mail/contact-sources": contactSources,
  "/api/mail/contact-sources/sync": contactSourcesSync,
  "/api/mail/chat/parts": chatParts,
  "/api/mail/update-crm": updateCrm,
  "/api/mail/crm-propose": crmPropose,
  "/api/mail/reply-draft": replyDraft,
  "/api/mail/crm-find-logo": crmFindLogo,
  "/api/mail/diary-propose": diaryPropose,
  "/api/mail/diary-apply": diaryApply,
  "/api/mail/crm-apply": crmApply,
  "/api/mail/autoreply/draft": autoreplyDraft,
};


/**
 * Paths this build answers. The rest still report 501 by name.
 *
 * Every path the interface calls is answered here, except the ones this flavor
 * does not have: add-to-CRM, CRM notes, and the two AI drafts, which all belong
 * to the team layer. The interface hides those, so they are unreachable rather
 * than broken.
 *
 * Calendar invites need nothing here. `isNativeShell()` is true in this build,
 * so an invite goes straight to the shell's open_calendar_invite command and
 * never reaches a path at all. Creating and renaming labels is the same story
 * in reverse: the interface offers it only where a planner route exists.
 *
 * Remote images do not come through here at all. An `img` inside the message
 * frame is loaded by the webview, not by our code, so the shell answers a
 * scheme of its own instead. See `products/mail/crates/mail-native/src/images.rs`.
 */
export const STANDALONE_MAIL_PATHS = [
  "/api/mail/threads",
  "/api/mail/thread",
  "/api/mail/folders",
  "/api/mail/drafts",
  "/api/mail/junk",
  "/api/mail/not-junk",
  "/api/mail/archive",
  "/api/mail/unarchive",
  "/api/mail/trash",
  "/api/mail/untrash",
  "/api/mail/delete-forever",
  "/api/mail/unread",
  "/api/mail/read",
  "/api/mail/drafts/discard",
  "/api/mail/autoreply",
  "/api/mail/snooze",
  "/api/mail/unsnooze",
  "/api/mail/snoozed",
  "/api/mail/contacts",
  "/api/mail/signature",
  "/api/mail/sender-name",
  "/api/mail/chat/parts",
  "/api/mail/attachment",
  "/api/mail/message/source",
  "/api/mail/contact-sources",
  "/api/mail/contact-sources/sync",
  "/api/mail/send",
  "/api/mail/chat-style",
  "/api/mail/folders/move",
  "/api/mail/folders/unmove",
  "/api/mail/contact-lists",
  "/api/gmail/accounts",
  "/api/outlook/accounts",
] as const;
