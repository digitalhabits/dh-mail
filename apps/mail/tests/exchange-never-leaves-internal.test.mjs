/**
 * An Exchange (EWS) mailbox never reaches Gmail or Graph.
 *
 * Most of the mail core took "not Outlook" to mean Gmail. With a third
 * provider, each of those places could send an on-prem mailbox's address,
 * and the reader's mail, to Google or to Microsoft's cloud. This suite
 * connects one Exchange mailbox in a fake shell, runs every path that takes
 * an account, and checks that nothing at all goes over `fetch`. Reads come
 * from the local copy, and bodies, files, the source, and the auto-reply
 * from the EWS commands.
 *
 * Built as the internal app: Exchange is not in the public one.
 */

import {
  fetchMailAttachment,
  fetchMailMessageSource,
  getMailThread,
  listAllScheduledMailMessages,
  listMailAutoReplies,
  listProviderDrafts,
  setMailAutoReply,
} from "@/lib/mail/inbox";
import { listMailFolders } from "@/lib/mail/folders";
import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { listConnectedMailAccounts, resolveMailProvider } from "@/lib/mail/providers";
import { getSenderNameSettings } from "@/lib/mail/sender-identity";

import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";
const OWNER = "local";
const THREAD = "conv-1";
const ITEM = "item-1";

const fetched = [];
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return new Response("{}", { status: 500 });
};

const commands = [];
let bodyKept = false;
const settings = {
  [`dh-mail-exchange-folders:${EX}`]: JSON.stringify({
    syncState: "state-1",
    wellKnown: { inbox: "f-inbox", sentitems: "f-sent", msgfolderroot: "f-root" },
    folders: {
      "f-inbox": { id: "f-inbox", parentId: "f-root", name: "Inbox", folderClass: "IPF.Note", total: 4, unread: 1, childCount: 1 },
      "f-sent": { id: "f-sent", parentId: "f-root", name: "Sent Items", folderClass: "IPF.Note", total: 2, unread: 0, childCount: 0 },
      "f-proj": { id: "f-proj", parentId: "f-inbox", name: "Projects", folderClass: "IPF.Note", total: 3, unread: 0, childCount: 0 },
    },
  }),
};

function storedRow() {
  return {
    messageId: ITEM, threadId: THREAD, folder: "", uid: null, rfcMessageId: "<m1@mail.example.com>",
    fromName: "Dana Example", fromEmail: "dana@example.com", to: [{ name: "", email: EX }], cc: [], bcc: [],
    subject: "The plan", snippet: "The plan for Monday.", sentAt: Date.parse("2026-09-21T08:00:00Z"),
    hasAttachments: true, unread: true, starred: false, isDraft: false, labels: ["INBOX"],
    body: bodyKept
      ? { text: "The plan for Monday.", html: null, inlineImages: {}, attachments: [{ section: "2", filename: "plan.pdf", mimeType: "application/pdf", size: 6 }] }
      : null,
  };
}

function storeCall(op, args) {
  switch (op) {
    case "accounts.exists":
      return args.provider === "exchange" && args.email === EX;
    case "accounts.listForOwner":
    case "accounts.listAll":
      return args.provider === "exchange"
        ? [{ email: EX, ownerId: OWNER, historyId: null, lastSyncedAt: null, lastSyncError: null, inMailTab: true, ewsUrl: "https://mail.example.com/EWS/Exchange.asmx", ewsUsername: "someone" }]
        : [];
    case "accounts.getToken":
      throw new Error("accounts.getToken is not for Exchange accounts");
    case "settings.get":
      return settings[args.key] ?? null;
    case "settings.set":
      settings[args.key] = args.value;
      return null;
    case "sync.list":
      return [{ account: EX, folder: "", phase: "live" }];
    case "messages.list":
      return { threads: [], nextBefore: null };
    case "messages.thread":
      return { messages: args.threadId === THREAD ? [storedRow()] : [] };
    default:
      return null;
  }
}

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        commands.push(cmd);
        if (cmd === "mail_store_call") return storeCall(args.op, args.args);
        if (cmd === "mail_ews_fetch_bodies") {
          bodyKept = true;
          return 1;
        }
        if (cmd === "mail_ews_held") return [];
        if (cmd === "mail_ews_get_auto_reply" || cmd === "mail_ews_set_auto_reply") {
          return { state: "Disabled", externalAudience: "All", start: null, end: null, internal: "", external: "" };
        }
        if (cmd === "mail_ews_fetch_source") {
          return Buffer.from("Subject: The plan\r\n\r\nThe plan for Monday.\r\n").toString("base64");
        }
        if (cmd === "mail_ews_fetch_part") {
          return { bytesBase64: "JVBERi0x", mimeType: "application/pdf", filename: "plan.pdf" };
        }
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

