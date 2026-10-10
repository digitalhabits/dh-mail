/**
 * The walks — see mounted-signature-copy.test.mjs.
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

/** The Undo of a send, as the countdown pill holds it. See mounted-composer-send. */
let newestPill = null;
toast.custom = (render) => {
  newestPill = render;
  return "pill";
};
const pressUndo = () => {
  assert(newestPill, "a send offered its Undo");
  const pill = newestPill();
  newestPill = null;
  pill.props.onUndo();
};

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HOME = "lise@kollektiv.example";
const WORK = "lise@vaerksted.example";
const SIGNATURES = {
  [HOME]: "<p>Lise Lund</p><p>Formand for kollektivet</p>",
  [WORK]: "<p>Lise Lund</p><p>Keeper of the workshop</p>",
};

const SUBJECT = "Keys for the bike shed";
const THREAD = {
  account: HOME,
  threadId: "keys-1",
  subject: SUBJECT,
  fromName: "Ana Berg",
  fromEmail: "ana@kollektiv.example",
  snippet: "Who has the second key?",
  lastAt: "2026-10-09T08:00:00.000Z",
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Ana Berg", email: "ana@kollektiv.example" }],
};
const OTHER_SUBJECT = "Soup on Sunday";
const OTHER = {
  ...THREAD,
  threadId: "soup-1",
  subject: OTHER_SUBJECT,
  fromName: "Bo Holt",
  fromEmail: "bo@kollektiv.example",
  snippet: "I can make the soup.",
  lastAt: "2026-10-08T08:00:00.000Z",
  externalParticipants: [{ name: "Bo Holt", email: "bo@kollektiv.example" }],
};
const detail = (row, words) => ({
  thread: {
    account: HOME,
    threadId: row.threadId,
    subject: row.subject,
    participants: ["You", row.fromName],
    messages: [
      {
        id: `${row.threadId}-m1`,
        fromName: row.fromName,
        fromEmail: row.fromEmail,
        toEmails: [HOME],
        ccEmails: [],
        sentAt: row.lastAt,
        bodyText: words,
        own: false,
        rfcMessageId: `<${row.threadId}@kollektiv.example>`,
      },
    ],
    totalMessageCount: 1,
    hasOlder: false,
    hasNewer: false,
    reply: {
      inReplyTo: `<${row.threadId}@kollektiv.example>`,
      references: `<${row.threadId}@kollektiv.example>`,
      to: [row.fromEmail],
      cc: [],
      allTo: [row.fromEmail],
      allCc: [],
    },
  },
});

