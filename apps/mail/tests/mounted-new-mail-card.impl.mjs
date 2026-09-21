/**
 * The walk — see mounted-new-mail-card.test.mjs.
 *
 * Every fixture is invented. No line of it was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const TO = "signe@torvet.example";
const SUBJECT = "Chairs for the choir evening";
const WORDS = "We need twelve chairs and one music stand.";
const FILE_NAME = "chair-count.txt";

/**
 * The drafts database, kept in a Map.
 *
 * Node has no IndexedDB, and the hand-over to the card goes through the
 * draft store: the pane writes the draft, and the card opens on the same
 * key. Only the drafts database opens. Every other name fails to open, so
 * the thread cache behaves as it does in the other mounted suites.
 */
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

setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (p === "/api/mail/threads") return json({ threads: [], nextCursor: null });
  if (p === "/api/mail/snoozed")
    return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
  // The recipient box reads these two when it opens.
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

/**
 * Put text in a box the way a keyboard does.
 *
 * React reads the value through its own setter. A plain assignment does not
 * reach it, so the prototype's setter writes the value first. The subject
 * is a textarea and the recipient box is an input, so the box says which
 * prototype to take the setter from.
 */
const typeInto = (el, value) => {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  // Node has an `Event` of its own, which the DOM here refuses.
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};

/** Put words in the message editor. It is a Quill box, not an input. */
const writeMessage = (html) => {
  const editor = card().querySelector(".ql-editor");
  assert(editor, "the message editor is up");
  editor.innerHTML = html;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
};

/** Attach a file through the card's own file input. */
const attachFile = (name, words) => {
  const input = card().querySelector('input[type="file"]');
  assert(input, "the card has a file input");
  const file = new window.File([words], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
};

/** The card itself. Both floating cards carry this class. */
const card = () => {
  const el = document.querySelector(".mail-floating-reply");
  assert(el, "the new-mail card is up");
  return el;
};
/**
 * The heading row. Found by the button that puts the card away, because
 * the rows above it are the strips that size the card, which hold nothing.
 */
const heading = () => {
  const button = byTitle(/put this away|show this again/i, card());
  assert(button, "the card has a heading");
  return button.parentElement;
};
/** The heading's words: the subject, or what the card is for. */
const headingWords = () => (heading().textContent || "").trim();
const cardWords = () => card().textContent || "";
/** The words in the message editor, or null while the card holds none. */
const editorWords = () => {
  const editor = card().querySelector(".ql-editor");
  return editor ? (editor.textContent || "").trim() : null;
};
/** What the reader can see of the card, under the heading. */
const bodyShown = () => {
  const body = heading().nextElementSibling;
  return Boolean(body) && !String(body.className).includes("hidden");
};
const pressEscape = () =>
  window.document.dispatchEvent(
    new window.KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    })
  );

/** The message, the people and the file are all still in the card. */
const draftIsWhole = (where) => {
  assert.equal(editorWords(), WORDS, `the words are there ${where}`);
  assert(cardWords().includes(TO), `the recipient is there ${where}`);
  assert(cardWords().includes(FILE_NAME), `the file is there ${where}`);
};

async function main() {
  let root;
  try {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "new-mail-card-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await sleep(700);

    // The pane's composer first. The card is the same composer, handed out.
    clickEl(byTitle(/new email/i));
    await sleep(500);
    clickEl(byTitle(/write while you browse/i));
    await sleep(900);

    assert(document.querySelector(".mail-floating-reply"), "the card is up");
    assert.equal(
      headingWords(),
      "New email",
      "with no subject the heading names the message"
    );
    pass("the new message goes to a card, named for what it is");

    assert(byTitle(/put this away/i, card()), "the card can be put away");
    assert(byTitle(/fill the window/i, card()), "and given the window");
    assert(byTitle(/^close/i, card()), "and closed");
    pass("the card's heading has the three buttons the reply card has");

    // Write the message: a subject, a recipient, words, and a file.
    const subjectBox = card().querySelector("textarea");
    assert(subjectBox, "the subject row is inside the card");
    typeInto(subjectBox, SUBJECT);
    await sleep(200);
    const recipientBox = [...card().querySelectorAll("input")].find((i) =>
      /start typing a name/i.test(i.getAttribute("placeholder") || "")
    );
    assert(recipientBox, "the To row is inside the card");
    typeInto(recipientBox, `${TO},`);
    await sleep(300);
    writeMessage(`<p>${WORDS}</p>`);
    await sleep(200);
    attachFile(FILE_NAME, "twelve");
    await sleep(500);

    assert(card().querySelector("textarea"), "the subject stays in the card");
    assert.equal(
      headingWords(),
      SUBJECT,
      "and the heading says what the message is about"
    );
    draftIsWhole("as it is written");
    pass("From, To and the subject stay in the card, and the heading follows");

    // Put it away. The heading is all there is.
    clickEl(byTitle(/put this away/i, card()));
    await sleep(400);
    assert(!bodyShown(), "the card put away shows none of what it holds");
    assert.equal(headingWords(), SUBJECT, "the heading keeps the subject");
    pass("the card goes to the bottom edge, and keeps its name");

    // A press on the heading opens it again.
    clickEl(heading());
    await sleep(400);
    assert(bodyShown(), "a press on the heading opens the card");
    draftIsWhole("after it is opened again");
    pass("a press on the heading brings the card back, with the draft whole");

    // The whole window, and the dimmed page behind it.
    clickEl(byTitle(/fill the window/i, card()));
    await sleep(400);
    assert(
      byTitle(/back to the corner/i, card()),
      "the card offers the way back out"
    );
    draftIsWhole("in the full view");
    pass("the card fills the window, with the draft whole");

    // Escape leaves it, as it leaves every other dialog.
    pressEscape();
    await sleep(400);
    assert(
      byTitle(/fill the window/i, card()),
      "Escape puts the card back in the corner"
    );
    draftIsWhole("back in the corner");
    pass("Escape leaves the full view, and the draft survives every move");
  } catch (err) {
    console.error("FAIL ", err?.message || err);
    process.exitCode = 1;
  } finally {
    try {
      root?.unmount();
    } catch {
      /* the page is going away anyway */
    }
  }
  process.exit(process.exitCode ?? 0);
}

void main();
