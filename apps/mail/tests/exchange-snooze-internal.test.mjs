/**
 * Snooze for an Exchange (EWS) mailbox (section 16.3 of
 * docs/mail-exchange-ews.md).
 *
 * The app's snooze row holds the thread back, as for every provider. For
 * Exchange the thread's inbox items also move to a folder, Snoozed, which
 * the app makes on the first snooze. When the snooze ends, the worker's
 * wake puts them back in the inbox. Only threads the app put to sleep move
 * back. The folder is not in the rail or in Move to folder, and the
 * Snoozed view builds its row from the local copy. Nothing goes over
 * fetch.
 *
 * Built as the internal app.
 */

import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { wakeExchangeSnoozes } from "@/lib/mail/exchange-snooze";
import { listMailFolders } from "@/lib/mail/folders";
import { snoozeMailThread, unsnoozeMailThread } from "@/lib/mail/inbox";
import { exchangeSnoozedRow } from "@/lib/mail/inbox-snoozed";

import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";

const folder = (id, parentId, name) => ({ id, parentId, name, folderClass: "IPF.Note", total: 1, unread: 0, childCount: 0 });
const settings = {
  [`dh-mail-exchange-folders:${EX}`]: JSON.stringify({
    syncState: "h-1",
    wellKnown: { inbox: "f-inbox", sentitems: "f-sent", deleteditems: "f-trash", msgfolderroot: "f-root" },
    folders: {
      "f-inbox": folder("f-inbox", "f-root", "Inbox"),
      "f-sent": folder("f-sent", "f-root", "Sent Items"),
      "f-trash": folder("f-trash", "f-root", "Deleted Items"),
      "f-proj": folder("f-proj", "f-root", "Projects"),
    },
  }),
};

const row = (id, threadId, labels, sentAt) => ({
  messageId: id, threadId, folder: "", uid: null, rfcMessageId: `<${id}@mail.example.com>`,
  fromName: "Dana Example", fromEmail: "dana@example.com", to: [{ name: "", email: EX }], cc: [], bcc: [],
  subject: `Plan ${threadId}`, snippet: "The plan for Monday.", sentAt, hasAttachments: false, unread: false,
  starred: false, isDraft: false, labels,
});

let rows = [];
let snoozes = [];
const commands = [];
const fetched = [];
let moveFails = false;

globalThis.fetch = async (url) => {
  fetched.push(String(url));
  return new Response("{}", { status: 500 });
};

function storeCall(op, args) {
  switch (op) {
    case "accounts.exists":
      return args.provider === "exchange" && args.email === EX;
    case "accounts.listForOwner":
    case "accounts.listAll":
      return args.provider === "exchange" ? [{ email: EX, ownerId: "local", historyId: null, lastSyncedAt: null, lastSyncError: null, inMailTab: true }] : [];
    case "settings.get":
      return settings[args.key] ?? null;
    case "settings.set":
      settings[args.key] = args.value;
      return null;
    case "sync.list":
      return [{ account: EX, folder: "", phase: "live" }];
    case "messages.thread":
      return { messages: rows.filter((r) => r.threadId === args.threadId) };
    case "messages.upsertMany":
      rows.push(...args.rows);
      return args.rows.length;
    case "messages.removeMessages":
      rows = rows.filter((r) => !args.messageIds.includes(r.messageId));
      return null;
    case "snoozes.set":
      snoozes = snoozes.filter((s) => s.threadId !== args.record.threadId).concat([{ ...args.record }]);
      return null;
    case "snoozes.remove":
      snoozes = snoozes.filter((s) => !(s.accountEmail === args.accountEmail && s.threadId === args.threadId));
      return null;
    case "snoozes.listActive":
      return snoozes.filter((s) => Date.parse(s.snoozedUntil) > Date.now());
    default:
      return null;
  }
}

let made = 0;
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        commands.push({ cmd, ...args });
        if (cmd === "mail_store_call") return storeCall(args.op, args.args);
        if (cmd === "mail_ews_create_folder") {
          made += 1;
          return folder("f-snz", args.parentId, args.name);
        }
        if (cmd === "mail_ews_move") {
          if (moveDelay) await new Promise((done) => setTimeout(done, moveDelay));
          if (moveFails) throw new Error("ews:fault: ErrorMoveCopyFailed: The move failed.");
          return { moved: args.itemIds.map((id) => ({ id, newId: `${id}+` })), failed: [] };
        }
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

let moveDelay = 0;
const moves = () => commands.filter((c) => c.cmd === "mail_ews_move");
const labelsOf = (threadId) => rows.filter((r) => r.threadId === threadId).map((r) => r.labels.join("+")).sort().join(",");
const later = () => new Date(Date.now() + 3_600_000).toISOString();

