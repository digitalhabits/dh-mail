/**
 * The walks — see mounted-send-handover.test.mjs.
 *
 * Every fixture is invented. No line of them was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";
import { recipientsFromEmails } from "@/lib/mail/contact-list-types";
import { threadDraftKey } from "@/lib/mail/local-drafts";
import { offerHandover, withdrawHandover } from "@/lib/mail/send-handover";
import { idbHandoverRows } from "@/lib/mail/send-handover-store";

import { waitFor } from "./mounted-dom.mjs";
import { installStores } from "./mounted-handover-stores.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const SUBJECT = "Plant sale on the square";
const BENCH_SUBJECT = "The bench by the harbor";
const row = (threadId, subject, fromName, fromEmail, snippet, lastAt) => ({
  account: ACCOUNT,
  threadId,
  subject,
  fromName,
  fromEmail,
  snippet,
  lastAt,
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: fromName, email: fromEmail }],
});
const PLANTS = row("plants-1", SUBJECT, "Asta Holm", "asta@haveklub.example", "We have forty tomato plants and no table.", "2026-08-21T07:45:00.000Z");
const BENCH = row("bench-1", BENCH_SUBJECT, "Viggo Dam", "viggo@torvet.example", "The bench needs paint before the autumn.", "2026-08-20T09:10:00.000Z");
const thread = (threadId, subject, from, fromEmail, words, rfc) => ({
  account: ACCOUNT,
  threadId,
  subject,
  participants: ["You", from],
  messages: [
    {
      id: `${threadId}-m1`,
      fromName: from,
      fromEmail,
      toEmails: [ACCOUNT],
      ccEmails: [],
      sentAt: "2026-08-21T07:45:00.000Z",
      bodyText: words,
      own: false,
      rfcMessageId: rfc,
    },
  ],
  totalMessageCount: 1,
  hasOlder: false,
  hasNewer: false,
  reply: { inReplyTo: rfc, references: rfc, to: [fromEmail], cc: [], allTo: [fromEmail], allCc: [] },
});
const THREADS = {
  "plants-1": thread("plants-1", SUBJECT, "Asta Holm", "asta@haveklub.example", "We have forty tomato plants and no table. Can you bring one?", "<plants-p1@haveklub.example>"),
  "bench-1": thread("bench-1", BENCH_SUBJECT, "Viggo Dam", "viggo@torvet.example", "The bench needs paint before the autumn. Who has a brush?", "<bench-b1@torvet.example>"),
};

const { draftRows, handoverRows } = installStores();

/** The shell's events: the page listens, and the suite sends. */
const listeners = new Map();
window.__TAURI__ = {
  event: {
    listen: async (name, handler) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
      return () => listeners.get(name).delete(handler);
    },
  },
};
const tell = (id) => {
  for (const handler of listeners.get("mail-send-handover") ?? []) handler({ payload: { id } });
};

/** The body of each call to the send route, oldest first. */
const sends = [];
let failNextSend = false;
const unknownPaths = new Set();
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (p === "/api/mail/send") {
    if (failNextSend) {
      failNextSend = false;
      return json({ error: "The server did not take the message" }, 500);
    }
    sends.push(JSON.parse(String(init?.body ?? "{}")));
    return json({ ok: true, id: "sent-1", threadId: "sent-thread-1" });
  }
  if (p === "/api/mail/threads") return json({ threads: [PLANTS, BENCH], nextCursor: null });
  if (p === "/api/mail/thread") return json({ thread: THREADS[url.searchParams.get("id")] ?? THREADS["plants-1"] });
  if (p === "/api/mail/snoozed") return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
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
const pageText = () => document.body.textContent || "";
/** The bubble of a message that is on its way: the thread draws its words in a frame. */
const bubble = (id) => document.querySelector(`[data-message-id="local-${id}"]`);
const editorWords = () => {
  const editor = document.querySelector(".ql-editor");
  return editor ? (editor.textContent || "").trim() : null;
};
const openThread = async (subject, words) => {
  const leaf = [...document.querySelectorAll("*")].find(
    (e) => e.childElementCount === 0 && (e.textContent || "").trim() === subject
  );
  assert(leaf, `the list shows "${subject}"`);
  clickEl(leaf);
  await waitFor(() => pageText().includes(words));
  assert(pageText().includes(words), `"${subject}" is open`);
  await sleep(600);
};
/** The confirmations at the foot of the list that count a send down. */
const counts = (start = "Sending in") =>
  [...document.querySelectorAll("[data-undo-foot] [data-undo-card]")].filter((card) =>
    (card.textContent || "").startsWith(start)
  );
const pressUndo = () => {
  const card = counts().at(-1);
  assert(card, "a send offered its Undo");
  card.querySelector("[data-undo-slot-button]").click();
};
/** The count ends: the page is told that it closes, which sends at once. */
const endCounts = async () => {
  window.dispatchEvent(new window.Event("pagehide"));
  await sleep(500);
};

