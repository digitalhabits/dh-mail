/**
 * The walks — see mounted-reply-window-send.test.mjs.
 *
 * Every fixture is invented. No line of them was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { ReplyReaderWindow } from "@/components/mail/ReplyReaderWindow";
import { recipientsFromEmails } from "@/lib/mail/contact-list-types";
import { threadDraftKey } from "@/lib/mail/local-drafts";
import { claimHandover } from "@/lib/mail/send-handover";
import { idbHandoverRows } from "@/lib/mail/send-handover-store";

import { waitFor } from "./mounted-dom.mjs";
import { installStores } from "./mounted-handover-stores.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const SUBJECT = "Plant sale on the square";
const THREAD = {
  account: ACCOUNT,
  threadId: "plants-1",
  subject: SUBJECT,
  participants: ["You", "Asta Holm"],
  messages: [
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
  ],
  totalMessageCount: 1,
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
};

const { draftRows, handoverRows } = installStores();
const KEY = threadDraftKey(ACCOUNT, "plants-1");

/** The reply as the main window stored it when it popped the reply out. */
const storeDraft = (words) =>
  draftRows.set(KEY, {
    key: KEY,
    kind: "thread",
    account: ACCOUNT,
    threadId: "plants-1",
    mode: "reply",
    body: `<p>${words}</p>`,
    toList: recipientsFromEmails(["asta@haveklub.example"]),
    ccList: recipientsFromEmails(["viggo@torvet.example"]),
    showCc: true,
    editRecipients: true,
    includeSignature: false,
    fromAccount: ACCOUNT,
    replyFocus: false,
    quoteMessageId: null,
    attachments: [
      {
        id: "att-1",
        filename: "seeds.txt",
        mimeType: "text/plain",
        size: 21,
        progress: null,
        contentBase64: Buffer.from("beans, peas, marigold").toString("base64"),
      },
    ],
    updatedAt: Date.now(),
  });

/**
 * The shell. `onHandover` is what the command to tell the main window does
 * in this walk: it plays the main window, or an older shell, or silence.
 */
const invoked = [];
let onHandover = async () => {};
window.__TAURI__ = {
  core: {
    invoke: async (command, args) => {
      invoked.push(command);
      if (command === "notify_mail_send_handover") return onHandover(args.id);
      if (command === "chat_popout_open") return false;
      return null;
    },
  },
  event: { listen: async () => () => {} },
};
const closes = () => invoked.filter((c) => c === "close_mail_reader_window").length;

/** The body of each call to the send route, oldest first. */
const sends = [];
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (p === "/api/mail/send") {
    sends.push(JSON.parse(String(init?.body ?? "{}")));
    return json({ ok: true, id: "sent-1", threadId: "plants-1" });
  }
  if (p === "/api/mail/thread") return json({ thread: THREAD });
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
const pageText = () => document.body.textContent || "";
const editorWords = () => {
  const editor = document.querySelector(".ql-editor");
  return editor ? (editor.textContent || "").trim() : null;
};
const SENDING = "Sending. This window closes when the message has gone.";

