/**
 * The walks — see mounted-composer-send.test.mjs.
 *
 * Every fixture is invented. No line of them was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";
import { toast } from "@/lib/mail/toast";
import { recipientsFromEmails } from "@/lib/mail/contact-list-types";
import { threadDraftKey } from "@/lib/mail/local-drafts";

/**
 * The Undo of a send, as the countdown pill holds it.
 *
 * The toast library is a shim that draws nothing, so there is no Undo button
 * to press. The send hands its pill to `toast.custom`. This keeps the newest
 * one, and `pressUndo` calls what the button calls.
 */
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

const ACCOUNT = "ulla@aavang.example";
const SUBJECT = "Plant sale on the square";
const PLANTS = {
  account: ACCOUNT,
  threadId: "plants-1",
  subject: SUBJECT,
  fromName: "Asta Holm",
  fromEmail: "asta@haveklub.example",
  snippet: "We have forty tomato plants and no table.",
  lastAt: "2026-08-21T07:45:00.000Z",
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Asta Holm", email: "asta@haveklub.example" }],
};
const PLANTS_MESSAGES = [
  {
    id: "p1",
    fromName: "Asta Holm",
    fromEmail: "asta@haveklub.example",
    toEmails: [ACCOUNT],
    ccEmails: [],
    sentAt: "2026-08-21T07:45:00.000Z",
    bodyText: "We have forty tomato plants and no table. Can you bring one?",
    own: false,
    rfcMessageId: "<plants-p1@haveklub.example>",
  },
];

/** A second conversation, so that the walk can leave the first one. */
const BENCH_SUBJECT = "The bench by the harbor";
const BENCH = {
  account: ACCOUNT,
  threadId: "bench-1",
  subject: BENCH_SUBJECT,
  fromName: "Viggo Dam",
  fromEmail: "viggo@torvet.example",
  snippet: "The bench needs paint before the autumn.",
  lastAt: "2026-08-20T09:10:00.000Z",
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Viggo Dam", email: "viggo@torvet.example" }],
};
const BENCH_MESSAGES = [
  {
    id: "b1",
    fromName: "Viggo Dam",
    fromEmail: "viggo@torvet.example",
    toEmails: [ACCOUNT],
    ccEmails: [],
    sentAt: "2026-08-20T09:10:00.000Z",
    bodyText: "The bench needs paint before the autumn. Who has a brush?",
    own: false,
    rfcMessageId: "<bench-b1@torvet.example>",
  },
];

/**
 * The drafts database, kept in a Map.
 *
 * Node has no IndexedDB, and without one a draft is never stored, so a
 * return to the thread has nothing to restore. Only the drafts database
 * opens. Every other name fails to open, as all of them did before, so the
 * thread cache behaves as it does in the other mounted suites.
 */
const draftRows = new Map();
/**
 * Reads that the store has not answered yet. Null means that it answers at
 * once. `holdReads` makes the store slow, and `releaseReads` lets it answer.
 */
