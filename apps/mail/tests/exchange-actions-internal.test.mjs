/**
 * The actions on an Exchange (EWS) thread (phase 3, section 12 of
 * docs/mail-exchange-ews.md).
 *
 * An action names a thread, and each one must take only the items it is
 * about: archive the inbox items and not the Sent copy, delete forever only
 * what is in Trash. The server is told first, with the EWS commands; then
 * the copy changes (a moved item under its new id, with its new label);
 * then the worker is woken. Nothing goes over fetch.
 *
 * The commands are faked at the shell. Built as the internal app.
 */

import { itemsFor, placeOf, runIfExchange } from "@/lib/mail/exchange-actions";
import { exchangeListTarget } from "@/lib/mail/exchange-folders";
import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { archiveMailThread, deleteMailThreadForever, fetchMailMessageSource, markMailThreadRead, trashMailThread } from "@/lib/mail/inbox";
import { createMailFolder, deleteMailFolder, moveMailThreadToFolder, renameMailFolder } from "@/lib/mail/folders";

import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";
const THREAD = "conv-1";

const tree = {
  syncState: "h-1",
  wellKnown: {
    inbox: "f-inbox",
    sentitems: "f-sent",
    drafts: "f-drafts",
    deleteditems: "f-trash",
    junkemail: "f-junk",
    archive: "f-arch",
    msgfolderroot: "f-root",
  },
  folders: Object.fromEntries(
    [
      ["f-inbox", "f-root", "Inbox"],
      ["f-sent", "f-root", "Sent Items"],
      ["f-drafts", "f-root", "Drafts"],
      ["f-trash", "f-root", "Deleted Items"],
      ["f-junk", "f-root", "Junk Email"],
      ["f-arch", "f-root", "Archive"],
      ["f-proj", "f-inbox", "Projects"],
    ].map(([id, parentId, name]) => [id, { id, parentId, name, folderClass: "IPF.Note", total: 1, unread: 0, childCount: 0 }])
  ),
};

const row = (id, labels, extra = {}) => ({
  messageId: id, threadId: THREAD, folder: "", uid: null, rfcMessageId: `<${id}@mail.example.com>`,
  fromName: "Dana Example", fromEmail: "dana@example.com", to: [], cc: [], bcc: [],
  subject: "The plan", snippet: "", sentAt: Number(id.replace(/\D/g, "")) * 1000,
  hasAttachments: false, unread: false, starred: false, isDraft: false, labels, body: null, ...extra,
});

let rows = [];
function reset() {
  rows = [
    row("i1", ["INBOX"], { unread: true }),
    row("i2", ["INBOX"], { unread: true, starred: true, labels: ["INBOX", "STARRED"] }),
    row("s3", ["SENT"]),
    row("t4", ["TRASH"]),
    row("j5", ["SPAM"]),
    row("a6", []),
    row("p7", ["Inbox/Projects"]),
  ];
}

let savedTree = null;
const readAgain = [];
const commands = [];
const upserts = [];
const removed = [];
const fetched = [];
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
      return args.key === `dh-mail-exchange-folders:${EX}` ? (savedTree ?? JSON.stringify(tree)) : null;
    case "settings.set":
      if (args.key === `dh-mail-exchange-folders:${EX}`) savedTree = args.value;
      return null;
    case "sync.set":
      readAgain.push(args.state?.folder ?? args.folder);
      return null;
    case "sync.list":
      return [{ account: EX, folder: "", phase: "live" }];
    case "messages.thread":
      return { messages: rows };
    case "messages.upsertMany":
      upserts.push(...args.rows);
      return args.rows.length;
    case "messages.removeMessages":
      removed.push(...args.messageIds);
      return null;
    default:
      return null;
  }
}

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        commands.push({ cmd, ...args });
        if (cmd === "mail_store_call") return storeCall(args.op, args.args);
        if (cmd === "mail_ews_move") {
          return { moved: args.itemIds.map((id) => ({ id, newId: `${id}-new` })), failed: [] };
        }
        if (cmd === "mail_ews_set_read" || cmd === "mail_ews_set_flag" || cmd === "mail_ews_delete_forever") {
          return { done: args.itemIds, failed: [] };
        }
        if (cmd === "mail_ews_create_folder") {
          return { id: `f-${args.name.toLowerCase()}`, parentId: args.parentId, name: args.name, folderClass: "IPF.Note", total: 0, unread: 0, childCount: 0 };
        }
        if (cmd === "mail_ews_rename_folder" || cmd === "mail_ews_move_folder") return null;
        if (cmd === "mail_ews_fetch_source") throw new Error("ews:invalid: The server did not give this message.");
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};

