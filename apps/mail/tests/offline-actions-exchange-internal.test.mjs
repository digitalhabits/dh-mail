/**
 * Exchange (EWS) actions with no network: the copy changes at once, the
 * action waits in the queue, and it goes to the server when the server can
 * be reached (a KU tester, 2026-10-15: offline, read and archive did nothing).
 *
 * The fake server keeps the real server's rules, as ews_fixtures.rs does:
 * a moved item has a new id and the old id is gone after; a change to an
 * item that is gone answers ErrorItemNotFound (done, and said to be gone);
 * and a refused password is asked once, never again until a new connect
 * (the Rust client's latch). Every call fails with ews:network while the
 * network is off. Built as the internal app.
 */

import { flushExchangeActions, replayExchangeActions, resumeExchangeActions } from "@/lib/mail/exchange-queue";
import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { archiveMailThread, markMailThreadRead, markMailThreadUnread, trashMailThread, unarchiveMailThread } from "@/lib/mail/inbox";
import { moveMailThreadToFolder } from "@/lib/mail/folders";

import { fakeActionQueue } from "./fake-action-queue.mjs";
import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";

const tree = {
  syncState: "h-1",
  wellKnown: { inbox: "f-inbox", sentitems: "f-sent", drafts: "f-drafts", deleteditems: "f-trash", junkemail: "f-junk", archive: "f-arch", msgfolderroot: "f-root" },
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
const LABEL_OF = { "f-inbox": ["INBOX"], "f-trash": ["TRASH"], "f-arch": [], "f-proj": ["Inbox/Projects"], "f-junk": ["SPAM"] };

// ---- The server ---------------------------------------------------------------------

let online = true;
let password = "right";
let refusedLatch = false;
let moves = 0;
let requests = 0;
/** Items by id: the folder each is in, and its flags. */
const server = new Map();
const denied = new Set();
/** Item ids whose next move the server answers with a fault for the whole request. */
const faultOnce = new Set();

function ews(cmd, args) {
  // The Rust client sends nothing once a password was refused.
  if (refusedLatch) throw new Error("ews:refused: The server refused the password. Connect the account again.");
  if (!online) throw new Error("ews:network: Could not reach the server.");
  requests += 1;
  if (password !== "right") {
    refusedLatch = true;
    throw new Error("ews:refused: The server refused the password. Connect the account again.");
  }
  const failed = [];
  if (cmd === "mail_ews_move" && args.itemIds.some((id) => faultOnce.has(id))) {
    for (const id of args.itemIds) faultOnce.delete(id);
    throw new Error("ews:fault: ErrorInternalServerTransientError: An internal server error occurred.");
  }
  if (cmd === "mail_ews_move") {
    const moved = [];
    for (const id of args.itemIds) {
      if (denied.has(id)) {
        failed.push({ id, error: "ews:fault: ErrorAccessDenied: Access is denied." });
        continue;
      }
      const item = server.get(id);
      if (!item) {
        moved.push({ id, newId: null });
        continue;
      }
      moves += 1;
      const newId = `${id.split("~")[0]}~${moves}`;
      server.delete(id);
      server.set(newId, { ...item, folder: args.toFolderId });
      moved.push({ id, newId });
    }
    return { moved, failed };
  }
  if (cmd === "mail_ews_set_read" || cmd === "mail_ews_set_flag") {
    const done = [];
    const gone = [];
    for (const id of args.itemIds) {
      const item = server.get(id);
      done.push(id);
      if (!item) {
        gone.push(id);
        continue;
      }
      if (cmd === "mail_ews_set_read") item.isRead = args.isRead;
      else item.flagged = args.flagged;
    }
    return { done, failed, gone };
  }
  throw new Error(`no such command in this test: ${cmd}`);
}

// ---- The store -------------------------------------------------------------------------

let rows = [];
const row = (id, threadId, labels, extra = {}) => ({
  messageId: id, threadId, folder: "", uid: null, rfcMessageId: `<${id}@mail.example.com>`,
  fromName: "Dana Example", fromEmail: "dana@example.com", to: [], cc: [], bcc: [],
  subject: "The plan", snippet: "", sentAt: Number(id.replace(/\D/g, "")) * 1000,
  hasAttachments: false, unread: false, starred: false, isDraft: false, labels, ...extra,
});
const rowOf = (id) => rows.find((r) => r.messageId === id);

function upsert(written) {
  for (const r of written) {
    const at = rows.findIndex((x) => x.messageId === r.messageId);
    if (at >= 0) rows[at] = { ...r };
    else rows.push({ ...r });
  }
}

const queue = fakeActionQueue({
  onRows: (_account, written) => upsert(written),
  // As the Rust store's restore: rows still in the copy, as they were.
  onRestore: (_account, before) => {
    for (const [id, was] of Object.entries(before)) {
      const r = rowOf(id);
      if (!r) continue;
      if (was.labels) r.labels = [...was.labels];
      if (typeof was.unread === "boolean") r.unread = was.unread;
      if (typeof was.starred === "boolean") r.starred = was.starred;
    }
  },
});

function storeCall(op, args) {
  if (queue.isQueueOp(op)) return queue.call(op, args);
  switch (op) {
    case "accounts.exists":
      return args.provider === "exchange" && args.email === EX;
    case "accounts.listForOwner":
    case "accounts.listAll":
      return args.provider === "exchange" ? [{ email: EX, ownerId: "local", historyId: null, lastSyncedAt: null, lastSyncError: null, inMailTab: true }] : [];
    case "settings.get":
      return args.key === `dh-mail-exchange-folders:${EX}` ? JSON.stringify(tree) : null;
    case "sync.list":
      return [{ account: EX, folder: "", phase: "live" }];
    case "messages.thread":
      return { messages: rows.filter((r) => r.threadId === args.threadId).map((r) => ({ ...r, body: null })) };
    case "messages.upsertMany":
      upsert(args.rows);
      return args.rows.length;
    case "messages.removeMessages":
      rows = rows.filter((r) => !args.messageIds.includes(r.messageId));
      return null;
    default:
      return null;
  }
}

const refusals = [];
globalThis.fetch = async () => new Response("{}", { status: 500 });
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        if (cmd === "mail_store_call") return storeCall(args.op, args.args);
        if (cmd.startsWith("mail_ews_")) return ews(cmd, args);
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
    event: {
      emit: async (name, payload) => {
        if (name === "mail-sync-action-failed") refusals.push(payload);
      },
    },
  },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
};

