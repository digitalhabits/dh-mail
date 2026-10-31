/**
 * Unschedule: a scheduled message becomes an ordinary draft, with Undo, and
 * is not lost.
 *
 * A message in this computer's outbox has no draft anywhere else. So its
 * draft is made here at once, with its words and its files, and the outbox
 * lets the message go only when the Undo time is over. Undo deletes the
 * draft again. If the draft cannot be saved, the message stays scheduled.
 * A message the mailbox holds (a scheduled draft, Outlook) is changed by
 * the server when the Undo time is over, and nothing is made here.
 *
 * Every address, word and file is invented.
 */

import { toastSink } from "sonner";

import { setMailApiTransport } from "@/lib/mail/api";
import { listMailDrafts } from "@/lib/mail/local-drafts";
import { unscheduleHeldWithUndo } from "@/components/mail/scheduled-undo";
import { isLeavingScheduled } from "@/lib/mail/scheduled-events";

import { check, suite } from "./harness.mjs";

// The Undo timers, run by hand. Other timers (the draft store's) run at once.
const waiting = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (run, ms, ...rest) => {
  if (ms >= 5000) {
    const handle = { run, cleared: false };
    waiting.push(handle);
    return handle;
  }
  return realSetTimeout(run, ms, ...rest);
};
const realClearTimeout = globalThis.clearTimeout;
globalThis.clearTimeout = (handle) => {
  if (handle && typeof handle === "object" && "cleared" in handle) handle.cleared = true;
  else realClearTimeout(handle);
};
const runUndoTimers = () => {
  for (const handle of waiting.splice(0)) if (!handle.cleared) handle.run();
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

const toasts = [];
toastSink.push = (t) => toasts.push(t);

/** An IndexedDB of one object store, kept in a Map. `failPut` makes every write fail. */
function fakeIndexedDb() {
  const rows = new Map();
  const state = { failPut: false };
  const request = (result, fail = false) => {
    const req = { result, error: fail ? new Error("disk full") : null, onsuccess: null, onerror: null };
    queueMicrotask(() => (fail ? req.onerror?.({ target: req }) : req.onsuccess?.({ target: req })));
    return req;
  };
  const store = {
    get: (key) => request(rows.get(key) ?? undefined),
    getAll: () => request([...rows.values()]),
    put: (value) => (state.failPut ? request(undefined, true) : request(rows.set(value.key, value))),
    delete: (key) => request(rows.delete(key)),
  };
  globalThis.indexedDB = {
    open: () => {
      const req = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => store,
          transaction: () => ({ objectStore: () => store, oncomplete: null, onerror: null }),
          close: () => {},
        },
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => req.onsuccess?.({ target: req }));
      return req;
    },
  };
  return { rows, state };
}

const held = (over) => ({
  id: "7",
  sendAt: "2026-10-31T01:40:00Z",
  account: "vera@example.org",
  threadId: "t1",
  toName: "bo@example.org",
  subject: "Plan",
  bodyText: "See the plan.",
  to: ["bo@example.org"],
  cc: [],
  signed: true,
  heldHere: true,
  status: "failed",
  missed: true,
  ...over,
});
const it = { account: "vera@example.org", id: "7" };

const PLAN = { filename: "plan.txt", mimeType: "text/plain", size: 9, contentBase64: "U3RlcCBvbmUu" };

let calls = [];
let db;
setMailApiTransport(async (_path, init) => {
  const body = JSON.parse(init?.body ?? "{}");
  calls.push(body.action);
  const answer =
    body.action === "unschedule" && body.id === "7"
      ? { success: true, kept: "local", attachments: [PLAN] }
      : { success: true, kept: "server" };
  return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
});

suite(async () => {
  // An outbox message: its draft at once, with its file; the outbox lets go later.
  db = fakeIndexedDb();
  calls = [];
  const going = unscheduleHeldWithUndo(held());
  check("the row leaves before the server has answered", isLeavingScheduled(it));
  await going;
  await settle();
  const drafts = await listMailDrafts();
  check("an outbox message is a draft here at once", drafts.length === 1, JSON.stringify(drafts.map((d) => d.subject)));
  const draft = drafts[0];
  check("the draft has the words", draft?.subject === "Plan" && /See the plan/.test(draft?.body ?? ""));
  check("the draft goes to the same people", draft?.toList?.[0]?.email === "bo@example.org");
  check(
    "the draft keeps the file",
    draft?.attachments?.length === 1 && draft.attachments[0].filename === "plan.txt" && draft.attachments[0].contentBase64 === "U3RlcCBvbmUu"
  );
  check("the signature is not put on twice", draft?.includeSignature === false);
  check("the draft has no time and replaces nothing", !draft?.replacesScheduled);
  check("the scheduled row leaves at once", isLeavingScheduled(it));
  const offer = toasts.at(-1);
  check("it says so, with Undo", Boolean(offer?.data?.action?.onClick), JSON.stringify(offer?.message));
  check("the outbox keeps it during the Undo time", !calls.includes("cancel"), JSON.stringify(calls));
  runUndoTimers();
  await settle();
  check("when the time is over, the outbox lets it go", calls.at(-1) === "cancel", JSON.stringify(calls));

  // Undo: the draft goes again, the message stays scheduled.
  db = fakeIndexedDb();
  calls = [];
  await unscheduleHeldWithUndo(held());
  await settle();
  toasts.at(-1).data.action.onClick();
  runUndoTimers();
  await settle();
  await settle();
  check("Undo deletes the draft again", (await listMailDrafts()).length === 0);
  check("and the outbox keeps the message", !calls.includes("cancel"), JSON.stringify(calls));
  check("and its row is back", !isLeavingScheduled(it));

  // The draft cannot be saved: the message stays scheduled.
  db = fakeIndexedDb();
  db.state.failPut = true;
  calls = [];
  const before = toasts.length;
  await unscheduleHeldWithUndo(held());
  runUndoTimers();
  await settle();
  check("a draft that cannot be saved is said", toasts.slice(before).some((t) => t.kind === "error"));
  check("and the outbox keeps the message", !calls.includes("cancel"), JSON.stringify(calls));
  check("and its row stays", !isLeavingScheduled(it));

  // A message the mailbox holds: the server is asked when the time is over.
  db = fakeIndexedDb();
  calls = [];
  await unscheduleHeldWithUndo(held({ id: "draft:3", heldHere: undefined }));
  check("a held draft makes nothing here", (await listMailDrafts()).length === 0);
  check("and asks nothing during the Undo time", calls.length === 0, JSON.stringify(calls));
  runUndoTimers();
  await settle();
  check("then the server unschedules it", calls.length === 1 && calls[0] === "unschedule", JSON.stringify(calls));
});
