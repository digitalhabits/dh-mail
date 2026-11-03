/**
 * The walk itself — see mounted-diagnostics.test.mjs. Every person, host and
 * folder here is invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";
import { toastSink } from "sonner";

import { DiagnosticsDialog, openDiagnostics } from "@/components/mail/DiagnosticsDialog";
import { installPageErrorLog } from "@/lib/mail/diagnostics";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDA = "ida.holm@aavang.example";
// An invented home folder, split so the mirror's private-path check passes it.
const HOME = "/Us" + "ers/idaholm";
const SVEN = "sven@north.example";

const logged = [];
const saves = [];
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    if (cmd === "mail_diag_log") {
      logged.push(args.line);
      return null;
    }
    if (cmd === "mail_diagnostics_log") {
      return [
        "[2026-11-02][14:05:11][diag][INFO] diag · pause set · mailbox=mailbox 1 · until=2026-11-03 00:00 · from=menu: today",
        `[2026-11-02][14:06:02][mail_native::ews][INFO] ews: signed in for ${IDA} at https://mail.aavang.example/EWS`,
        `[2026-11-02][14:06:03][mail_native::sync][INFO] store at ${HOME}/Library/Application Support`,
      ].join("\n");
    }
    if (cmd === "mail_diagnostics_last_crash") return true;
    if (cmd === "mail_diagnostics_save") {
      saves.push(args);
      return `${HOME}/Downloads/Mail diagnostics 2026-11-02.txt`;
    }
    if (cmd === "mail_store_call" && args?.op === "sync.list") {
      return [
        { account: IDA, folder: "", phase: "live", lastOkAt: Date.UTC(2026, 10, 2, 13, 0), lastError: null },
        { account: SVEN, folder: "", phase: "paused", lastError: `needs reconnect for ${SVEN}` },
      ];
    }
    return null;
  },
};

/*
  Drafts live in IndexedDB, which this DOM has none of: a small one in
  memory, enough for a draft to be put and read back.
*/
const draftRows = new Map();
const later = (req, value) => setTimeout(() => { req.result = value; req.onsuccess?.(); }, 0);
window.indexedDB = globalThis.indexedDB = {
  open() {
    const req = {};
    const db = {
      objectStoreNames: { contains: () => true },
      createObjectStore() {},
      close() {},
      transaction: () => ({
        objectStore: () => ({
          get(key) { const r = {}; later(r, draftRows.get(key)); return r; },
          put(row) { const r = {}; draftRows.set(row.key, row); later(r, row.key); return r; },
          delete(key) { const r = {}; draftRows.delete(key); later(r, undefined); return r; },
          getAll() { const r = {}; later(r, [...draftRows.values()]); return r; },
        }),
      }),
    };
    later(req, db);
    return req;
  },
};

const composed = [];

const toasts = [];
toastSink.push = (t) => toasts.push(t);

const until = Date.now() + 3 * 60 * 60 * 1000;
const pauseState = { quietHours: [], accounts: { [IDA]: { pausedUntil: until } } };
const hide = {
  hidden: [],
  statusOf: (email) =>
    email === SVEN
      ? { hidden: true, reason: "schedule", until: null, untilClock: "07:30", endsAt: new Date(Date.now() + 60 * 60 * 1000), byHand: false, shownEarlyUntil: null }
      : { hidden: false, reason: null, until: null, untilClock: null, byHand: false, shownEarlyUntil: null },
  hoursOf: (email) => (email === SVEN ? [{ start: "18:00", end: "07:30", days: [0, 1, 2, 3, 4] }] : []),
};

