/**
 * Editing a scheduled message (2026-10-31).
 *
 * Edit opens the scheduled message itself: one edit per message, which
 * Edit opens again with the changes so far, and which is not listed in
 * Drafts. An outbox message comes with its files. In the composer, Don't
 * schedule keeps the words as a plain draft and the original is not sent.
 * The bin deletes the scheduled message. Both wait for their Undo.
 *
 * Every address, word and file is invented.
 */

import { toastSink } from "sonner";

import { setMailApiTransport } from "@/lib/mail/api";
import { listMailDrafts, saveComposeDraft } from "@/lib/mail/local-drafts";
import { editHeldInComposer } from "@/lib/mail/scheduled-held";
import { deleteEditedOriginal, keepEditAsDraft } from "@/components/mail/scheduled-undo";

import { check, suite } from "./harness.mjs";

// The Undo timers, run by hand. Other timers run as usual.
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

function fakeIndexedDb() {
  const rows = new Map();
  const request = (result) => {
    const req = { result, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  };
  const store = {
    get: (key) => request(rows.get(key) ?? undefined),
    getAll: () => request([...rows.values()]),
    put: (value) => request(rows.set(value.key, value)),
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
  return rows;
}

const PLAN = { filename: "plan.txt", mimeType: "text/plain", size: 9, contentBase64: "U3RlcCBvbmUu" };
let calls = [];
setMailApiTransport(async (_path, init) => {
  const body = JSON.parse(init?.body ?? "{}");
  calls.push(`${body.action}:${body.id}`);
  const answer =
    body.action === "unschedule" && /^\d+$/.test(body.id)
      ? { success: true, kept: "local", attachments: [PLAN] }
      : { success: true, kept: "server" };
  return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
});

const held = (over) => ({
  id: "12",
  sendAt: "2099-01-01T09:00:00Z",
  account: "vera@example.org",
  threadId: "",
  toName: "bo@example.org",
  subject: "Plan",
  bodyText: "See the plan.",
  to: ["bo@example.org"],
  cc: [],
  signed: true,
  heldHere: true,
  status: "waiting",
  ...over,
});

suite(async () => {
  // Edit an outbox message: one edit, with its file, opened again by Edit.
  const rows = fakeIndexedDb();
  calls = [];
  const opened = [];
  const startCompose = (seed) => opened.push(seed.draftKey);
  await editHeldInComposer(startCompose, held());
  const first = [...rows.values()][0];
  check("Edit makes one edit of the message", rows.size === 1 && first?.replacesScheduled?.id === "12");
  check("an outbox message comes with its file", first?.attachments?.[0]?.filename === "plan.txt");
  check("asking for the file changes nothing", calls.every((c) => c.startsWith("unschedule:")), JSON.stringify(calls));
  await editHeldInComposer(startCompose, held());
  check("Edit again opens the same edit", rows.size === 1 && opened[0] === opened[1], JSON.stringify(opened));
  // The Drafts view leaves out a draft marked so (use-mail-drafts.ts).
  check("the edit is marked as an edit of the message", (await listMailDrafts()).every((d) => d.replacesScheduled));

  // Don't schedule an outbox message: the original is deleted, after Undo.
  calls = [];
  const original = { account: "vera@example.org", id: "12", sendAt: "2099-01-01T09:00:00Z" };
  keepEditAsDraft(original, "Plan", { draftKey: opened[0], changed: true }, () => {});
  check("Don't schedule waits for its Undo", calls.length === 0, JSON.stringify(calls));
  check("and says so", toasts.at(-1)?.message === "Kept as a draft. It will not be sent.", toasts.at(-1)?.message);
  runUndoTimers();
  await settle();
  check("then the outbox message is deleted", calls.join() === "delete:12", JSON.stringify(calls));

  // Don't schedule a message the mailbox holds, unchanged: unscheduled there, one draft.
  fakeIndexedDb();
  calls = [];
  await saveComposeDraft({ key: "compose:e1", kind: "compose", from: "vera@example.org", subject: "Plan", body: "<p>x</p>", toList: [], ccList: [], bccList: [], showCc: false, showBcc: false, includeSignature: true, attachments: [] });
  keepEditAsDraft({ ...original, id: "draft:4" }, "Plan", { draftKey: "compose:e1", changed: false }, () => {});
  runUndoTimers();
  await settle();
  await settle();
  check("a held one is unscheduled where it is", calls.join() === "unschedule:draft:4", JSON.stringify(calls));
  check("and an unchanged edit goes, so there is one draft", (await listMailDrafts()).length === 0);

  // Undo of Don't schedule: nothing is asked, and the edit is handed back.
  calls = [];
  let undone = false;
  keepEditAsDraft(original, "Plan", { draftKey: "compose:e1", changed: true }, () => (undone = true));
  toasts.at(-1).data.action.onClick();
  runUndoTimers();
  await settle();
  check("Undo asks nothing of the server", calls.length === 0, JSON.stringify(calls));
  check("and hands the edit back", undone);

  // The bin while editing: the scheduled message is deleted, after Undo.
  calls = [];
  deleteEditedOriginal(original, "Plan", () => {});
  check("the bin waits for its Undo", calls.length === 0);
  runUndoTimers();
  await settle();
  check("then the scheduled message is deleted", calls.join() === "delete:12", JSON.stringify(calls));
});