/** Open the reply window on a stored reply, and press Send. */
async function openAndSend(words) {
  storeDraft(words);
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  root.render(
    React.createElement(ReplyReaderWindow, {
      account: ACCOUNT,
      threadId: "plants-1",
      accounts: [ACCOUNT],
      subject: SUBJECT,
    })
  );
  await waitFor(() => editorWords() === words);
  assert.equal(editorWords(), words, "the reply window opens on the stored reply");
  // The file is read into the strip before Send can take it.
  await waitFor(() => (document.body.textContent || "").includes("seeds.txt"));
  await sleep(600);
  const send = [...document.querySelectorAll("button")].find(
    (b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled
  );
  assert(send, "the reply can be sent");
  clickEl(send);
  return root;
}
/** The count ends: the page is told that it closes, which sends at once. */
const endCounts = async () => {
  window.dispatchEvent(new window.Event("pagehide"));
  await sleep(500);
};

async function main() {
  try {
    // The main window takes the message.
    const TABLE = "The long table is in the shed.";
    let taken = null;
    let offeredDraft = null;
    onHandover = async (id) => {
      // What the store holds at the moment of the offer.
      offeredDraft = structuredClone(draftRows.get(KEY));
      setTimeout(() => {
        void claimHandover(idbHandoverRows(), id).then((message) => {
          taken = message;
        });
      }, 40);
    };
    let root = await openAndSend(TABLE);
    await waitFor(() => closes() === 1);
    assert.equal(closes(), 1, "the window closes when the main window took the message");
    assert(taken, "the main window got the message");
    assert(pageText().includes(SENDING), "the window says that it sends, for the moment that it is still there");
    assert.equal(editorWords(), null, "and its box is empty");
    await endCounts();
    await sleep(3500);
    await endCounts();
    assert.equal(sends.length, 0, "the reply window sends nothing: the message is the main window's");
    assert.equal(closes(), 1, "and it closes one time");
    // The message that crossed is whole.
    assert.equal(taken.account, ACCOUNT);
    assert.equal(taken.threadId, "plants-1");
    assert.equal(taken.entry.mode, "reply");
    assert.equal(taken.entry.fromAccount, ACCOUNT);
    assert.deepEqual(taken.entry.request.to, ["asta@haveklub.example"], "To");
    assert.deepEqual(taken.entry.request.cc, ["viggo@torvet.example"], "Cc");
    assert.equal(taken.entry.request.subject, `Re: ${SUBJECT}`, "the subject");
    assert.equal(taken.entry.request.threadId, "plants-1", "the conversation");
    assert.equal(taken.entry.request.inReplyTo, "<plants-p1@haveklub.example>", "what it answers");
    assert(String(taken.entry.request.html).includes(TABLE), "the words");
    assert(taken.entry.request.appendix?.html, "the quoted history");
    assert.deepEqual(taken.entry.request.attachments.map((a) => a.filename), ["seeds.txt"], "the file to send");
    assert.equal(
      Buffer.from(taken.entry.request.attachments[0].contentBase64, "base64").toString(),
      "beans, peas, marigold",
      "with its bytes"
    );
    assert.deepEqual(taken.entry.attachments.map((a) => a.filename), ["seeds.txt"], "the file for Undo");
    assert(String(taken.entry.reply).includes(TABLE), "the words for Undo");
    assert.equal(taken.entry.toList.length, 1, "the recipients for Undo");
    assert.equal(taken.entry.ccList.length, 1);
    assert.equal(taken.bubble?.id, taken.localId, "the bubble for the conversation");
    assert.equal(taken.later, null);
    // If the window went away before the claim, the words were not lost.
    assert(String(offeredDraft?.body).includes(TABLE), "the words are the thread's stored draft while the offer waits");
    assert.deepEqual(offeredDraft.attachments.map((a) => a.filename), ["seeds.txt"]);
    assert.equal([...handoverRows.values()].filter((r) => r.state === "claimed").length, 1);
    root.unmount();
    pass("Send in the reply window hands the whole message to the main window, closes at once, and sends nothing");

    // An older shell: the command is not known.
    const CHAIRS = "We can bring six chairs.";
    onHandover = async () => {
      throw new Error("Command notify_mail_send_handover not found");
    };
    root = await openAndSend(CHAIRS);
    await sleep(600);
    assert.equal(closes(), 1, "the window stays open while it sends the message itself");
    assert.equal(sends.length, 0, "the message waits out its count");
    assert(pageText().includes(SENDING), "the window says that it sends");
    await endCounts();
    assert.equal(sends.length, 1, "the reply window sends the message when the shell does not know the handover");
    assert(String(sends[0].html).includes(CHAIRS));
    assert.deepEqual(sends[0].cc, ["viggo@torvet.example"]);
    assert.deepEqual(sends[0].attachments.map((a) => a.filename), ["seeds.txt"]);
    await waitFor(() => closes() === 2);
    assert.equal(closes(), 2, "and closes after the send, as before");
    assert.equal(draftRows.get(KEY), undefined, "the stored draft is gone with the send");
    assert.equal([...handoverRows.values()].filter((r) => r.state === "offered").length, 0, "no offer is left open");
    root.unmount();
    pass("with an older shell, the reply window sends the message itself, one time");

    // The main window does not answer.
    const BRUSH = "I have two brushes and a tin of green.";
    let offeredId = null;
    onHandover = async (id) => {
      offeredId = id;
    };
    root = await openAndSend(BRUSH);
    await sleep(1500);
    assert(offeredId, "the main window was told");
    assert.equal(sends.length, 1, "nothing goes while the offer waits");
    await endCounts();
    assert.equal(sends.length, 1, "and a window that closes in the wait sends nothing: the words are the stored draft");
    assert(String(draftRows.get(KEY)?.body).includes(BRUSH));
    await waitFor(() => handoverRows.get(offeredId)?.state === "withdrawn", { timeout: 4000 });
    assert.equal(handoverRows.get(offeredId)?.state, "withdrawn", "after three seconds the offer is withdrawn");
    await sleep(300);
    const late = await claimHandover(idbHandoverRows(), offeredId);
    assert.equal(late, null, "a late claim by the main window gets nothing");
    assert.equal(closes(), 2, "the window is still open");
    await endCounts();
    assert.equal(sends.length, 2, "and the reply window sends the message itself, one time");
    assert(String(sends[1].html).includes(BRUSH));
    await waitFor(() => closes() === 3);
    assert.equal(closes(), 3, "then it closes");
    root.unmount();
    pass("with no answer from the main window, the offer is withdrawn and the reply window sends, one time");

    process.exit(0);
  } catch (err) {
    console.error("the reply window walk failed:", err);
    console.error("shell commands:", [...new Set(invoked)]);
    process.exit(1);
  }
}

void main();
