/**
 * The Exchange (EWS) worker against a scripted EWS.
 *
 * What it must do without anybody watching (section 11.3 of
 * docs/mail-exchange-ews.md): read the folder list, walk the inbox before
 * the rest, label each row by its folder, keep a sync state per folder after
 * each page, take a deleted item out of its own folder only, read a folder
 * again when the server forgets its sync state, and stop at once, with no
 * second try, when the server refuses the password.
 *
 * The EWS commands are faked at the shell, in the shape Rust returns them.
 * Built as the internal app: Exchange is not in the public one.
 */

import { defaultExchangeServer, domainOf } from "@/lib/mail/exchange-connect";
import { applyHierarchy, emptyFolderState, exchangeFolderRows, exchangeLabelFor } from "@/lib/mail/exchange-folders";
import {
  BACKOFF_MS,
  exchangeSyncRunning,
  retryAfter,
  rowFromItem,
  startExchangeSync,
  stopExchangeSync,
  wakeExchangeSync,
} from "@/lib/mail/exchange-sync";
import { setMailStore } from "@/lib/mail/store";

import { check, suite } from "./harness.mjs";

const EX = "someone@mail.example.com";

// ---- The store ------------------------------------------------------------------

const settings = {};
const states = [];
const upserts = [];
const removals = [];
setMailStore({
  settings: {
    get: async (key) => settings[key] ?? null,
    set: async (key, value) => {
      settings[key] = value;
    },
  },
  sync: {
    list: async () => states.map((s) => ({ ...s })),
    set: async (state) => {
      const i = states.findIndex((s) => s.account === state.account && s.folder === state.folder);
      if (i >= 0) states[i] = { ...state };
      else states.push({ ...state });
    },
  },
  messages: {
    upsertMany: async (account, rows) => upserts.push(...rows.map((r) => ({ ...r, account }))),
    removeMessages: async (account, ids, options) => removals.push({ ids: [...ids], leftFolder: options?.leftFolder ?? null }),
  },
});

// ---- The server -------------------------------------------------------------------

const folder = (id, parentId, name, total) => ({ id, parentId, name, folderClass: "IPF.Note", total, unread: 0, childCount: 0 });
const FOLDERS = [
  folder("f-arch", "f-root", "Archive", 1),
  folder("f-proj", "f-inbox", "Projects", 1),
  folder("f-sent", "f-root", "Sent Items", 1),
  folder("f-inbox", "f-root", "Inbox", 2),
  folder("f-out", "f-root", "Outbox", 0),
];
const WELL_KNOWN = { inbox: "f-inbox", sentitems: "f-sent", archive: "f-arch", outbox: "f-out", msgfolderroot: "f-root" };

const item = (id, fields = {}) => ({
  id,
  conversationId: `c-${id}`,
  internetMessageId: `<${id}@mail.example.com>`,
  itemClass: "IPM.Note",
  subject: ` Mail ${id} `,
  from: { name: "Dana Example", email: "dana@example.com" },
  sender: null,
  to: [{ name: "", email: EX }],
  cc: [],
  receivedAt: Date.parse("2026-09-21T08:00:00Z"),
  sentAt: null,
  isRead: false,
  isDraft: false,
  flagStatus: "NotFlagged",
  preview: "A few words.",
  hasAttachments: false,
  size: 4000,
  ...fields,
});

const calls = [];
let refuseNext = false;
let badStateOnce = false;
function hierarchy(args) {
  if (args.syncState) return { folders: [], deleted: [], wellKnown: null, syncState: "h-2" };
  return { folders: FOLDERS, deleted: [], wellKnown: WELL_KNOWN, syncState: "h-1" };
}
function items(args) {
  if (refuseNext) throw "ews:refused: The server refused the password. Connect the account again with the current password.";
  if (args.folderId === "f-inbox" && args.syncState === "i-2" && badStateOnce) {
    badStateOnce = false;
    throw "ews:fault: ErrorInvalidSyncStateData: Synchronization state data is corrupt or otherwise invalid.";
  }
  if (args.folderId === "f-inbox" && !args.syncState) {
    return { items: [item("in-1")], deleted: [], syncState: "i-1", lastPage: false };
  }
  if (args.folderId === "f-inbox" && args.syncState === "i-1") {
    return { items: [item("in-2", { flagStatus: "Flagged", isRead: true })], deleted: ["gone-1"], syncState: "i-2", lastPage: true };
  }
  const one = { "f-proj": "pr-1", "f-sent": "se-1", "f-arch": "ar-1" }[args.folderId];
  if (one && !args.syncState) return { items: [item(one)], deleted: [], syncState: `${args.folderId}-1`, lastPage: true };
  return { items: [], deleted: [], syncState: args.syncState ?? "x", lastPage: true };
}

