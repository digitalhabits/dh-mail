/**
 * The walk itself — see mounted-reader-thread.test.mjs.
 *
 * Every fixture is invented. No line of them was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";
import { toast } from "@/lib/mail/toast";

import { waitFor } from "./mounted-dom.mjs";

globalThis.IS_REACT_ACT_ENVIRONMENT = false;

/* The toast library draws nothing here. Keep the send's pill quiet. */
toast.custom = () => "pill";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/*
  happy-dom lays nothing out. Inside a message bubble, a box is one 20px
  line for every 50 characters of its text, so a long message gets the
  Reader button. Every other box keeps happy-dom's empty rectangle.
*/
const LINE_CHARS = 50;
{
  const plain = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    const rect = plain.call(this);
    if (!this.closest?.(".mail-bubble-column")) return rect;
    const height = Math.ceil((this.textContent || "").length / LINE_CHARS) * 20;
    return { x: 0, y: 0, top: 0, left: 0, right: 400, bottom: height, width: 400, height, toJSON() {} };
  };
}

const ACCOUNT = "ulla@aavang.example";
const SUBJECT = "The roof over the bike shed";
const SENTENCE = "The new roof needs one more week of dry weather before we can paint it. ";
const SENDER = { name: "Ana Berg", email: "ana@kollektiv.example" };
const ROOF = {
  account: ACCOUNT,
  threadId: "roof-1",
  subject: SUBJECT,
  fromName: SENDER.name,
  fromEmail: SENDER.email,
  snippet: "The new roof needs one more week.",
  lastAt: "2026-10-10T09:30:00.000Z",
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [SENDER],
};
const ROOF_MESSAGES = [
  {
    id: "r1",
    fromName: SENDER.name,
    fromEmail: SENDER.email,
    toEmails: [ACCOUNT],
    ccEmails: [],
    sentAt: "2026-10-10T09:30:00.000Z",
    bodyText: SENTENCE.repeat(14).trim(),
    own: false,
    rfcMessageId: "<roof-r1@kollektiv.example>",
  },
  {
    id: "r2",
    fromName: "You",
    fromEmail: ACCOUNT,
    toEmails: [SENDER.email],
    ccEmails: [],
    sentAt: "2026-10-10T11:00:00.000Z",
    bodyText: "Then we paint it the week after.",
    own: true,
    rfcMessageId: "<roof-r2@aavang.example>",
  },
];

/** The drafts database, kept in a Map. See mounted-composer-send. */
{
  const rows = new Map();
  const request = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  };
  const store = {
    get: (key) => request(rows.get(key) ?? undefined),
    getAll: () => request([...rows.values()]),
    put: (value) => request(rows.set(value.key, structuredClone(value))),
    delete: (key) => request(rows.delete(key)),
  };
  globalThis.indexedDB = {
    open: (name) => {
      const req = {
        result: {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => store,
          transaction: () => ({ objectStore: () => store }),
          close: () => {},
        },
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      queueMicrotask(() => {
        if (name === "redd-plan-mail-drafts") req.onsuccess?.({ target: req });
        else {
          req.error = new Error("no such database in this suite");
          req.onerror?.({ target: req });
        }
      });
      return req;
    },
  };
}

/** The body of each call to the send route, oldest first. */
const sends = [];
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (p === "/api/mail/send") {
    sends.push(JSON.parse(String(init?.body ?? "{}")));
    return json({ ok: true, id: "sent-1", threadId: "roof-1" });
  }
  if (p === "/api/mail/threads") return json({ threads: [ROOF], nextCursor: null });
  if (p === "/api/mail/thread")
    return json({
      thread: {
        account: ACCOUNT,
        threadId: "roof-1",
        subject: SUBJECT,
        participants: ["You", SENDER.name],
        messages: ROOF_MESSAGES,
        totalMessageCount: ROOF_MESSAGES.length,
        hasOlder: false,
        hasNewer: false,
        reply: {
          inReplyTo: "<roof-r1@kollektiv.example>",
          references: "<roof-r1@kollektiv.example>",
          to: [SENDER.email],
          cc: [],
          allTo: [SENDER.email],
          allCc: [],
        },
      },
    });
  if (p === "/api/mail/snoozed")
    return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
  if (p === "/api/mail/contacts") return json({ contacts: [], sources: [] });
  if (p === "/api/mail/contact-lists") return json({ lists: [] });
  return json({});
});

const clickEl = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
};
const reader = () => document.querySelector("[data-mail-reader]");
const readerButton = () => document.querySelector("[data-reader-button]");
const buttonsIn = (scope) => [...scope.querySelectorAll("button")];
/** Reply or Forward, floating over the Reader. */
const readerAction = (label) =>
  reader() ? buttonsIn(reader()).find((b) => (b.textContent || "").trim() === label) : null;