const FILE = {
  id: "att-1",
  filename: "seeds.txt",
  mimeType: "text/plain",
  size: 21,
  progress: null,
  contentBase64: Buffer.from("beans, peas, marigold").toString("base64"),
};

/** A message as the reply window makes it: see SendLaunch in send-launch.ts. */
const launch = (id, threadId, words, extra = {}) => {
  const t = THREADS[threadId];
  const to = t.reply.to;
  return {
    account: ACCOUNT,
    threadId,
    localId: `local-${id}`,
    entry: {
      status: "sending",
      mode: "reply",
      reply: `<p>${words}</p>`,
      subject: "",
      startsNewThread: false,
      toList: recipientsFromEmails(to),
      ccList: [],
      showCc: false,
      bccList: [],
      editRecipients: false,
      includeSignature: false,
      signatureHtml: null,
      fromAccount: ACCOUNT,
      attachments: [FILE],
      request: {
        account: ACCOUNT,
        to,
        subject: `Re: ${t.subject}`,
        body: words,
        html: `<p>${words}</p>`,
        includeSignature: false,
        threadId,
        inReplyTo: t.reply.inReplyTo,
        references: t.reply.references,
        messageCount: 1,
        attachments: [{ filename: FILE.filename, mimeType: FILE.mimeType, contentBase64: FILE.contentBase64 }],
        ...extra.request,
      },
    },
    bubble: extra.later
      ? null
      : {
          id: `local-${id}`,
          fromName: "You",
          fromEmail: ACCOUNT,
          toEmails: to,
          ccEmails: [],
          sentAt: new Date().toISOString(),
          bodyText: words,
          bodyHtml: `<p>${words}</p>`,
          own: true,
        },
    quoteMessageId: null,
    original: null,
    later: extra.later ?? null,
    readableAttachments: [],
  };
};
/** The reply window's two steps: the offer in the store, then the event. */
const handOver = async (id, message) => {
  await offerHandover(idbHandoverRows(), id, message);
  tell(id);
  await sleep(300);
};