const listTold = [];
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (cmd, args) => {
        calls.push({ cmd, ...args });
        if (cmd === "mail_ews_sync_hierarchy") return hierarchy(args);
        if (cmd === "mail_ews_sync_items") return items(args);
        // The newest of the inbox first: one row, newest first.
        if (cmd === "mail_ews_newest_items") return { items: [item("in-2")], keys: { "in-2": "ck-in-2" } };
        if (cmd === "mail_ews_fetch_missing_bodies") return { kept: 0, more: false };
        if (cmd === "mail_ews_folder_counts") {
          return args.folderIds.map((id) => ({ ...FOLDERS.find((f) => f.id === id), total: 99, unread: 7 }));
        }
        throw new Error(`no such command in this test: ${cmd}`);
      },
    },
  },
  // What the list was told, and how far the reading had got by then.
  dispatchEvent: (event) => {
    if (event?.type === "redd-mail-sync-changed") listTold.push(itemCalls().length);
    return true;
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.dispatchEvent = () => true;

async function until(ok, what) {
  for (let i = 0; i < 400; i += 1) {
    if (ok()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  check(`in time: ${what}`, false);
  return false;
}

const itemCalls = () => calls.filter((c) => c.cmd === "mail_ews_sync_items");
const stateOf = (id) => states.find((s) => s.account === EX && s.folder === id);

suite(async () => {
  // ---- Pure parts ----------------------------------------------------------------
  const tree = applyHierarchy(emptyFolderState(), { folders: FOLDERS, deleted: [], wellKnown: WELL_KNOWN, syncState: "h-1" });
  const rows = exchangeFolderRows(tree);
  check("the inbox comes first", rows[0].id === "f-inbox");
  check("a subfolder has its path", rows.some((r) => r.path === "Inbox/Projects"));
  check("the outbox is left out", !rows.some((r) => r.id === "f-out"));
  check("labels follow the Outlook worker", [
    exchangeLabelFor(rows.find((r) => r.id === "f-inbox")) === "INBOX",
    exchangeLabelFor(rows.find((r) => r.id === "f-sent")) === "SENT",
    exchangeLabelFor(rows.find((r) => r.id === "f-arch")) === null,
    exchangeLabelFor(rows.find((r) => r.id === "f-proj")) === "Inbox/Projects",
  ].every(Boolean));
  const gone = applyHierarchy(tree, { folders: [], deleted: ["f-proj"], wellKnown: null, syncState: "h-2" });
  check("a deleted folder goes, and the known ids stay", !gone.folders["f-proj"] && gone.wellKnown.inbox === "f-inbox");

  const flagged = rowFromItem(item("x", { flagStatus: "Flagged", isDraft: true, isRead: true }), "Inbox/Projects");
  check("a row wears its folder, DRAFT and STARRED", flagged.labels.join(",") === "Inbox/Projects,DRAFT,STARRED", flagged.labels.join(","));
  check("a row is read, starred, and trimmed", !flagged.unread && flagged.starred && flagged.subject === "Mail x");
  check("the conversation is the thread", flagged.threadId === "c-x");

  check("a refused password is never tried again", retryAfter("ews:refused: no", 0) === null);
  check("a missing account is not tried again", retryAfter("ews:no-account: no", 3) === null);
  check("a busy server gives its own wait", retryAfter("ews:busy: The server is busy. Try again after 4500 ms.", 0) === 4500);
  check("a network error backs off as Outlook does", retryAfter("ews:network: no answer", 1) === BACKOFF_MS[1]);

  // Domains, not addresses: this file is published, and names no mailbox.
  check("a KU faculty domain gets the KU server", defaultExchangeServer("adm.ku.dk") === "https://mail.ku.dk/EWS/Exchange.asmx");
  check("other domains get none", defaultExchangeServer("example.com") === "");

  // The Autodiscover test switch (dhExchange.testDiscovery): with it on,
  // no server is filled in, KU's included, so "Find server" is offered.
  {
    const hadWindow = "window" in globalThis;
    const before = globalThis.window;
    const stored = new Map([["redd-plan-mail-exchange-search-known", "1"]]);
    globalThis.window = { localStorage: { getItem: (k) => stored.get(k) ?? null } };
    check("with the test switch on, KU gets no server filled in", defaultExchangeServer("ku.dk") === "");
    stored.clear();
    check("and with it off, KU's server is back", defaultExchangeServer("ku.dk") === "https://mail.ku.dk/EWS/Exchange.asmx");
    if (hadWindow) globalThis.window = before;
    else delete globalThis.window;
  }
  check("the domain is the part after the @", domainOf("Someone@Mail.Example.com") === "mail.example.com");

  // ---- The first pass ---------------------------------------------------------------
  check("the worker starts", startExchangeSync(EX));
  await until(() => stateOf("")?.phase === "live", "the first pass ends");
  const hierarchyCalls = calls.filter((c) => c.cmd === "mail_ews_sync_hierarchy");
  check("the folder list is read first, from nothing", hierarchyCalls[0]?.syncState === null && calls[0].cmd === "mail_ews_sync_hierarchy");
  check("the inbox is read before the rest", itemCalls()[0]?.folderId === "f-inbox");
  const newestAt = calls.findIndex((c) => c.cmd === "mail_ews_newest_items");
  const firstItemsAt = calls.findIndex((c) => c.cmd === "mail_ews_sync_items");
  check(
    "the inbox's newest mail is read first, once",
    newestAt >= 0 && newestAt < firstItemsAt && calls.filter((c) => c.cmd === "mail_ews_newest_items").length === 1 && calls[newestAt].folderId === "f-inbox"
  );
  check(
    "and the full read is told its rows, so they are not read twice",
    itemCalls().filter((c) => c.folderId === "f-inbox").every((c) => c.known?.["in-2"] === "ck-in-2")
  );
  check("other folders get no head start", itemCalls().filter((c) => c.folderId !== "f-inbox").every((c) => !c.known));
  check("the outbox is not read", !itemCalls().some((c) => c.folderId === "f-out"));
  check(
    "the list is told when the newest mail lands, before the read of the folder",
    listTold.length > 0 && listTold[0] === 0,
    listTold.join(",")
  );
  check("the inbox's second page follows its first", itemCalls()[1]?.folderId === "f-inbox" && itemCalls()[1]?.syncState === "i-1");
  check("each folder ends live with its state", stateOf("f-inbox")?.phase === "live" && stateOf("f-inbox")?.deltaLink === "i-2");
  const byId = new Map(upserts.map((r) => [r.messageId, r]));
  check("inbox rows are INBOX", byId.get("in-1")?.labels.includes("INBOX"));
  check("a flagged row is STARRED", byId.get("in-2")?.labels.includes("STARRED") && byId.get("in-2")?.unread === false);
  check("subfolder rows wear the path", byId.get("pr-1")?.labels.includes("Inbox/Projects"));
  check("archive rows wear no label", byId.get("ar-1")?.labels.length === 0);
  check("a delete leaves this folder only", removals.some((r) => r.ids.includes("gone-1") && r.leftFolder === "INBOX"));
  check("the tree is kept", JSON.parse(settings[`dh-mail-exchange-folders:${EX}`] ?? "{}").syncState === "h-1");
  const counted = calls.find((c) => c.cmd === "mail_ews_folder_counts");
  check("a pass with changes asks for those folders' counts", counted?.folderIds.includes("f-inbox") && !counted.folderIds.includes("f-out"));
  const kept = JSON.parse(settings[`dh-mail-exchange-folders:${EX}`] ?? "{}").folders ?? {};
  check("and keeps them for the rail", kept["f-inbox"]?.total === 99 && kept["f-inbox"]?.unread === 7);

  // ---- An inbox pass, with a sync state the server forgot ------------------------
  badStateOnce = true;
  const before = itemCalls().length;
  wakeExchangeSync(EX, "inbox");
  await until(() => itemCalls().length >= before + 3, "the inbox is read again");
  const again = itemCalls().slice(before);
  check("an inbox pass reads the inbox only", again.every((c) => c.folderId === "f-inbox"), again.map((c) => c.folderId).join(","));
  check("a forgotten state reads the folder from the start", again[0]?.syncState === "i-2" && again[1]?.syncState === null);

  // ---- A refused password ------------------------------------------------------------
  refuseNext = true;
  const atRefusal = calls.length;
  wakeExchangeSync(EX, "inbox");
  await until(() => stateOf("")?.phase === "paused", "the refusal is shown");
  check("the row asks for the password", /^needs reconnect: ews:refused/.test(stateOf("")?.lastError ?? ""), stateOf("")?.lastError);
  check("the worker stopped", !exchangeSyncRunning().includes(EX));
  await new Promise((r) => setTimeout(r, 700));
  check("no second try with the old password", calls.length === atRefusal + 1, calls.length - atRefusal);
  check("a new connect can start it again", startExchangeSync(EX));
  refuseNext = false;
  await stopExchangeSync(EX);
});