let heldReads = null;
const holdReads = () => {
  heldReads = [];
};
const releaseReads = () => {
  const held = heldReads ?? [];
  heldReads = null;
  for (const answer of held) answer();
};
{
  const request = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.({ target: req }));
    return req;
  };
  const store = {
    get: (key) => {
      if (!heldReads) return request(draftRows.get(key) ?? undefined);
      // What the row holds now, answered later.
      const req = {
        result: draftRows.get(key) ?? undefined,
        onsuccess: null,
        onerror: null,
      };
      heldReads.push(() => req.onsuccess?.({ target: req }));
      return req;
    },
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
const unknownPaths = new Set();
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
    return json({ ok: true, id: "sent-1", threadId: "sent-thread-1" });
  }
  if (p === "/api/mail/threads")
    return json({ threads: [PLANTS, BENCH], nextCursor: null });
  if (p === "/api/mail/thread" && url.searchParams.get("id") === "bench-1")
    return json({
      thread: {
        account: ACCOUNT,
        threadId: "bench-1",
        subject: BENCH_SUBJECT,
        participants: ["You", "Viggo Dam"],
        messages: BENCH_MESSAGES,
        totalMessageCount: BENCH_MESSAGES.length,
        hasOlder: false,
        hasNewer: false,
        reply: {
          inReplyTo: "<bench-b1@torvet.example>",
          references: "<bench-b1@torvet.example>",
          to: ["viggo@torvet.example"],
          cc: [],
          allTo: ["viggo@torvet.example"],
          allCc: [],
        },
      },
    });
  if (p === "/api/mail/thread")
    return json({
      thread: {
        account: ACCOUNT,
        threadId: "plants-1",
        subject: SUBJECT,
        participants: ["You", "Asta Holm"],
        messages: PLANTS_MESSAGES,
        totalMessageCount: PLANTS_MESSAGES.length,
        hasOlder: false,
        hasNewer: false,
        reply: {
          inReplyTo: "<plants-p1@haveklub.example>",
          references: "<plants-p1@haveklub.example>",
          to: ["asta@haveklub.example"],
          cc: [],
          allTo: ["asta@haveklub.example"],
          allCc: [],
        },
      },
    });
  if (p === "/api/mail/snoozed")
    return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
  // The recipient box reads these two when it opens.
  if (p === "/api/mail/contacts") return json({ contacts: [], sources: [] });
  if (p === "/api/mail/contact-lists") return json({ lists: [] });
  unknownPaths.add(p);
  return json({});
});

const clickEl = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
};
const buttons = () => [...document.querySelectorAll("button")];
const byTitle = (re) =>
  buttons().find((b) =>
    re.test((b.getAttribute("title") || "") + (b.getAttribute("aria-label") || ""))
  );
const inputs = () => [...document.querySelectorAll("input")];

/**
 * Put text in a box the way a keyboard does.
 *
 * React reads the value through its own setter. A plain assignment does not
 * reach it, so the prototype's setter writes the value first.
 */
const typeInto = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(el, value);
  // Node has an `Event` of its own, which the DOM here refuses.
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};

/** Put words in the reply editor. It is a Quill box, not an input. */
const writeReply = (html) => {
  const editor = document.querySelector(".ql-editor");
  assert(editor, "the reply editor is up");
  editor.innerHTML = html;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
};