suite(async () => {
  invalidateConnectedMailAccountsCache();
  rows = [
    row("i1", "conv-1", ["INBOX"], 1000),
    row("s2", "conv-1", ["SENT"], 2000),
    row("i3", "conv-1", ["INBOX"], 3000),
    // Mail the reader put in a folder named Snoozed in Outlook, not the app.
    row("x9", "conv-9", ["Snoozed"], 500),
  ];

  // ---- Snooze -----------------------------------------------------------------------
  await snoozeMailThread(EX, "conv-1", later());
  check("the app makes the Snoozed folder at the top", made === 1 && commands.some((c) => c.cmd === "mail_ews_create_folder" && c.parentId === "f-root" && c.name === "Snoozed"));
  const move = moves().at(-1);
  check("the inbox items move to it", move?.toFolderId === "f-snz" && move.itemIds.join(",") === "i1,i3", JSON.stringify(move));
  check("the Sent copy stays", labelsOf("conv-1").includes("SENT"));
  check("the moved rows wear the folder's label", labelsOf("conv-1") === "SENT,Snoozed,Snoozed", labelsOf("conv-1"));
  check("the snooze row has the tip from the local copy", snoozes[0]?.tipMessageId === "<i3@mail.example.com>", snoozes[0]?.tipMessageId);

  // A second snooze uses the same folder.
  rows.push(row("i4", "conv-4", ["INBOX"], 4000));
  await snoozeMailThread(EX, "conv-4", later());
  check("no second folder is made", made === 1);

  // ---- What the reader sees ------------------------------------------------------------
  const names = (await listMailFolders({ account: EX, clerkUserId: "local" })).map((f) => f.name);
  check("the rail and Move to folder do not offer Snoozed", !names.includes("Snoozed") && names.includes("Projects"), names.join("|"));
  // The Snoozed view's row (the test build has no team records, so no classifier).
  const until = snoozes.find((s) => s.threadId === "conv-1")?.snoozedUntil;
  const listed = await exchangeSnoozedRow(EX, "conv-1", until, { contacts: new Map(), domains: new Map() });
  check("the Snoozed view's row comes from the copy", listed?.account === EX && listed.subject === "Plan conv-1" && listed.messageCount === 3);
  check("with its wake time, and the newest message's words", listed?.snoozedUntil === until && listed.snippet === "The plan for Monday.");

  // ---- Wake ---------------------------------------------------------------------------
  const before = moves().length;
  check("nothing wakes while the snooze is on", (await wakeExchangeSnoozes(EX)) === 0 && moves().length === before);
  snoozes = snoozes.map((s) => (s.threadId === "conv-1" ? { ...s, snoozedUntil: new Date(Date.now() - 1000).toISOString() } : s));
  check("a snooze whose time came wakes", (await wakeExchangeSnoozes(EX)) === 1);
  const back = moves().at(-1);
  check("its items go back to the inbox", back?.toFolderId === "f-inbox" && back.itemIds.join(",") === "i1+,i3+", JSON.stringify(back));
  check("and wear INBOX again", labelsOf("conv-1") === "INBOX,INBOX,SENT", labelsOf("conv-1"));
  check("the reader's own mail in the folder stays", labelsOf("conv-9") === "Snoozed");
  check("a thread wakes only once", (await wakeExchangeSnoozes(EX)) === 0);

  // Unsnooze wakes at once.
  await unsnoozeMailThread(EX, "conv-4");
  check("unsnooze puts the thread back now", labelsOf("conv-4") === "INBOX" && moves().at(-1)?.toFolderId === "f-inbox");

  // An unsnooze while the snooze's move is still on its way (seen on KU,
  // 2026-09-27): the thread must come back, not stay in Snoozed for good.
  rows.push(row("i6", "conv-6", ["INBOX"], 6000));
  moveDelay = 50;
  const snoozing = snoozeMailThread(EX, "conv-6", later());
  await new Promise((done) => setTimeout(done, 5));
  await unsnoozeMailThread(EX, "conv-6");
  await snoozing;
  check("an unsnooze during the snooze's move still brings the thread back", labelsOf("conv-6") === "INBOX", labelsOf("conv-6"));
  // At once, before the snooze has even written its record.
  rows.push(row("i7", "conv-7", ["INBOX"], 7000));
  const snoozing7 = snoozeMailThread(EX, "conv-7", later());
  await unsnoozeMailThread(EX, "conv-7");
  await snoozing7;
  moveDelay = 0;
  check("an unsnooze at once leaves no snooze behind", !snoozes.some((s) => s.threadId === "conv-7"));
  check("and the thread is in the inbox", labelsOf("conv-7") === "INBOX", labelsOf("conv-7"));

  // ---- A failed move ----------------------------------------------------------------
  rows.push(row("i5", "conv-5", ["INBOX"], 5000));
  moveFails = true;
  let error = "";
  try {
    await snoozeMailThread(EX, "conv-5", later());
  } catch (err) {
    error = err.message;
  }
  moveFails = false;
  check("a failed move is an error", error.includes("ErrorMoveCopyFailed"), error);
  check("and the thread is not held back here", !snoozes.some((s) => s.threadId === "conv-5"));

  check("nothing went over fetch", fetched.length === 0, fetched.join(", "));
});
