/**
 * Outlook (Graph) actions with no network: the copy changes at once, the
 * action waits in the queue, and it goes to Graph when Graph can be reached.
 *
 * The scripted Graph keeps Graph's rules: a moved message has a new id and
 * the old one answers 404; a message that is gone answers 404. With the
 * network off, every request fails as fetch does, with no status.
 */

import { archiveMailThread, markMailThreadRead, trashMailThread, unarchiveMailThread } from "@/lib/mail/inbox";
import { moveMailThreadToFolder } from "@/lib/mail/folders";
import { forgetSyncStates } from "@/lib/mail/local-store";
import { forgetOutlookMoves, heldOutlookMoveCount } from "@/lib/mail/outlook-moves";
import { flushOutlookActions, outlookFailure, replayOutlookActions } from "@/lib/mail/outlook-queue";
import { rememberOutlookAccessToken } from "@/lib/mail/outlook-token";

import { fakeActionQueue, MAX_ATTEMPTS } from "./fake-action-queue.mjs";
import { check, suite } from "./harness.mjs";

const ME = "vera@outlook.example";
rememberOutlookAccessToken(ME, "tok");

// ---- Graph ---------------------------------------------------------------------------

let online = true;
let moves = 0;
/** Messages by id: their conversation, folder and read flag. */
const graph = new Map();
/** Message ids Graph refuses to move (403). */
const refuse = new Set();
const sent = [];

function seed(conversation, ids) {
  for (const [i, id] of ids.entries()) {
    graph.set(id, { conversationId: conversation, folder: "inbox", isRead: false, at: `2026-10-0${i + 1}T10:00:00Z` });
  }
}

globalThis.fetch = async (url, init) => {
  if (!online) throw new TypeError("Load failed");
  const at = decodeURIComponent(String(url).replace(/\+/g, " "));
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(init.body) : null;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  if (at.includes("login.microsoftonline.com")) return json({ access_token: "tok", expires_in: 3600 });
  sent.push({ method, url: at, body });
  const move = at.match(/\/me\/messages\/([^/?]+)\/move$/);
  if (move) {
    const m = graph.get(move[1]);
    if (!m) return json({ error: { code: "ErrorItemNotFound" } }, 404);
    if (refuse.has(move[1])) return json({ error: { code: "ErrorAccessDenied" } }, 403);
    moves += 1;
    const newId = `${move[1].split("~")[0]}~${moves}`;
    graph.delete(move[1]);
    graph.set(newId, { ...m, folder: body.destinationId });
    return json({ id: newId, conversationId: m.conversationId });
  }
  const patch = at.match(/\/me\/messages\/([^/?]+)$/);
  if (patch && method === "PATCH") {
    const m = graph.get(patch[1]);
    if (!m) return json({ error: { code: "ErrorItemNotFound" } }, 404);
    m.isRead = body.isRead;
    return json({ id: patch[1] });
  }
  const conversation = at.match(/conversationId eq '([^']+)'/);
  if (conversation && at.includes("/me/messages?")) {
    const value = [...graph.entries()]
      .filter(([, m]) => m.conversationId === conversation[1])
      .map(([id, m]) => ({ id, conversationId: m.conversationId, isRead: m.isRead, receivedDateTime: m.at, parentFolderId: m.folder }));
    return json({ value });
  }
  if (at.includes("/mailFolders")) {
    return json({ value: [{ id: "f-receipts", displayName: "Receipts", childFolderCount: 0, totalItemCount: 0, unreadItemCount: 0 }] });
  }
  return json({});
};

// ---- The store ---------------------------------------------------------------------------

const applied = [];
const replays = [];
const queue = fakeActionQueue({
  // As the Rust store does with `apply`: the copy changes, and the action
  // keeps how each message of the thread was.
  onApply: (row) => {
    applied.push(`${row.kind}:${row.threadId}`);
    const ids = [...graph.entries()].filter(([, m]) => m.conversationId === row.threadId).map(([id]) => id);
    row.payload.before = Object.fromEntries(ids.map((id) => [id, { labels: ["INBOX"], unread: true, starred: false }]));
  },
  onReplay: (row) => replays.push(row.kind),
});

const refusals = [];
globalThis.window = {
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (t) => clearTimeout(t),
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        if (cmd !== "mail_store_call") return null;
        const { op, args: a } = args;
        if (queue.isQueueOp(op)) return queue.call(op, a);
        if (op === "accounts.listForOwner") return a.provider === "outlook" ? [{ email: ME, ownerId: "local", inMailTab: true }] : [];
        if (op === "accounts.exists") return a.provider === "outlook" && a.email === ME;
        if (op === "accounts.getToken") return { refreshToken: "rt", ownerId: "local" };
        if (op === "accounts.listOwnedEmails") return a.emails;
        if (op === "sync.list") return [{ account: ME, folder: "", phase: "live", lastOkAt: 1 }];
        return null;
      },
    },
    event: {
      emit: async (name, payload) => {
        if (name === "mail-sync-action-failed") refusals.push(payload);
      },
    },
  },
};

const kinds = () => queue.rows.map((r) => r.kind).join(",");