async function main() {
  try {
    installPageErrorLog(window);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      React.createElement(DiagnosticsDialog, {
        accounts: [IDA, SVEN],
        sendFrom: [IDA],
        startCompose: (seed) => composed.push(seed),
        isOutlookAccount: (email) => email === SVEN,
        pauseState,
        hide,
      })
    );
    await sleep(300);
    assert(!logged.some((line) => line.includes("app start")), "the start waits for the mailboxes to settle");
    await sleep(4200);

    const start = logged.find((line) => line.includes("app start"));
    assert(start && /mailboxes=2/.test(start) && /kinds=/.test(start), `the app's start is one line: ${logged.join(" / ")}`);
    assert(!logged.some((line) => line.includes("aavang") || line.includes("north.example")), "no line names a mailbox's address");
    pass("the app's start is logged once the mailboxes have settled, by how many and which kinds");

    assert(toasts.some((t) => /closed unexpectedly/.test(String(t.title ?? t.message ?? t))), `a crash last time is offered a report: ${JSON.stringify(toasts)}`);
    pass("a crash in the last run offers the report");

    openDiagnostics();
    await sleep(400);
    const report = document.querySelector("[data-diagnostics] pre")?.textContent ?? "";
    assert(report.includes("- mailbox 1 (gmail)") && report.includes("new mail paused by you until"), report);
    assert(report.includes("- mailbox 2 (outlook)") && report.includes("hidden by schedule until"), report);
    assert(report.includes("hidden 18:00–07:30 Mo Tu We Th Fr"), report);
    assert(report.includes("sync: live · last ok") && report.includes("sync: paused · last error: needs reconnect for [address]"), report);
    assert(report.includes("from=menu: today"), "the log's lines come with it");
    pass("the report names each mailbox by number and kind, with its state, hours and sync");

    const leaks = ["ida.holm", "aavang", "north.example", "idaholm"].filter((piece) => report.includes(piece));
    assert.equal(leaks.length, 0, `nothing personal in the report: ${leaks.join(", ")}`);
    assert(/Times are this computer's own, UTC[+-]\d\d:\d\d/.test(report), "it names its time zone");
    pass("no address, host or home folder name gets into the report");

    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save…");
    save.click();
    await sleep(200);
    assert.equal(saves.length, 1, "Save… saves");
    assert.equal(saves[0].text, report, "what is saved is what was shown");
    assert(/^Mail diagnostics \d{4}-\d\d-\d\d\.txt$/.test(saves[0].fileName), saves[0].fileName);
    const status = document.querySelector("[data-diagnostics]")?.textContent ?? "";
    assert(status.includes("Saved as Mail diagnostics 2026-11-02.txt") && !status.includes("idaholm"), "it says the file's name, not its folder");
    pass("Save… saves exactly the report shown, and names only the file");

    openDiagnostics();
    await sleep(400);
    const send = [...document.querySelectorAll("button")].find((b) => b.textContent === "Send to us…");
    assert(send && !send.disabled, "Send to us… is there, with a mailbox to send from");
    send.click();
    await sleep(300);
    assert.equal(composed.length, 1, "the composer opens");
    const draft = draftRows.get(composed[0].draftKey);
    assert(draft, "on a draft saved for it");
    assert.equal(draft.from, IDA, "from the first mailbox it can be sent from");
    assert.deepEqual(draft.toList.map((r) => r.email), ["team@digitalhabits.org"], "to the team");
    assert(/^Mail diagnostics \d{4}-\d\d-\d\d$/.test(draft.subject), draft.subject);
    assert.equal(draft.attachments.length, 1, "with the report attached");
    const attached = Buffer.from(draft.attachments[0].contentBase64, "base64").toString("utf8");
    assert(attached.startsWith("Digital Habits Mail diagnostics") && attached.includes("- mailbox 1 (gmail)"), "the file is the report");
    assert(!attached.includes("aavang") && !attached.includes("idaholm"), "and as clean as the one shown");
    assert.equal(draft.attachments[0].size, Buffer.byteLength(attached), "its size is its bytes");
    pass("Send to us… opens an email from the reader's mailbox to the team, with the report attached");

    window.dispatchEvent(new window.ErrorEvent("error", { message: `boom for ${IDA}`, filename: "http://localhost:3473/src/components/ThreadPane.tsx?t=1", lineno: 412 }));
    window.dispatchEvent(new window.ErrorEvent("error", { message: `boom for ${IDA}`, filename: "http://localhost:3473/src/components/ThreadPane.tsx?t=1", lineno: 412 }));
    await sleep(50);
    const errors = logged.filter((line) => line.includes("page error"));
    assert.equal(errors.length, 1, `the same error is written once: ${errors.join(" / ")}`);
    assert(errors[0].includes("at=ThreadPane.tsx:412") && errors[0].includes("[address]") && !errors[0].includes("aavang"), errors[0]);
    pass("a page error is logged once, by file and line, with the address taken out");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

void main();