/** The drafts database, kept in a Map. See mounted-composer-send. */
const draftRows = new Map();
{
  const request = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  };
  const store = {
    get: (key) => request(draftRows.get(key) ?? undefined),
    getAll: () => request([...draftRows.values()]),
    put: (value) => request(draftRows.set(value.key, structuredClone(value))),
    delete: (key) => request(draftRows.delete(key)),
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
/** Every call that is not a read, by path. */
const writes = [];
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") writes.push(p);
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (p === "/api/mail/send") {
    sends.push(JSON.parse(String(init?.body ?? "{}")));
    return json({ ok: true, id: "sent-1", threadId: "sent-thread-1" });
  }
  if (p === "/api/mail/signature" && method === "GET") {
    return json({
      signature: SIGNATURES[url.searchParams.get("account")] ?? "",
      includeOnNew: true,
      onReplies: "every",
    });
  }
  if (p === "/api/mail/threads") return json({ threads: [THREAD, OTHER], nextCursor: null });
  if (p === "/api/mail/thread" && url.searchParams.get("id") === "soup-1")
    return json(detail(OTHER, "I can make the soup. Who brings bread?"));
  if (p === "/api/mail/thread")
    return json(detail(THREAD, "Who has the second key to the bike shed?"));
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
const buttons = (root = document) => [...root.querySelectorAll("button")];
const byTitle = (re, root = document) =>
  buttons(root).find((b) =>
    re.test((b.getAttribute("title") || "") + (b.getAttribute("aria-label") || ""))
  );
const typeInto = (el, value) => {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};

/** Write in a Quill box the way the other walks do: the DOM, then input. */
const writeIn = (editor, html) => {
  editor.innerHTML = html;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
};
/** The editor of the message itself. */
const bodyEditor = () => document.querySelector(".mail-message-editor .ql-editor");
/** The signature's editor, under the message. */
const signatureBox = () => document.querySelector("[data-signature-copy]");
const signatureEditor = () => signatureBox()?.querySelector(".ql-editor") ?? null;
const signatureWords = () => (signatureEditor()?.textContent || "").trim();

/** Put the caret at the start or the end of an editor's words. */
const putCaret = (editor, where) => {
  editor.focus();
  const walker = document.createTreeWalker(editor, window.NodeFilter.SHOW_TEXT);
  let first = null;
  let last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    first ??= node;
    last = node;
  }
  const node = where === "start" ? first : last;
  assert(node, "the editor has words");
  const range = document.createRange();
  range.setStart(node, where === "start" ? 0 : node.textContent.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};
const pressKey = (target, key) =>
  target.dispatchEvent(
    new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  );

/** Open the conversation whose row shows this subject. */
const openThread = async (subject, words) => {
  const leaf = [...document.querySelectorAll("*")].find(
    (e) => e.childElementCount === 0 && (e.textContent || "").trim() === subject
  );
  assert(leaf, `the list shows "${subject}"`);
  clickEl(leaf);
  await waitFor(() => (document.body.textContent || "").includes(words));
  await sleep(300);
  assert((document.body.textContent || "").includes(words), `"${subject}" is open`);
};
const sendButton = () =>
  buttons().find((b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled);
/** Press Send, then let the page go, which sends at once. */
const sendNow = async () => {
  const button = sendButton();
  assert(button, "the message can be sent");
  const before = sends.length;
  clickEl(button);
  await sleep(300);
  window.dispatchEvent(new window.Event("pagehide"));
  await waitFor(() => sends.length > before);
  assert.equal(sends.length, before + 1, "the message went to the send route");
  return sends[sends.length - 1];
};
/** Pick another sending address in the From menu. */
const pickFrom = async (current, account) => {
  const trigger = buttons().find(
    (b) => b.getAttribute("aria-haspopup") === "listbox" && (b.textContent || "").trim() === current
  );
  assert(trigger, "the composer has a From menu");
  clickEl(trigger);
  await sleep(200);
  // The row in the open menu, not the account's own button elsewhere.
  const menu = document.querySelector("[data-radix-popper-content-wrapper]");
  assert(menu, "the From menu opens");
  const row = buttons(menu).find((b) => (b.textContent || "").trim() === account);
  assert(row, `the From menu offers ${account}`);
  clickEl(row);
  await sleep(500);
};

async function main() {
  let root;
  try {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [HOME, WORK],
        viewerId: "signature-copy-viewer",
        ownAddresses: [HOME, WORK],
      })
    );
    await waitFor(() => (document.body.textContent || "").includes(SUBJECT));
    await openThread(SUBJECT, "second key");

    // ---- A reply with the signature as it is -------------------------------
    clickEl(byTitle(/^reply \(/i));
    await waitFor(() => signatureEditor());
    assert(signatureEditor(), "a reply shows the signature under the message");
    assert.equal(
      signatureEditor().getAttribute("contenteditable"),
      "true",
      "as a box that can be written in"
    );
    assert(signatureWords().includes("Formand for kollektivet"), signatureWords());
    assert(
      (signatureBox().getAttribute("title") || "").includes("this message only"),
      "the hover says that a change is for this message only"
    );
    pass("a reply shows the saved signature as an editor under the message");

    // Backspace in the signature, and beside it, deletes no conversation.
    for (const target of [signatureEditor(), signatureBox()]) {
      target.focus?.();
      target.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true })
      );
      await sleep(300);
    }
    assert(
      !writes.some((p) => /trash|delete|archive/i.test(p)),
      `no delete went out: ${writes.join(", ")}`
    );
    assert(bodyEditor(), "the reply is still open");
    pass("Backspace in the signature does not run the Delete shortcut");

    writeIn(bodyEditor(), "<p>I have the second key.</p>");
    await sleep(300);
    const plain = await sendNow();
    assert(!("signatureHtml" in plain), "a signature nobody changed sends no copy");
    assert.equal(plain.includeSignature, true, "and the saved signature goes on");
    pass("an unchanged signature sends as before");

    // ---- A reply with a changed signature ----------------------------------
    clickEl(byTitle(/^reply \(/i));
    await waitFor(() => signatureEditor());
    assert(
      signatureWords().includes("Formand for kollektivet"),
      "a new reply starts from the saved signature again"
    );
    writeIn(bodyEditor(), "<p>The key is under the mat.</p>");
    writeIn(signatureEditor(), "<p>Lise Lund</p><p>Chair of the collective</p>");
    // Longer than the 400 ms that a draft waits before it is stored.
    await sleep(800);
    const stored = draftRows.get(`thread:${HOME}:keys-1`);
    assert(stored, "the reply is in the draft store");
    assert(
      String(stored.signatureHtml).includes("Chair of the collective"),
      `the draft keeps the changed signature: ${stored.signatureHtml}`
    );
    pass("a changed signature is kept in the draft");

    await openThread(OTHER_SUBJECT, "Who brings bread?");
    assert(!signatureEditor(), "the other conversation has no reply open");
    await openThread(SUBJECT, "second key");
    await waitFor(() => signatureWords().includes("Chair of the collective"));
    assert(
      signatureWords().includes("Chair of the collective"),
      `the reopened draft shows the changed signature: ${signatureWords()}`
    );
    assert.equal(
      (bodyEditor()?.textContent || "").trim(),
      "The key is under the mat.",
      "with the words"
    );
    pass("a reopened draft keeps the changed signature");

    // Send, then Undo: the reply comes back with its own signature.
    const heldBefore = sends.length;
    clickEl(sendButton());
    await sleep(300);
    assert(!signatureEditor(), "Send closes the composer");
    pressUndo();
    await waitFor(() => signatureEditor());
    assert.equal(sends.length, heldBefore, "nothing went out");
    assert(
      signatureWords().includes("Chair of the collective"),
      `Undo puts the changed signature back: ${signatureWords()}`
    );
    pass("Undo after Send puts the changed signature back");

    const changed = await sendNow();
    assert(
      String(changed.signatureHtml).includes("Chair of the collective") &&
        !String(changed.signatureHtml).includes("Formand"),
      `the send carries the changed signature: ${changed.signatureHtml}`
    );
    assert(
      !writes.includes("/api/mail/signature"),
      "and the saved signature is not written"
    );
    pass("the changed signature goes out with the reply, and the saved one stays");

    // ---- A new message, and a change of From ---------------------------------
    clickEl(byTitle(/new email/i));
    await waitFor(() => signatureEditor());
    assert(signatureEditor(), "a new message shows the signature as an editor");
    assert(signatureWords().includes("Formand for kollektivet"), signatureWords());

    await pickFrom(HOME, WORK);
    await waitFor(() => signatureWords().includes("Keeper of the workshop"));
    assert(
      signatureWords().includes("Keeper of the workshop"),
      `a new From brings its own signature: ${signatureWords()}`
    );
    pass("an unchanged signature follows the From address");

    writeIn(signatureEditor(), "<p>Lise Lund</p><p>Keeper of the workshop and its keys</p>");
    await sleep(300);
    await pickFrom(WORK, HOME);
    assert(
      signatureWords().includes("Keeper of the workshop and its keys"),
      `a changed signature stays through a change of From: ${signatureWords()}`
    );
    pass("a changed signature is not lost when the From address changes");

    const toBox = [...document.querySelectorAll("input")].find((i) =>
      /start typing a name/i.test(i.getAttribute("placeholder") || "")
    );
    assert(toBox, "the new message has a To box");
    typeInto(toBox, "bo@kollektiv.example,");
    await sleep(300);
    writeIn(bodyEditor(), "<p>The workshop is open on Sunday.</p>");
    await sleep(300);

    // Down at the end of the message goes into the signature, and Up at
    // the start of the signature comes back.
    putCaret(bodyEditor(), "end");
    pressKey(bodyEditor(), "ArrowDown");
    await sleep(100);
    assert(
      signatureBox().contains(document.activeElement),
      `Down at the end of the message goes to the signature (focus: ${document.activeElement?.className})`
    );
    putCaret(signatureEditor(), "start");
    pressKey(signatureEditor(), "ArrowUp");
    await sleep(100);
    assert(
      bodyEditor().contains(document.activeElement) || document.activeElement === bodyEditor(),
      `Up at the start of the signature goes back to the message (focus: ${document.activeElement?.className})`
    );
    pass("the arrow keys move between the message and the signature");
    const fresh = await sendNow();
    assert.equal(fresh.account, HOME, "from the address picked last");
    assert(
      String(fresh.signatureHtml).includes("Keeper of the workshop and its keys"),
      `the new message carries the changed signature: ${fresh.signatureHtml}`
    );
    assert(!writes.includes("/api/mail/signature"), "and no signature was saved");
    pass("a new message sends its changed signature");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the signature walk failed:", err);
    try {
      root?.unmount();
    } catch {
      /* gone already */
    }
    process.exit(1);
  }
}

void main();