suite(async () => {
  forgetSyncStates();
  forgetOutlookMoves();

  // ---- What a failure says ---------------------------------------------------------------
  check("no status (fetch threw) waits", outlookFailure(new TypeError("Load failed")) === "transient");
  check("a busy Graph waits", outlookFailure(Object.assign(new Error("busy"), { status: 429 })) === "transient");
  check("a sign-in to renew waits", outlookFailure(Object.assign(new Error("invalid_grant"), { status: 400 })) === "transient");
  check("a 404 is gone", outlookFailure(Object.assign(new Error("x"), { status: 404 })) === "gone");
  check("a 403 is a refusal", outlookFailure(Object.assign(new Error("x"), { status: 403 })) === "refused");

  // ---- Offline: read, then archive ------------------------------------------------------
  seed("c-1", ["m1", "m2"]);
  online = false;
  let threw = "";
  try {
    await markMailThreadRead(ME, "c-1");
    await archiveMailThread(ME, "c-1");
  } catch (err) {
    threw = err.message;
  }
  check("offline, read and archive do not fail", threw === "", threw);
  check("the copy is told of both at once", applied.join(",") === "read:c-1,archive:c-1", applied.join(","));
  check("both wait in the queue, in order", kinds() === "read,archive", kinds());
  check("not counted", queue.rows.every((r) => r.attempts === 0) && queue.rows[0].lastError === "Load failed", JSON.stringify(queue.rows.map((r) => r.lastError)));
  check("Graph has neither", graph.get("m1")?.isRead === false && graph.get("m1")?.folder === "inbox");

  // A pass wrote Graph's view: the queue goes back on top.
  await replayOutlookActions(ME);
  check("a pass puts the queue back on the copy", replays.join(",") === "read,archive", replays.join(","));
  for (let i = 0; i < 8; i += 1) await flushOutlookActions(ME);
  check("however long Graph is out of reach, nothing is given up", kinds() === "read,archive" && queue.rows.every((r) => r.attempts === 0));

  // ---- Online again -----------------------------------------------------------------------
  online = true;
  await flushOutlookActions(ME);
  check("back online, the queue is sent and empty", queue.rows.length === 0, kinds());
  const archived = [...graph.entries()].filter(([, m]) => m.conversationId === "c-1");
  check("Graph has them read, in Archive, under new ids", archived.length === 2 && archived.every(([id, m]) => id.includes("~") && m.isRead && m.folder === "archive"), JSON.stringify(archived));
  check("the moves are noted, so the copy keeps the rows between folders", heldOutlookMoveCount() === 2, heldOutlookMoveCount());
  check("no refusal was said", refusals.length === 0, JSON.stringify(refusals));

  // ---- A move to a named folder, offline, with the folder list read before ---------------
  seed("c-2", ["m3"]);
  await moveMailThreadToFolder({ account: ME, threadId: "c-2", folderName: "Receipts" }); // online: reads the folder list
  online = false;
  seed("c-3", ["m4"]);
  await moveMailThreadToFolder({ account: ME, threadId: "c-3", folderName: "Receipts" });
  check("offline, a move to a known folder waits with its id", queue.rows.at(-1)?.payload.folderId === "f-receipts" && queue.rows.at(-1)?.payload.label === "Receipts", JSON.stringify(queue.rows.at(-1)?.payload));
  online = true;
  await flushOutlookActions(ME);
  check("and goes there once online", [...graph.values()].filter((m) => m.conversationId === "c-3").every((m) => m.folder === "f-receipts"));

  // ---- Undo before Graph is back: neither goes out ---------------------------------------
  seed("c-7", ["m7"]);
  online = false;
  await archiveMailThread(ME, "c-7");
  await unarchiveMailThread(ME, "c-7");
  check("Undo takes the queued archive back: nothing waits", queue.rows.length === 0 && queue.cancelled.at(-1)?.kind === "archive", kinds());
  check("and the copy is put back as the archive found it", queue.restored.at(-1)?.before?.m7?.labels?.join(",") === "INBOX");
  online = true;
  const before = sent.length;
  await flushOutlookActions(ME);
  check("Graph hears of neither", sent.length === before && graph.get("m7")?.folder === "inbox");
  // A read and its undo too; a different action on the thread is not an undo.
  online = false;
  await markMailThreadRead(ME, "c-7");
  await archiveMailThread(ME, "c-7");
  check("an action that is not the undo is queued after it", kinds() === "read,archive", kinds());
  online = true;
  await flushOutlookActions(ME);

  // ---- Gone from the mailbox meanwhile ----------------------------------------------------
  seed("c-4", ["m5"]);
  online = false;
  await trashMailThread(ME, "c-4");
  graph.delete("m5"); // deleted on another device while this one was offline
  online = true;
  await flushOutlookActions(ME);
  check("a conversation that is gone: the action is dropped", queue.rows.length === 0, kinds());
  check("the copy is put back as it was", queue.restored.at(-1)?.before?.m5?.labels?.join(",") === "INBOX", JSON.stringify(queue.restored.at(-1)));
  check("and the reader is told", refusals.length === 1 && refusals[0].kind === "trash" && refusals[0].threadId === "c-4", JSON.stringify(refusals));

  // ---- Refused by Graph: counted, then given up -------------------------------------------
  refusals.length = 0;
  seed("c-5", ["m6"]);
  refuse.add("m6");
  await archiveMailThread(ME, "c-5");
  check("a refusal is counted and kept for another try", queue.rows[0]?.attempts === 1 && refusals.length === 0, JSON.stringify(queue.rows));
  await markMailThreadRead(ME, "c-5");
  check("the thread's later action waits behind the refused one", kinds() === "archive,read" && graph.get("m6")?.isRead === false, kinds());
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) await flushOutlookActions(ME);
  check("given up after the last try", queue.rows.length === 0, kinds());
  check("and then the read goes", graph.get("m6")?.isRead === true);
  check("put back, and said", queue.restored.at(-1)?.before?.m6 != null && refusals.length === 1 && refusals[0].kind === "archive", JSON.stringify(refusals));
  check("Graph still has it in the inbox", graph.get("m6")?.folder === "inbox");
});