suite(async () => {
  invalidateConnectedMailAccountsCache();
  check("the address resolves as Exchange", (await resolveMailProvider(EX)) === "exchange");
  const listed = await listConnectedMailAccounts(OWNER);
  check("the account list has it, as Exchange", listed.some((a) => a.email === EX && a.provider === "exchange"));

  // The actions, send, folder edits, and snooze have suites of their own:
  // exchange-actions-, exchange-send-, and exchange-snooze-internal.

  // What reads, from the copy and the EWS commands.
  check("drafts are listed from the copy, not asked of a provider", (await listProviderDrafts(EX)).length === 0);
  check("no held messages", (await listAllScheduledMailMessages({ clerkUserId: OWNER })).length === 0);
  // Auto-reply (section 16.2): read and set over EWS.
  const replies = await listMailAutoReplies("all", OWNER);
  check("the auto-reply row is read over EWS", replies.some((r) => r.account === EX && r.provider === "exchange" && !r.unavailable));
  await setMailAutoReply({ account: EX, enabled: false, subject: "", bodyHtml: "", restrictToContacts: false, startTime: null, endTime: null });
  check("and set over EWS", commands.includes("mail_ews_set_auto_reply"));
  check("no sender name is asked for", (await getSenderNameSettings(EX)).known === false);

  const folders = await listMailFolders({ account: EX, clerkUserId: OWNER });
  const names = folders.map((f) => f.name).sort();
  check("the folder rail lists the kept tree", names.join("|") === "Inbox|Inbox/Projects|Sent Items", names.join("|"));
  check("the inbox has its role", folders.find((f) => f.name === "Inbox")?.role === "inbox");

  // Show original (section 16.1): the source over EWS.
  const source = await fetchMailMessageSource({ account: EX, messageId: ITEM });
  check("the source comes over EWS", commands.includes("mail_ews_fetch_source"));
  check("and is the message", new TextDecoder().decode(source.bytes).startsWith("Subject: The plan"));

  const thread = await getMailThread(EX, THREAD, { markRead: false });
  check("a thread opens from the copy", thread.messages.length === 1, thread.messages.length);
  check("its body came over EWS", commands.includes("mail_ews_fetch_bodies"));
  check("the body is in the thread", (thread.messages[0]?.bodyText ?? "").includes("Monday"));
  const file = thread.messages[0]?.attachments?.[0];
  const bytes = await fetchMailAttachment({ account: EX, messageId: ITEM, attachmentId: file?.attachmentId ?? "" });
  check("a file comes over EWS by its section", commands.includes("mail_ews_fetch_part") && bytes.bytes.length === 6);

  const empty = await getMailThread(EX, "not-in-the-copy", { markRead: false });
  check("a thread the copy lacks is empty, not asked of Gmail", empty.messages.length === 0);

  check("nothing went over fetch", fetched.length === 0, fetched.join(", "));
  const oauth = commands.filter((c) => c.startsWith("oauth") || c.startsWith("mail_sync_"));
  check("no OAuth or Gmail worker command", oauth.length === 0, oauth.join(", "));
});