async function main() {
  let root;
  try {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "send-handover-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await waitFor(() => pageText().includes(SUBJECT));
    await openThread(SUBJECT, "Can you bring one?");
    await waitFor(() => listeners.get("mail-send-handover")?.size);
    assert(listeners.get("mail-send-handover")?.size, "the page listens for a handover");

    // The conversation is open: the count, the bubble, one send.
    const TABLE = "The long table is in the shed.";
    await handOver("h-open", launch("h-open", "plants-1", TABLE));
    assert.equal(counts().length, 1, "the count stands at the foot of the list");
    assert(bubble("h-open"), "the reply shows as a bubble in the open conversation");
    assert.equal(editorWords(), null, "and no composer opens");
    assert.equal(sends.length, 0, "nothing is sent before the count ends");
    assert.equal(handoverRows.get("h-open").state, "claimed", "the offer is claimed, which the reply window waits for");
    assert.equal(handoverRows.get("h-open").payload, null, "and the row keeps no copy of the message");
    tell("h-open");
    tell("h-open");
    await sleep(300);
    assert.equal(counts().length, 1, "the same offer told again starts no second count");
    await endCounts();
    assert.equal(sends.length, 1, "the message goes one time");
    assert.deepEqual(sends[0].to, ["asta@haveklub.example"]);
    assert.equal(sends[0].threadId, "plants-1");
    assert.equal(sends[0].inReplyTo, "<plants-p1@haveklub.example>");
    assert(String(sends[0].html).includes(TABLE), "with the words");
    assert.deepEqual(sends[0].attachments.map((a) => a.filename), ["seeds.txt"], "and the file");
    tell("h-open");
    await endCounts();
    assert.equal(sends.length, 1, "and not again when the offer is told after the send");
    pass("a handed-over reply for the open conversation shows its count and its bubble, and goes one time");

    // Undo in the open conversation: the words and the file come back.
    const CHAIRS = "We can bring six chairs.";
    await handOver("h-undo", launch("h-undo", "plants-1", CHAIRS));
    assert(bubble("h-undo"), "the second reply shows as a bubble");
    pressUndo();
    await waitFor(() => editorWords() === CHAIRS);
    assert.equal(editorWords(), CHAIRS, "Undo puts the words in the reply box of the conversation");
    assert(!bubble("h-undo"), "and takes the bubble away");
    assert(
      (document.querySelector(".mail-composer-card")?.textContent || "").includes("seeds.txt"),
      "with the file in the strip"
    );
    await endCounts();
    assert.equal(sends.length, 1, "and nothing was sent");
    // Sent from this box now, as any reply.
    const sendButton = buttons().find((b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled);
    assert(sendButton, "the reply that came back can be sent");
    clickEl(sendButton);
    await sleep(300);
    await endCounts();
    assert.equal(sends.length, 2, "the reply that came back goes from the main window's own box");
    assert(String(sends[1].html).includes(CHAIRS));
    pass("Undo of a handed-over reply puts the words and the file back in the main window's reply box");

    // The conversation is not open: the count shows, and Undo opens it.
    const BRUSH = "I have two brushes and a tin of green.";
    await handOver("h-away", launch("h-away", "bench-1", BRUSH));
    assert.equal(counts().length, 1, "a reply for a conversation that is not open has its count too");
    assert(pageText().includes("Can you bring one?"), "and the open conversation stays open");
    assert.equal(handoverRows.get("h-away").state, "claimed");
    pressUndo();
    await waitFor(() => editorWords() === BRUSH);
    assert(pageText().includes("Who has a brush?"), "Undo opens the conversation of the reply");
    assert.equal(editorWords(), BRUSH, "with the words in its reply box");
    assert(
      (document.querySelector(".mail-composer-card")?.textContent || "").includes("seeds.txt"),
      "and the file in the strip"
    );
    await endCounts();
    assert.equal(sends.length, 2, "and nothing was sent");
    pass("Undo of a reply whose conversation is not open opens the conversation with the words in its box");

    // A message is being written in that conversation: the handed-over one
    // goes with no bubble, and the box is not touched.
    const PAINT = "The paint is in my garage.";
    await handOver("h-busy", launch("h-busy", "bench-1", PAINT));
    assert.equal(counts().length, 1, "the count shows");
    assert.equal(editorWords(), BRUSH, "the message that is being written stays in its box");
    await endCounts();
    assert.equal(sends.length, 3, "the handed-over message goes");
    assert(String(sends[2].html).includes(PAINT));
    assert.equal(sends[2].threadId, "bench-1");
    assert.equal(editorWords(), BRUSH, "and the box still holds its own words");
    pass("a handed-over reply does not touch a message that is being written in that conversation");

    // An offer that the reply window took back.
    await offerHandover(idbHandoverRows(), "h-withdrawn", launch("h-withdrawn", "plants-1", "Never mind."));
    assert.equal(await withdrawHandover(idbHandoverRows(), "h-withdrawn"), "withdrawn");
    tell("h-withdrawn");
    await sleep(300);
    assert.equal(counts().length, 0, "a withdrawn offer starts no count");
    await endCounts();
    assert.equal(sends.length, 3, "and the main window does not send it");
    tell("no-such-offer");
    await endCounts();
    assert.equal(sends.length, 3, "an unknown id sends nothing");
    pass("the main window does not send an offer that was withdrawn");

    // With no conversation of its own on screen, the message still goes.
    const TABLE_2 = "Asta has the table now.";
    await handOver("h-detached", launch("h-detached", "plants-1", TABLE_2));
    assert.equal(counts().length, 1);
    assert(!bubble("h-detached"), "there is no bubble, because the conversation is not open");
    await endCounts();
    assert.equal(sends.length, 4, "the message goes with its conversation not open");
    assert(String(sends[3].html).includes(TABLE_2));
    assert.equal(sends[3].threadId, "plants-1");
    pass("a handed-over reply goes one time when its conversation is not open");

    // Send later, handed over: the notice, then the request with its time.
    const sendAt = new Date(Date.now() + 3_600_000).toISOString();
    const NOTICE = "Sends at 09:00 if Mail is open";
    await handOver(
      "h-later",
      launch("h-later", "plants-1", "See you at nine.", {
        request: { sendAt },
        later: {
          notice: NOTICE,
          pending: {
            sendAt,
            account: ACCOUNT,
            threadId: "plants-1",
            toName: "asta@haveklub.example",
            subject: `Re: ${SUBJECT}`,
            bodyText: "See you at nine.",
            to: ["asta@haveklub.example"],
            cc: [],
            status: "waiting",
          },
        },
      })
    );
    assert.equal(counts(NOTICE).length, 1, "a message for later shows its notice with Undo");
    await endCounts();
    assert.equal(sends.length, 5, "and the request goes to the provider one time");
    assert.equal(sends[4].sendAt, sendAt, "with its time");
    pass("a handed-over Send later shows its notice and schedules one time");

    // A send that fails with no conversation on screen: the words are kept.
    const plantsKey = threadDraftKey(ACCOUNT, "plants-1");
    assert.equal(draftRows.get(plantsKey), undefined, "the conversation has no stored draft before");
    const LOST = "This one meets a server that says no.";
    failNextSend = true;
    await handOver("h-fails", launch("h-fails", "plants-1", LOST));
    await endCounts();
    await waitFor(() => draftRows.get(plantsKey));
    assert.equal(sends.length, 5, "the send failed");
    assert(String(draftRows.get(plantsKey)?.body).includes(LOST), "the words are the conversation's draft");
    assert.deepEqual(draftRows.get(plantsKey).attachments.map((f) => f.filename), ["seeds.txt"], "with the file");
    pass("a handed-over reply that fails to send is kept as the conversation's draft");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the handover walk failed:", err);
    if (unknownPaths.size) console.error("paths the fixture transport did not know:", [...unknownPaths]);
    process.exit(1);
  }
}

void main();