/** Attach a file through the composer's own file input. */
const attachFile = (name, words) => {
  const input = document.querySelector('.mail-composer-card input[type="file"]') ??
    document.querySelector('input[type="file"]');
  assert(input, "the composer has a file input");
  const file = new window.File([words], name, { type: "text/plain" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
};

/** Open the conversation whose row shows this subject. */
const openThread = async (subject, words) => {
  // The list row, not the open thread's heading: the row comes first.
  const leaf = [...document.querySelectorAll("*")].find(
    (e) => e.childElementCount === 0 && (e.textContent || "").trim() === subject
  );
  assert(leaf, `the list shows "${subject}"`);
  clickEl(leaf);
  await sleep(900);
  assert((document.body.textContent || "").includes(words), `"${subject}" is open`);
};

/** The words in the reply editor, or null when no composer is open. */
const editorWords = () => {
  const editor = document.querySelector(".ql-editor");
  return editor ? (editor.textContent || "").trim() : null;
};

async function main() {
  let root;
  try {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "composer-send-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await sleep(700);

    const rowLeaf = [...document.querySelectorAll("*")].filter(
      (e) => e.childElementCount === 0 && (e.textContent || "").includes(SUBJECT)
    );
    clickEl(rowLeaf[rowLeaf.length - 1]);
    await sleep(700);
    assert(
      (document.body.textContent || "").includes("Can you bring one?"),
      "the thread is open"
    );

    // A forward. The recipient goes in first and the subject goes in last,
    // so the subject is the only change after the last render of the send.
    clickEl(byTitle(/^forward/i));
    await sleep(300);
    const subjectBox = inputs().find(
      (i) => i.getAttribute("placeholder") === `Fwd: ${SUBJECT}`
    );
    assert(subjectBox, "a forward shows its subject row");
    assert.equal(subjectBox.value, `Fwd: ${SUBJECT}`);
    assert(
      /Forwarding (your message|.+'s message)/.test(document.body.textContent || ""),
      "and says which message goes with it"
    );

    const recipientBox = inputs().find((i) =>
      /name@example\.com/.test(i.getAttribute("placeholder") || "")
    );
    assert(recipientBox, "a forward shows its recipient box");
    typeInto(recipientBox, "viggo@torvet.example,");
    await sleep(300);

    typeInto(subjectBox, "Forty tomato plants need a table");
    await sleep(300);

    const forwardSendButton = () =>
      buttons().find(
        (b) => /^forward \(/i.test(b.getAttribute("title") || "") && !b.disabled &&
          /forward/i.test(b.textContent || "")
      );
    assert(forwardSendButton(), "the forward can be sent");
    clickEl(forwardSendButton());
    await sleep(500);

    /*
      A forward waits out the same count as a reply. It went straight out
      once, and the recipient of a forward is typed fresh each time, so it is
      the message most likely to go to the wrong person. Undo must put the
      forward back as it was: a forward, to the same person, under the
      subject that was typed.
    */
    assert.equal(sends.length, 0, "a forward waits out its count");
    // Not by the Send button: with the composer shut, the thread's own
    // Forward button has the same title.
    assert(
      inputs().every((i) => i.getAttribute("placeholder") !== `Fwd: ${SUBJECT}`),
      "and Send closes the composer"
    );

    pressUndo();
    await sleep(1500);
    const undoneSubject = inputs().find(
      (i) => i.getAttribute("placeholder") === `Fwd: ${SUBJECT}`
    );
    assert(undoneSubject, "Undo opens the composer as a forward again");
    assert.equal(
      undoneSubject.value,
      "Forty tomato plants need a table",
      "with the subject that was typed"
    );
    assert(
      (document.body.textContent || "").includes("viggo@torvet.example"),
      "and the recipient"
    );
    assert.equal(sends.length, 0, "and nothing was sent");
    pass("Undo after Send puts a forward back");

    assert(forwardSendButton(), "the forward can be sent again");
    clickEl(forwardSendButton());
    await sleep(300);
    assert.equal(sends.length, 0, "the second Send waits too");
    // A page that goes away sends it at once.
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(500);

    assert.equal(sends.length, 1, "one message went to the send route");
    assert.deepEqual(sends[0].to, ["viggo@torvet.example"]);
    assert.equal(sends[0].subject, "Forty tomato plants need a table");
    assert(sends[0].forward, "and it carries the forwarded message");
    pass("a forward goes out with the subject that was typed last");

    // A reply. The words go in first and the pick of one message goes in
    // last, so the pick is the only change after the last render of the send.
    // The picked message is the newest one. The quote is then the same
    // object with or without a pick, and only the pick tells the two apart.
    clickEl(byTitle(/^reply \(/i));
    await sleep(1500);
    writeReply("<p>I can bring the long table.</p>");
    await sleep(300);
    clickEl(byTitle(/^reply to this message/i));
    await sleep(300);
    assert(
      /Replying to /.test(document.body.textContent || ""),
      "the reply says which message it answers"
    );
    assert(byTitle(/^answer the thread instead/i), "with the way back to the whole thread");
    const replyButton = buttons().find(
      (b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled
    );
    assert(replyButton, "the reply can be sent");
    clickEl(replyButton);
    await sleep(300);
    // A reply waits out its Undo. A page that goes away sends it at once.
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(500);

    assert.equal(sends.length, 2, "the reply went to the send route");
    assert.equal(sends[1].noQuote, true, "a picked message takes the place of the history");
    assert(
      String(sends[1].html).includes("Can you bring one?"),
      "the picked message is in the body"
    );
    pass("a reply carries the message that was picked last");

    /*
      Undo of a forward, while the thread refreshes under it. A send is
      followed by three looks at the thread, and each new answer clears the
      outbox of every row that has no bubble. A held forward has no bubble.
      So a forward that is sent in the seconds after a reply, and taken back,
      must still come back: Undo carries the message itself and does not look
      for it in the outbox.
    */
    clickEl(byTitle(/^forward/i));
    await sleep(300);
    const hazardRecipient = inputs().find((i) =>
      /name@example\.com/.test(i.getAttribute("placeholder") || "")
    );
    assert(hazardRecipient, "a second forward shows its recipient box");
    typeInto(hazardRecipient, "ragna@haveklub.example,");
    await sleep(300);
    clickEl(forwardSendButton());
    // Long enough for the second look at the thread, short of the count.
    await sleep(2200);
    assert.equal(sends.length, 2, "the forward is still held");
    pressUndo();
    await sleep(1500);
    assert(
      inputs().some((i) => i.getAttribute("placeholder") === `Fwd: ${SUBJECT}`),
      "Undo brings the forward back after the thread refreshed"
    );
    assert(
      (document.body.textContent || "").includes("ragna@haveklub.example"),
      "with its recipient"
    );
    // Put it away again, so that the next walk starts from a shut composer.
    clickEl(byTitle(/^discard/i));
    await sleep(300);
    {
      const sure = buttons().find((b) => /^discard$/i.test((b.textContent || "").trim()));
      if (sure) {
        clickEl(sure);
        await sleep(300);
      }
    }
    pass("Undo brings a forward back while the thread refreshes");

    /*
      Undo after Send. The composer closes at the press of Send and the
      message waits out its count. Undo must put the composer back as it
      was: the words, the recipients and the subject. The files are not
      checked here. Then the message is sent for real, and the request must
      carry the same three things.
    */
    clickEl(byTitle(/^reply \(/i));
    await sleep(1500);
    writeReply("<p>The long table is in the shed.</p>");
    await sleep(300);
    clickEl(byTitle(/^add cc$/i));
    await sleep(300);
    const undoCc = inputs().find(
      (i) => i.getAttribute("placeholder") === "Add a recipient…"
    );
    assert(undoCc, "the reply shows a Cc box");
    typeInto(undoCc, "viggo@torvet.example,");
    await sleep(300);
    const firstSend = buttons().find(
      (b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled
    );
    assert(firstSend, "the reply can be sent");
    clickEl(firstSend);
    await sleep(300);
    assert.equal(editorWords(), null, "Send closes the composer");
    assert.equal(sends.length, 2, "and the message waits out its count");

    pressUndo();
    await sleep(1500);
    assert.equal(
      editorWords(),
      "The long table is in the shed.",
      "Undo puts the words back in the box"
    );
    assert(
      inputs().every((i) => i.getAttribute("placeholder") !== `Re: ${SUBJECT}`),
      "the subject row stays shut, because nobody changed the subject"
    );
    assert.equal(sends.length, 2, "and nothing was sent");

    const secondSend = buttons().find(
      (b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled
    );
    assert(secondSend, "the reply can be sent again");
    clickEl(secondSend);
    await sleep(300);
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(500);
    assert.equal(sends.length, 3, "the second Send goes out");
    assert.deepEqual(sends[2].to, ["asta@haveklub.example"], "to the same person");
    assert.deepEqual(sends[2].cc, ["viggo@torvet.example"], "with the same Cc");
    assert.equal(sends[2].subject, `Re: ${SUBJECT}`, "under the thread's subject");
    assert(
      String(sends[2].html).includes("The long table is in the shed."),
      "with the same words"
    );
    pass("Undo after Send puts back the words, the recipients and the subject");

    /*
      Undo after Send, with a file on the message. Send empties the strip
      with the composer, so Undo must put the file back. Without it, the
      second Send goes out with the words "see the list" and no list.
    */
    clickEl(byTitle(/^reply \(/i));
    await sleep(1500);
    writeReply("<p>The list of colours is on this message.</p>");
    await sleep(300);
    attachFile("colours.txt", "green, and a little white");
    await sleep(600);
    assert(
      (document.body.textContent || "").includes("colours.txt"),
      "the strip shows the file"
    );
    const sendWithFile = buttons().find(
      (b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled
    );
    assert(sendWithFile, "the reply with a file can be sent");
    clickEl(sendWithFile);
    await sleep(300);
    assert.equal(editorWords(), null, "Send closes the composer");
    assert(
      !(document.querySelector(".mail-composer-card")?.textContent || "").includes(
        "colours.txt"
      ),
      "and empties the strip"
    );

    pressUndo();
    await sleep(1500);
    assert.equal(
      editorWords(),
      "The list of colours is on this message.",
      "Undo puts the words back"
    );
    assert(
      (document.querySelector(".mail-composer-card")?.textContent || "").includes(
        "colours.txt"
      ),
      "and the file is back in the strip"
    );
    assert.equal(sends.length, 3, "and nothing was sent");

    const sendFileAgain = buttons().find(
      (b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled
    );
    assert(sendFileAgain, "the reply can be sent again");
    clickEl(sendFileAgain);
    await sleep(300);
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(500);
    assert.equal(sends.length, 4, "the second Send goes out");
    assert.deepEqual(
      (sends[3].attachments ?? []).map((f) => f.filename),
      ["colours.txt"],
      "with the file on it"
    );
    pass("Undo after Send puts the attached file back");

    /*
      A draft outlives the pane. The pane is made again for each thread, so
      a reader who opens other mail and comes back gets a new composer, and
      everything in it comes from the stored draft. These two walks hold the
      words, the recipients and the subject across that trip.
    */
    // A reply: words, and a Cc that the thread does not have.
    clickEl(byTitle(/^reply \(/i));
    await sleep(1500);
    writeReply("<p>I have two brushes and a tin of green.</p>");
    await sleep(300);
    clickEl(byTitle(/^add cc$/i));
    await sleep(300);
    // The To box holds somebody, so it says "Add…". The Cc box is empty.
    const ccBox = inputs().find(
      (i) => i.getAttribute("placeholder") === "Add a recipient…"
    );
    assert(ccBox, "the reply shows a Cc box");
    typeInto(ccBox, "ragna@haveklub.example,");
    // Longer than the 400 ms that a draft waits before it is stored.
    await sleep(700);

    await openThread(BENCH_SUBJECT, "Who has a brush?");
    assert(
      !(document.body.textContent || "").includes("two brushes"),
      "the other conversation does not show the reply"
    );
    await openThread(SUBJECT, "Can you bring one?");
    await sleep(600);

    assert.equal(
      editorWords(),
      "I have two brushes and a tin of green.",
      "the words are back in the box"
    );
    assert(
      (document.body.textContent || "").includes("ragna@haveklub.example"),
      "the Cc is back"
    );
    assert(
      buttons().some((b) => /^send \(/i.test(b.getAttribute("title") || "")),
      "the composer is a reply again"
    );
    const replyDraft = draftRows.get(`thread:${ACCOUNT}:plants-1`) ??
      [...draftRows.values()].find((d) => d.kind === "thread");
    assert(replyDraft, "the draft is in the store");
    assert.deepEqual(
      replyDraft.toList.map((r) => r.email ?? r.value ?? r),
      ["asta@haveklub.example"],
      "the stored draft still goes to the person the thread answers"
    );
    pass("a reply is restored with its words and its recipients");

    // The bin, so that the forward starts from an empty composer.
    const bin = byTitle(/^discard/i);
    assert(bin, "the composer has a bin");
    clickEl(bin);
    await sleep(300);
    // A reply with words in it asks first.
    const confirmDiscard = buttons().find((b) => /^discard$/i.test((b.textContent || "").trim()));
    if (confirmDiscard) {
      clickEl(confirmDiscard);
      await sleep(300);
    }
    assert.equal(editorWords(), null, "the composer is closed");

    // A forward: words, a recipient, and a subject that is not the thread's.
    clickEl(byTitle(/^forward/i));
    await sleep(300);
    const draftSubject = inputs().find(
      (i) => i.getAttribute("placeholder") === `Fwd: ${SUBJECT}`
    );
    const draftRecipient = inputs().find((i) =>
      /name@example\.com/.test(i.getAttribute("placeholder") || "")
    );
    assert(draftSubject && draftRecipient, "the forward shows its rows");
    typeInto(draftRecipient, "ragna@haveklub.example,");
    await sleep(300);
    typeInto(draftSubject, "Tomato plants: who has a table?");
    await sleep(300);
    writeReply("<p>Ragna, do you still have the folding one?</p>");
    await sleep(700);

    await openThread(BENCH_SUBJECT, "Who has a brush?");
    await openThread(SUBJECT, "Can you bring one?");
    await sleep(600);

    assert.equal(
      editorWords(),
      "Ragna, do you still have the folding one?",
      "the forward's words are back in the box"
    );
    const restoredSubject = inputs().find(
      (i) => i.getAttribute("placeholder") === `Fwd: ${SUBJECT}`
    );
    assert(restoredSubject, "the composer is a forward again");
    assert.equal(
      restoredSubject.value,
      "Tomato plants: who has a table?",
      "the subject is back"
    );
    assert(
      (document.body.textContent || "").includes("ragna@haveklub.example"),
      "the recipient is back"
    );
    assert.equal(sends.length, 4, "and nothing more was sent on the way");
    pass("a forward is restored with its words, its subject and its recipient");

    /*
      A draft that comes back from the pop-out. That window stores what was
      written as this thread's draft and closes, and the pane takes the draft
      up when its own window gets the focus. The walk plays the pop-out: it
      puts a draft with a file in the store and sends the focus event. The
      file must be in the strip, and it must still be in the stored draft
      after the next save.
    */
    const forwardBin = byTitle(/^discard/i);
    assert(forwardBin, "the forward has a bin");
    clickEl(forwardBin);
    await sleep(300);
    const confirmForwardDiscard = buttons().find((b) =>
      /^discard$/i.test((b.textContent || "").trim())
    );
    if (confirmForwardDiscard) {
      clickEl(confirmForwardDiscard);
      await sleep(300);
    }
    assert.equal(editorWords(), null, "the composer is closed and empty");

    const popoutKey = threadDraftKey(ACCOUNT, "plants-1");
    draftRows.set(popoutKey, {
      key: popoutKey,
      kind: "thread",
      account: ACCOUNT,
      threadId: "plants-1",
      mode: "reply",
      body: "<p>The seed list is on this message.</p>",
      toList: recipientsFromEmails(["asta@haveklub.example"]),
      ccList: [],
      showCc: false,
      editRecipients: false,
      includeSignature: false,
      fromAccount: ACCOUNT,
      replyFocus: false,
      quoteMessageId: null,
      attachments: [
        {
          id: "att-popout-1",
          filename: "seeds.txt",
          mimeType: "text/plain",
          size: 21,
          progress: null,
          contentBase64: Buffer.from("beans, peas, marigold").toString("base64"),
        },
      ],
      updatedAt: Date.now(),
    });
    window.dispatchEvent(new window.Event("focus"));
    await sleep(1500);

    assert.equal(
      editorWords(),
      "The seed list is on this message.",
      "the pane takes up the words from the pop-out"
    );
    assert(
      (document.querySelector(".mail-composer-card")?.textContent || "").includes(
        "seeds.txt"
      ),
      "and the file is in the strip"
    );
    // Longer than the 400 ms that a draft waits before it is stored.
    await sleep(700);
    assert.deepEqual(
      (draftRows.get(popoutKey)?.attachments ?? []).map((f) => f.filename),
      ["seeds.txt"],
      "and the next save keeps the file in the stored draft"
    );
    pass("a draft from the pop-out comes back with its file");

    /*
      A slow store. The reader opens the thread and presses Reply twice,
      which opens and closes the composer, before the store has answered the
      read of the draft. The answer then puts the stored draft in the
      composer. That draft must be saved from there on, as every other one
      is: the close was about the empty composer, not about this draft.
    */
    await openThread(BENCH_SUBJECT, "Who has a brush?");
    holdReads();
    await openThread(SUBJECT, "Can you bring one?");
    assert.equal(editorWords(), null, "the store has not answered, so no composer");
    clickEl(byTitle(/^reply \(/i));
    await sleep(600);
    clickEl(byTitle(/^reply \(/i));
    await sleep(300);
    assert.equal(editorWords(), null, "the second press of Reply closes the composer");
    releaseReads();
    await sleep(1500);
    assert.equal(
      editorWords(),
      "The seed list is on this message.",
      "the store answers, and the stored draft opens the composer"
    );

    writeReply("<p>Beans first, then the peas.</p>");
    // Longer than the 400 ms that a draft waits before it is stored.
    await sleep(700);
    await openThread(BENCH_SUBJECT, "Who has a brush?");
    await openThread(SUBJECT, "Can you bring one?");
    await sleep(600);
    assert.equal(
      editorWords(),
      "Beans first, then the peas.",
      "the words that were typed after that are in the stored draft"
    );
    pass("a draft that a slow store reopens is saved again");

    /*
      The Reply button at the foot of the thread, and the question a
      message that speaks of a file and carries none is asked before it
      goes. Go back sends nothing; Send anyway sends it.
    */
    await openThread(BENCH_SUBJECT, "Who has a brush?");
    await sleep(600);
    if (editorWords() !== null) {
      clickEl(byTitle(/^discard/i));
      await sleep(300);
    }
    const replyButtons = buttons().filter((b) => /^reply \(/i.test(b.getAttribute("title") || ""));
    assert(replyButtons.length >= 2, "Reply stands in the toolbar and at the foot");
    clickEl(replyButtons[replyButtons.length - 1]);
    await sleep(1500);
    writeReply("<p>I have attached the paint list.</p>");
    await sleep(300);
    const sendNow = () =>
      buttons().find((b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled);
    const before = sends.length;
    clickEl(sendNow());
    await sleep(400);
    const text = () => document.body.textContent || "";
    assert(text().includes("Did you mean to attach a file?"), "the question is asked");
    clickEl(buttons().find((b) => (b.textContent || "").trim() === "Go back"));
    await sleep(300);
    assert(!text().includes("Did you mean to attach a file?"), "Go back puts it away");
    assert.equal(editorWords(), "I have attached the paint list.", "and the words are still there");
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(300);
    assert.equal(sends.length, before, "nothing was sent");
    pass("the Reply button at the foot of the thread opens a reply");
    pass("a message that speaks of a file and has none asks first, and Go back sends nothing");

    clickEl(sendNow());
    await sleep(400);
    clickEl(buttons().find((b) => (b.textContent || "").trim() === "Send anyway"));
    await sleep(300);
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(500);
    assert.equal(sends.length, before + 1, "Send anyway sends it");
    assert(String(sends[sends.length - 1].html).includes("paint list"));
    pass("and Send anyway sends it");

    /*
      Escape on a reply with words in it asks before it throws them away.
      Keep draft keeps them. A second question, answered with Enter,
      discards.
    */
    clickEl(byTitle(/^reply \(/i));
    await sleep(1500);
    writeReply("<p>A second thought about the bench.</p>");
    await sleep(300);
    const escape = () =>
      document.body.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
      );
    escape();
    await sleep(300);
    assert(text().includes("Discard draft?"), "Escape asks");
    clickEl(buttons().find((b) => (b.textContent || "").trim() === "Keep draft"));
    await sleep(300);
    assert.equal(editorWords(), "A second thought about the bench.", "Keep draft keeps the words");
    escape();
    await sleep(300);
    assert(text().includes("Discard draft?"), "Escape asks again");
    document.body.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
    await sleep(500);
    assert.equal(editorWords(), null, "Enter discards the reply");
    pass("Escape asks before a written reply is thrown away; Keep draft keeps it, Enter discards");

    /* Command+Enter sends, from inside the reply being written. */
    clickEl(byTitle(/^reply \(/i));
    await sleep(1500);
    writeReply("<p>Sent with the keys.</p>");
    await sleep(300);
    const box = document.querySelector(".ql-editor");
    box.focus();
    const beforeKeys = sends.length;
    const bubbles = () => document.querySelectorAll("[data-message-id]").length;
    const bubblesBefore = bubbles();
    box.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true, cancelable: true })
    );
    await sleep(400);
    assert.equal(bubbles(), bubblesBefore + 1, "a reply stands in its thread while it waits");
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(500);
    assert.equal(sends.length, beforeKeys + 1, "Command+Enter sent the reply");
    assert(String(sends[sends.length - 1].html).includes("Sent with the keys."));
    assert.equal(sends[sends.length - 1].threadId, "bench-1", "a plain reply joins its thread");
    pass("Command+Enter sends the reply the caret is in");

    /* Edit subject, in the row under the box, opens the subject. */
    clickEl(byTitle(/^reply \(/i));
    await sleep(1500);
    const subjectFields = () =>
      [...document.querySelectorAll("input, textarea")].filter(
        (f) => f.getAttribute("placeholder") === `Re: ${BENCH_SUBJECT}`
      );
    assert.equal(subjectFields().length, 0, "no subject field at first");
    const editSubject = buttons().find((b) => (b.textContent || "").trim() === "Edit subject");
    assert(editSubject, "the row under the box offers Edit subject");
    clickEl(editSubject);
    await sleep(300);
    assert.equal(subjectFields().length, 1, "Edit subject opens it");
    pass("Edit subject, under the box, opens the subject of a reply");

    /* Preview first, from the Send options, and back. */
    writeReply("<p>Paint first, then the bench.</p>");
    await sleep(300);
    clickEl(buttons().find((b) => b.getAttribute("aria-label") === "Send options"));
    await sleep(300);
    const previewItem = [...document.querySelectorAll("[role=menuitem], button")].find(
      (b) => (b.textContent || "").trim() === "Preview first"
    );
    assert(previewItem, "the Send options offer a preview");
    clickEl(previewItem);
    await sleep(500);
    const back = () => buttons().find((b) => (b.textContent || "").includes("Back to editing"));
    assert(back(), "the preview is up");
    assert(text().includes("Paint first, then the bench."), "with the words as they will go");
    clickEl(back());
    await sleep(400);
    assert(!back(), "Back to editing puts the preview away");
    assert.equal(editorWords(), "Paint first, then the bench.", "and the words are kept");
    pass("Preview first shows the message as it will go, and Back to editing keeps the words");

    /*
      A reply under a new subject is a new conversation: Gmail and Outlook
      both start one. It goes without the thread's id and still says what
      it answers. (Edit subject floats it into the card, which draws no
      bubbles, so the rule against a bubble in the old thread cannot be
      seen here; changed-subject reads it.)
    */
    typeInto(subjectFields()[0], "Paint for the bench");
    await sleep(300);
    const beforeRename = sends.length;
    clickEl(sendNow());
    await sleep(500);
    window.dispatchEvent(new window.Event("pagehide"));
    await sleep(500);
    assert.equal(sends.length, beforeRename + 1, "the renamed reply went");
    const renamed = sends[sends.length - 1];
    assert.equal(renamed.subject, "Paint for the bench");
    assert.equal(renamed.threadId, undefined, "without the thread's id");
    assert.equal(renamed.inReplyTo, "<bench-b1@torvet.example>", "still answering the message");
    assert(String(renamed.references).includes("<bench-b1@torvet.example>"), "and its references");
    pass("a reply under a new subject starts a new conversation that still says what it answers");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the composer walk failed:", err);
    if (unknownPaths.size) {
      console.error(
        "paths the fixture transport did not know:",
        [...unknownPaths]
      );
    }
    process.exit(1);
  }
}

void main();