/** The composer drawn inside the Reader. */
const composerInReader = () =>
  reader()?.querySelector("[data-reader-composer] .mail-composer-region") ?? null;
const editorIn = (scope) => scope?.querySelector(".ql-editor") ?? null;
const editorWords = (scope = document) => {
  const editor = editorIn(scope);
  return editor ? (editor.textContent || "").trim() : null;
};
const writeReply = (scope, html) => {
  const editor = editorIn(scope);
  assert(editor, "the reply editor is up");
  editor.innerHTML = html;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const typeInto = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const escapeFrom = (el) =>
  el.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

async function openReader() {
  assert(await waitFor(readerButton), "the long message has the Reader button");
  clickEl(readerButton());
  assert(await waitFor(reader), "the button opens the Reader");
}

async function main() {
  let root;
  try {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "reader-thread-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await waitFor(() => (document.body.textContent || "").includes(SUBJECT));
    const rowLeaf = [...document.querySelectorAll("*")].filter(
      (e) => e.childElementCount === 0 && (e.textContent || "").includes(SUBJECT)
    );
    clickEl(rowLeaf[rowLeaf.length - 1]);
    assert(
      await waitFor(() => (document.body.textContent || "").includes("paint it the week after")),
      "the thread is open, both messages"
    );

    /* The Reader button is in the bubble's hover controls, under Reply. */
    assert(await waitFor(readerButton), "the long message has the Reader button");
    const rail = readerButton().parentElement;
    const railButtons = [...rail.querySelectorAll("button")];
    const replyAt = railButtons.findIndex((b) => b.getAttribute("aria-label") === "Reply to this message");
    assert(replyAt >= 0 && railButtons.indexOf(readerButton()) === replyAt + 1, "right under Reply in the rail");
    assert.equal(document.querySelectorAll("[data-reader-button]").length, 1, "only the long message has it");
    pass("the Reader button is in the hover controls, under Reply, on a long message only");

    /* The Reader holds the one message it was opened from. */
    clickEl(readerButton());
    assert(await waitFor(reader), "it opens the Reader");
    const entries = () => [...reader().querySelectorAll("[data-reader-entry]")].map((el) => el.getAttribute("data-reader-entry"));
    assert.deepEqual(entries(), ["r1"], "the long message alone");
    assert(!/paint it the week after/.test(reader().textContent || ""), "not the reply under it");
    escapeFrom(reader());
    assert(await waitFor(() => !reader()), "Esc closes it");
    pass("the Reader shows the one message");

    /* The toolbar's button shows the thread pane itself over the whole window. */
    const fullWindow = () => document.querySelector("[data-thread-full-window]");
    const toolbarButton = () =>
      [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Show the thread in the whole window");
    assert(await waitFor(toolbarButton), "the toolbar has the button");
    assert(!fullWindow(), "the thread starts in its pane");
    clickEl(toolbarButton());
    assert(await waitFor(fullWindow), "it fills the window");
    const pane = fullWindow();
    assert(pane.classList.contains("fixed") && pane.classList.contains("inset-0"), "over the whole window");
    assert.equal(pane.parentElement.parentElement, document.body, "drawn into the page itself, over everything");
    const bar = pane.querySelector("[data-thread-full-window-bar]");
    assert(bar, "under the quiet bar");
    assert.equal(bar.querySelector("h2")?.textContent, SUBJECT, "with the subject in the middle");
    assert(!toolbarButton(), "the toolbar is not in it");
    const barLabels = [...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    assert(!barLabels.includes("Reply"), `no Reply in the bar, it is in the tray: ${barLabels.join(", ")}`);
    assert(barLabels.includes("More"), "the bar has the … menu");
    assert(pane.querySelector("[data-reply-tray]"), "the reply tray floats over the thread");
    const text = pane.textContent || "";
    assert(/paint it the week after/.test(text) && /dry weather before we can paint/.test(text), "the same bubbles, both messages");
    assert(!reader(), "it is not the Reader");
    pass("the toolbar's button shows the thread over the whole window, under a quiet bar");

    document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert(await waitFor(() => !fullWindow()), "Esc goes back to the pane");
    assert(await waitFor(toolbarButton), "with its toolbar");
    clickEl(toolbarButton());
    assert(await waitFor(fullWindow), "open again");
    clickEl(fullWindow().querySelector("[data-thread-full-window-exit]"));
    assert(await waitFor(() => !fullWindow()), "Exit reader goes back to the pane");
    pass("Esc and Exit reader go back to the thread in its pane");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the Reader thread walk failed:", err);
    process.exit(1);
  }
}

void main();