const ews = (name) => commands.filter((c) => c.cmd === name);
const last = (name) => ews(name).at(-1);
const clear = () => {
  commands.length = 0;
  upserts.length = 0;
  removed.length = 0;
  reset();
};

suite(async () => {
  invalidateConnectedMailAccountsCache();
  reset();

  // ---- Which items each action takes --------------------------------------------
  const place = placeOf(tree, rows);
  const ids = (kind, payload) => itemsFor(kind, place, payload).map((r) => r.messageId).join(",");
  check("archive takes the inbox items", ids("archive") === "i1,i2", ids("archive"));
  check("trash leaves Sent, Drafts, and Trash alone", ids("trash") === "i1,i2,j5,a6,p7", ids("trash"));
  check("read takes the unread items", ids("read") === "i1,i2");
  check("unread takes the newest item", ids("unread") === "p7");
  check("unflag takes the flagged items", ids("unstar") === "i2");
  check("move back takes that folder's items", ids("unmove", { label: "Inbox/Projects" }) === "p7");
  check("a move leaves the items already there", !ids("move", { label: "Inbox/Projects" }).includes("p7"));
  check("delete forever takes Trash only", ids("deleteForever", { from: "trash" }) === "t4");
  check("or Junk only, as asked", ids("deleteForever", { from: "junk" }) === "j5");

  // ---- Archive, end to end ----------------------------------------------------------
  clear();
  await archiveMailThread(EX, THREAD);
  const move = last("mail_ews_move");
  check("archive moves the inbox items to Archive", move?.toFolderId === "f-arch" && move.itemIds.join(",") === "i1,i2");
  check("the old rows go", removed.join(",") === "i1,i2");
  check("they come back under their new ids", upserts.map((r) => r.messageId).join(",") === "i1-new,i2-new");
  check("with no folder label, and the flag kept", upserts[1]?.labels.join(",") === "STARRED" && upserts[0]?.labels.length === 0);
  check("the rows are written without their bodies", upserts.every((r) => !("body" in r)));

  // ---- Trash, read, move to a folder ---------------------------------------------
  clear();
  await trashMailThread(EX, THREAD);
  check("trash moves to Deleted Items", last("mail_ews_move")?.toFolderId === "f-trash");
  check("a trashed row wears TRASH", upserts.every((r) => r.labels.includes("TRASH")));

  clear();
  await markMailThreadRead(EX, THREAD);
  const read = last("mail_ews_set_read");
  check("read goes to the server for the unread items", read?.isRead === true && read.itemIds.join(",") === "i1,i2");
  check("and the rows are read in the copy", upserts.length === 2 && upserts.every((r) => r.unread === false));

  clear();
  await moveMailThreadToFolder({ account: EX, threadId: THREAD, folderName: "Inbox/Projects" });
  check("a move goes to the folder's id", last("mail_ews_move")?.toFolderId === "f-proj");

  clear();
  await moveMailThreadToFolder({ account: EX, threadId: THREAD, folderName: "Inbox" });
  check("a drop on Inbox by its path goes to the Inbox's id", last("mail_ews_move")?.toFolderId === "f-inbox");
  check("and the moved rows wear INBOX", upserts.length > 0 && upserts.every((r) => r.labels.includes("INBOX")), upserts.map((r) => r.labels));
  let refused = "";
  try {
    await moveMailThreadToFolder({ account: EX, threadId: THREAD, folderName: "Nowhere" });
  } catch (err) {
    refused = err.message;
  }
  check("a move to a folder that does not exist refuses", refused.startsWith("ews:invalid:"), refused);
  check("and makes no folder", ews("mail_ews_create_folder").length === 0);

  // ---- Folder edits ------------------------------------------------------------------
  clear();
  await moveMailThreadToFolder({ account: EX, threadId: THREAD, folderName: "Receipts", create: true });
  const made = last("mail_ews_create_folder");
  check("create-and-move makes the folder at the top", made?.parentId === "f-root" && made.name === "Receipts");
  check("and moves into it", last("mail_ews_move")?.toFolderId === "f-receipts");

  await createMailFolder({ name: "Inbox/Projects/2026", account: EX, clerkUserId: "local" });
  const nested = last("mail_ews_create_folder");
  check("a nested path makes only the missing part", nested?.parentId === "f-proj" && nested.name === "2026");

  readAgain.length = 0;
  await renameMailFolder({ name: "Inbox/Projects", newName: "Inbox/Plans", account: EX, clerkUserId: "local" });
  const renamed = last("mail_ews_rename_folder");
  check("a rename names the folder and the new name", renamed?.folderId === "f-proj" && renamed.name === "Plans");
  check("the folder and the one under it are read again", ["f-proj", "f-2026"].every((id) => readAgain.includes(id)), readAgain);

  await deleteMailFolder({ name: "Inbox/Plans", account: EX, clerkUserId: "local" });
  const gone = last("mail_ews_move_folder");
  check("delete moves the folder to Deleted Items", gone?.folderId === "f-proj" && gone.toFolderId === null);
  check("delete never sends a raw call", ews("mail_ews_call").length === 0);

  let managed = "";
  try {
    await deleteMailFolder({ name: "Sent Items", account: EX, clerkUserId: "local" });
  } catch (err) {
    managed = err.message;
  }
  check("a folder Exchange manages is not deleted", managed.startsWith("ews:invalid:"), managed);

  // ---- The rail's managed folders are views of the copy ----------------------------
  const target = (path) => exchangeListTarget(EX, path);
  check("Archive under the account is the archived view", (await target("Archive")).folder === "archived");
  check("Sent Items is the sent view", (await target("Sent Items")).folder === "sent");
  check("Deleted Items is the trash view", (await target("Deleted Items")).folder === "trash");
  check("Drafts is the DRAFT label", (await target("Drafts")).label === "DRAFT");
  const own = await target("Inbox/Projects");
  check("a folder of the reader's is its path", own.folder === null && own.label === "Inbox/Projects");

  // ---- Delete forever ------------------------------------------------------------------
  clear();
  await deleteMailThreadForever(EX, THREAD, "trash");
  const del = ews("mail_ews_delete_forever");
  check("delete forever names only the Trash item", del.length === 1 && del[0].itemIds.join(",") === "t4");
  check("its row goes from the copy", removed.join(",") === "t4");

  clear();
  rows = rows.filter((r) => !r.labels.includes("TRASH"));
  await deleteMailThreadForever(EX, THREAD, "trash");
  check("nothing in Trash: no request at all", ews("mail_ews_delete_forever").length === 0);

  // ---- A row whose id the server no longer knows is mended -----------------------------
  clear();
  readAgain.length = 0;
  let stale = "";
  try {
    await fetchMailMessageSource({ account: EX, messageId: "i1", threadId: THREAD });
  } catch (err) {
    stale = err.message;
  }
  check("Show original on a stale id says the message moved", stale.startsWith("ews:gone:"), stale);
  check("the stale row goes from the copy", removed.includes("i1"));
  check("and its folder is read again", readAgain.includes("f-inbox"), readAgain);

  // ---- Other providers ----------------------------------------------------------------
  // Snooze is built: exchange-snooze-internal.test.mjs has it.
  check("a Gmail address is not taken for Exchange", (await runIfExchange("me@example.org", THREAD, "archive")) === false);

  check("nothing went over fetch", fetched.length === 0, fetched.join(", "));
  check("no raw EWS call was used", ews("mail_ews_call").length === 0);
});
