/**
 * The walk itself — see mounted-reader-composer.test.mjs.
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
        viewerId: "reader-composer-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await waitFor(() => (document.body.textContent || "").includes(SUBJECT));
    const rowLeaf = [...document.querySelectorAll("*")].filter(
      (e) => e.childElementCount === 0 && (e.textContent || "").includes(SUBJECT)
    );
    clickEl(rowLeaf[rowLeaf.length - 1]);
    assert(
      await waitFor(() => (document.body.textContent || "").includes("dry weather")),
      "the thread is open"
    );

    /* Reply in the Reader: the composer comes into the Reader. */
    await openReader();
    clickEl(readerAction("Reply"));
    assert(await waitFor(composerInReader), "Reply draws the composer inside the Reader");
    assert(reader(), "the Reader stays open");
    assert(reader().contains(composerInReader()), "the composer is a part of the Reader");
    assert(await waitFor(() => editorIn(composerInReader())), "with its editor");
    assert.equal(document.querySelectorAll(".ql-editor").length, 1, "one editor, not a second composer");
    assert(!readerAction("Reply") && !readerAction("Forward"), "the floating Reply and Forward go");
    assert(
      (composerInReader().textContent || "").includes(SENDER.name) ||
        (composerInReader().textContent || "").includes(SENDER.email),
      "the reply goes to the sender"
    );
    pass("Reply in the Reader opens the composer inside the Reader, and the Reader stays");

    /* Esc puts the composer away and keeps the draft. A second Esc closes. */
    writeReply(composerInReader(), "<p>I can bring the ladder on Friday.</p>");
    await sleep(300);
    editorIn(composerInReader()).focus();
    escapeFrom(editorIn(composerInReader()));
    assert(await waitFor(() => !composerInReader()), "Esc puts the composer away");
    assert(reader(), "and the Reader stays open");
    assert(!(document.body.textContent || "").includes("Discard draft?"), "Esc does not ask to discard");
    assert(await waitFor(() => readerAction("Reply")), "Reply and Forward are back");
    assert.equal(editorWords(), "I can bring the ladder on Friday.", "the words wait in the thread under the Reader");
    escapeFrom(document.activeElement ?? document.body);
    assert(await waitFor(() => !reader()), "a second Esc closes the Reader");
    pass("Esc closes the composer first and keeps the draft, then a second Esc closes the Reader");

    /* Closing the Reader with a draft open puts the composer in the thread. */
    await openReader();
    clickEl(readerAction("Reply"));
    assert(await waitFor(() => editorIn(composerInReader())), "Reply brings the composer back in");
    assert.equal(
      editorWords(composerInReader()),
      "I can bring the ladder on Friday.",
      "with the words written before"
    );
    clickEl(buttonsIn(reader()).find((b) => /^Back to thread/.test((b.textContent || "").trim())));
    assert(await waitFor(() => !reader()), "Back to thread closes the Reader");
    assert(await waitFor(() => editorIn(document)), "the composer is in the thread");
    assert.equal(editorWords(), "I can bring the ladder on Friday.", "with the words kept");
    pass("closing the Reader with a draft open shows the composer in the thread with the words");

    /* Words and Send: the reply goes, and the Reader stays. */
    await openReader();
    clickEl(readerAction("Reply"));
    assert(await waitFor(() => editorIn(composerInReader())), "the composer is in the Reader");
    writeReply(composerInReader(), "<p>The ladder is in the shed.</p>");
    await sleep(300);
    const send = buttonsIn(composerInReader()).find(
      (b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled
    );
    assert(send, "the reply can be sent from the Reader");
    clickEl(send);
    await sleep(300);
    assert(reader(), "the Reader stays open after Send");
    assert(await waitFor(() => !editorIn(document)), "Send closes the composer");
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(500);
    assert.equal(sends.length, 1, "one message went to the send route");
    assert.deepEqual(sends[0].to, [SENDER.email], "to the sender");
    assert(String(sends[0].html).includes("The ladder is in the shed."), "with the words");
    assert(reader(), "and the Reader is still open");
    assert(await waitFor(() => readerAction("Reply")), "with Reply back");
    pass("typing and Send send a reply to the sender, and the Reader stays open");

    /* Forward in the Reader: a forward composer, in the Reader. */
    clickEl(readerAction("Forward"));
    assert(await waitFor(composerInReader), "Forward draws a composer inside the Reader");
    assert(
      await waitFor(() =>
        [...composerInReader().querySelectorAll("input")].some(
          (i) => i.getAttribute("placeholder") === `Fwd: ${SUBJECT}`
        )
      ),
      "a forward, with its subject row"
    );
    const recipientBox = [...composerInReader().querySelectorAll("input")].find((i) =>
      /name@example\.com/.test(i.getAttribute("placeholder") || "")
    );
    assert(recipientBox, "and its recipient box");
    typeInto(recipientBox, "bo@havn.example,");
    await sleep(300);
    assert((composerInReader().textContent || "").includes("bo@havn.example"), "the recipient is taken");
    pass("Forward in the Reader opens a forward composer in it");

    /* The floating card, from inside the Reader. Discard the forward first,
       with a note in it, so there is something to take back. */
    writeReply(composerInReader(), "<p>A note for Bo.</p>");
    await sleep(300);
    clickEl(buttonsIn(composerInReader()).find((b) => /^discard/i.test(b.getAttribute("title") || "")));
    assert(await waitFor(() => !composerInReader()), "the bin puts the forward away");
    // Said where every other confirmation is: the stack at the foot, not a toast.
    assert(
      await waitFor(() =>
        [...document.querySelectorAll("[data-mail-reader] [data-undo-foot] [data-undo-card]")].some((c) =>
          (c.textContent || "").startsWith("Draft discarded")
        )
      ),
      "Draft discarded stands in the stack at the foot of the Reader"
    );
    pass("a discarded draft is confirmed in the stack, with Undo");
    clickEl(readerAction("Reply"));
    assert(await waitFor(() => editorIn(composerInReader())), "Reply opens the composer again");
    writeReply(composerInReader(), "<p>Written while reading.</p>");
    await sleep(300);
    const float = buttonsIn(composerInReader()).find((b) =>
      /^write while you browse/i.test(b.getAttribute("title") || "")
    );
    assert(float, "the composer in the Reader has its control for the floating card");
    clickEl(float);
    assert(
      await waitFor(() => document.querySelector(".mail-floating-reply .ql-editor")),
      "the reply moves to the floating card"
    );
    assert(reader(), "the Reader stays open");
    assert(!composerInReader(), "the Reader holds no composer now");
    assert(
      await waitFor(
        () => editorWords(document.querySelector(".mail-floating-reply")) === "Written while reading."
      ),
      "and the card has the words"
    );
    pass("the floating card control works from inside the Reader");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the Reader composer walk failed:", err);
    process.exit(1);
  }
}

void main();