/** A thread of two inbox items and an older sent one, on the server and in the copy. */
function seed(thread, n) {
  const ids = [`i${n}`, `i${n + 1}`];
  for (const id of ids) server.set(id, { folder: "f-inbox", isRead: false, flagged: false });
  server.set(`s${n + 2}`, { folder: "f-sent", isRead: true, flagged: false });
  rows.push(row(ids[0], thread, ["INBOX"], { unread: true }), row(ids[1], thread, ["INBOX"], { unread: true }), row(`s${n + 2}`, thread, ["SENT"], { sentAt: 1 }));
}

const kinds = () => queue.rows.map((r) => r.kind).join(",");
const threadRows = (thread) => rows.filter((r) => r.threadId === thread);
const inboxIds = (thread) => threadRows(thread).filter((r) => r.labels.includes("INBOX")).map((r) => r.messageId).join(",");

suite(async () => {
  invalidateConnectedMailAccountsCache();

  // ---- Offline: read, then archive ---------------------------------------------------
  seed("c-1", 1);
  online = false;
  let threw = "";
  try {
    await markMailThreadRead(EX, "c-1");
    await archiveMailThread(EX, "c-1");
  } catch (err) {
    threw = err.message;
  }
  check("offline, read and archive do not fail", threw === "", threw);
  check("the copy has them at once: read", threadRows("c-1").filter((r) => r.messageId.startsWith("i")).every((r) => !r.unread));
  check("and out of the inbox", inboxIds("c-1") === "", inboxIds("c-1"));
  check("the Sent copy is left alone", rowOf("s3")?.labels.join(",") === "SENT");
  check("both wait in the queue, in order", kinds() === "read,archive", kinds());
  check("the server has neither", server.get("i1")?.isRead === false && server.get("i1")?.folder === "f-inbox");
  check("the failed try was not counted", queue.rows.every((r) => r.attempts === 0) && queue.rows[0].lastError?.startsWith("ews:network:"), JSON.stringify(queue.rows.map((r) => [r.attempts, r.lastError])));

  // A pass wrote the server's view over the copy; the queue goes back on top.
  rows = rows.map((r) => (r.threadId === "c-1" && r.messageId !== "s3" ? { ...r, labels: ["INBOX"], unread: true } : r));
  await replayExchangeActions(EX);
  check("a pass does not undo a queued action", inboxIds("c-1") === "" && threadRows("c-1").every((r) => !r.unread));

  // Many flushes with no network: nothing is given up.
  for (let i = 0; i < 8; i += 1) await flushExchangeActions(EX);
  check("however long the network is gone, nothing is given up", kinds() === "read,archive" && queue.rows.every((r) => r.attempts === 0));

  // ---- Online again ---------------------------------------------------------------------
  online = true;
  await flushExchangeActions(EX);
  check("back online, the queue is sent and empty", queue.rows.length === 0, kinds());
  const archived = [...server.entries()].filter(([, v]) => v.folder === "f-arch");
  check("the server has the items read, in Archive, under new ids", archived.length === 2 && archived.every(([id, v]) => id.includes("~") && v.isRead), JSON.stringify(archived));
  check("the old ids are gone from the server", !server.has("i1") && !server.has("i2"));
  check("the copy has the new ids, in Archive", threadRows("c-1").filter((r) => r.messageId.includes("~")).length === 2 && threadRows("c-1").filter((r) => r.messageId.includes("~")).every((r) => r.labels.length === 0));
  check("no refusal was said", refusals.length === 0, JSON.stringify(refusals));

  // ---- Archive, then mark unread, offline: the second follows the new ids -------------
  seed("c-2", 10);
  online = false;
  await archiveMailThread(EX, "c-2");
  await markMailThreadUnread(EX, "c-2");
  check("archive and unread wait", kinds() === "archive,unread", kinds());
  online = true;
  await flushExchangeActions(EX);
  const newest = [...server.entries()].find(([id]) => id.startsWith("i11~"));
  check("the unread went to the moved item by its new id", newest?.[1].isRead === false && newest[1].folder === "f-arch", JSON.stringify(newest));
  check("and nothing was refused", queue.rows.length === 0 && refusals.length === 0, JSON.stringify(refusals));

  // ---- Undo before the network is back: neither goes out -------------------------------
  seed("c-7", 70);
  online = false;
  await archiveMailThread(EX, "c-7");
  check("archived offline", inboxIds("c-7") === "");
  await unarchiveMailThread(EX, "c-7");
  check("Undo takes the queued archive back: nothing waits", queue.rows.length === 0 && queue.cancelled.length === 1, kinds());
  check("and the rows are in the inbox as they were", inboxIds("c-7") === "i70,i71", inboxIds("c-7"));
  online = true;
  requests = 0;
  await flushExchangeActions(EX);
  check("the server hears of neither", requests === 0 && server.get("i70")?.folder === "f-inbox", requests);

  // ---- A refusal holds the thread's later actions back ---------------------------------
  seed("c-8", 80);
  seed("c-9", 90);
  online = false;
  await archiveMailThread(EX, "c-8");
  await moveMailThreadToFolder({ account: EX, threadId: "c-8", folderName: "Inbox/Projects" });
  await markMailThreadRead(EX, "c-9");
  online = true;
  faultOnce.add("i80");
  await flushExchangeActions(EX);
  check("a whole-request fault is counted, and the action keeps its place", queue.rows[0]?.kind === "archive" && queue.rows[0]?.attempts === 1, JSON.stringify(queue.rows.map((r) => [r.kind, r.attempts])));
  check("the same thread's next action waits behind it", kinds() === "archive,move" && server.get("i80")?.folder === "f-inbox" && server.get("i81")?.folder === "f-inbox", kinds());
  check("another thread's action is not held", server.get("i90")?.isRead === true && server.get("i91")?.isRead === true);
  await flushExchangeActions(EX);
  const c8 = [...server.entries()].filter(([id]) => /^i8[01]~/.test(id));
  check("on the next try both go, in order: archived, then moved, under the ids the move gave", queue.rows.length === 0 && c8.length === 2 && c8.every(([, v]) => v.folder === "f-proj"), JSON.stringify(c8));

  // ---- A move to a folder, offline -------------------------------------------------------
  seed("c-3", 20);
  online = false;
  await moveMailThreadToFolder({ account: EX, threadId: "c-3", folderName: "Inbox/Projects" });
  check("a move offline shows the rows in the folder", threadRows("c-3").filter((r) => r.labels.includes("Inbox/Projects")).length === 2);
  online = true;
  await flushExchangeActions(EX);
  check("and goes to the folder's id once online", [...server.entries()].filter(([id, v]) => /^i2[01]~/.test(id) && v.folder === "f-proj").length === 2);

  // ---- Gone on the server meanwhile -----------------------------------------------------
  seed("c-4", 30);
  online = false;
  await trashMailThread(EX, "c-4");
  check("trash offline takes the rows out of the inbox", inboxIds("c-4") === "");
  server.delete("i30"); // deleted in webmail while this app was offline
  online = true;
  await flushExchangeActions(EX);
  check("the item that is gone: the action is dropped", queue.rows.length === 0);
  check("its row is put back as it was", rowOf("i30")?.labels.join(",") === "INBOX", rowOf("i30")?.labels);
  check("the other item went to Deleted Items", [...server.entries()].some(([id, v]) => id.startsWith("i31~") && v.folder === "f-trash"));
  check("and the reader is told", refusals.length === 1 && refusals[0].kind === "trash" && refusals[0].account === EX, JSON.stringify(refusals));

  // ---- Refused by the server --------------------------------------------------------------
  refusals.length = 0;
  seed("c-5", 40);
  denied.add("i40");
  await archiveMailThread(EX, "c-5");
  check("a refused item is put back in the inbox", rowOf("i40")?.labels.join(",") === "INBOX");
  check("and said", refusals.length === 1 && /ErrorAccessDenied/.test(refusals[0].error), JSON.stringify(refusals));
  check("and not tried again", queue.rows.length === 0);
  denied.clear();

  // ---- A refused password stops the queue until a new connect --------------------------
  seed("c-6", 50);
  password = "wrong";
  requests = 0;
  await markMailThreadRead(EX, "c-6");
  check("the read is in the copy", threadRows("c-6").filter((r) => r.messageId.startsWith("i")).every((r) => !r.unread));
  check("one request, refused", requests === 1, requests);
  let stopped = "";
  try {
    await flushExchangeActions(EX);
  } catch (err) {
    stopped = err.message;
  }
  await archiveMailThread(EX, "c-6");
  check("no second sign-in, by the queue or by a new action", requests === 1, requests);
  check("the queue keeps both, uncounted", kinds() === "read,archive" && queue.rows.every((r) => r.attempts === 0), JSON.stringify(queue.rows));
  check("a flush says nothing more once stopped", stopped === "", stopped);
  // The reader connects again with the right password.
  password = "right";
  refusedLatch = false;
  resumeExchangeActions(EX);
  await flushExchangeActions(EX);
  check("after a new connect the queue goes", queue.rows.length === 0 && [...server.entries()].filter(([id]) => /^i5[01]~/.test(id)).every(([, v]) => v.isRead && v.folder === "f-arch"));
});
