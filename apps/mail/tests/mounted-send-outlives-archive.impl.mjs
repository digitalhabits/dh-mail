/**
 * The walks — see mounted-send-outlives-archive.test.mjs.
 *
 * Every fixture is invented. No line of them was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";
import { UNDO_SEND_SECONDS } from "@/components/mail/undo-send";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** The count, and a little over, for the send to be made. */
const outlastTheCount = () => sleep(UNDO_SEND_SECONDS * 1000 + 800);

const ACCOUNT = "ulla@aavang.example";

const KITE = {
  account: ACCOUNT,
  threadId: "kite-1",
  subject: "Kite day on the dunes",
  fromName: "Asta Holm",
  fromEmail: "asta@haveklub.example",
  snippet: "Saturday, if the wind holds.",
  lastAt: "2026-08-21T07:45:00.000Z",
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Asta Holm", email: "asta@haveklub.example" }],
};
const FERRY = {
  account: ACCOUNT,
  threadId: "ferry-1",
  subject: "The early ferry",
  fromName: "Viggo Dam",
  fromEmail: "viggo@torvet.example",
  snippet: "It leaves at six now.",
  lastAt: "2026-08-20T09:10:00.000Z",
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Viggo Dam", email: "viggo@torvet.example" }],
};

const detail = (row, id, words) => ({
  account: ACCOUNT,
  threadId: row.threadId,
  subject: row.subject,
  participants: ["You", row.fromName],
  messages: [
    {
      id,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      toEmails: [ACCOUNT],
      ccEmails: [],
      sentAt: row.lastAt,
      bodyText: words,
      own: false,
      rfcMessageId: `<${id}@${row.fromEmail.split("@")[1]}>`,
    },
  ],
  totalMessageCount: 1,
  hasOlder: false,
  hasNewer: false,
  reply: {
    inReplyTo: `<${id}@${row.fromEmail.split("@")[1]}>`,
    references: `<${id}@${row.fromEmail.split("@")[1]}>`,
    to: [row.fromEmail],
    cc: [],
    allTo: [row.fromEmail],
    allCc: [],
  },
});
const THREADS = {
  "kite-1": detail(KITE, "k1", "Saturday, if the wind holds. Will you bring the red kite?"),
  "ferry-1": detail(FERRY, "f1", "It leaves at six now. Shall we take it together?"),
};

/** Each call to the send route, and each archive, oldest first. */
const sends = [];
const archived = [];
let listed = [KITE, FERRY];
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const body = () => JSON.parse(String(init?.body ?? "{}"));
  if (p === "/api/mail/send") {
    sends.push(body());
    return json({ ok: true, id: `sent-${sends.length}` });
  }
  if (p === "/api/mail/archive") {
    const sent = body();
    const ids = sent.threadIds ?? (sent.threadId ? [sent.threadId] : []);
    archived.push(...ids);
    listed = listed.filter((t) => !ids.includes(t.threadId));
    return json({ ok: true });
  }
  if (p === "/api/mail/threads") return json({ threads: listed, nextCursor: null });
  if (p === "/api/mail/thread") {
    const found = THREADS[url.searchParams.get("id") ?? ""];
    return found ? json({ thread: found }) : json({ error: "gone" });
  }
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
const buttons = () => [...document.querySelectorAll("button")];
const byTitle = (re) =>
  buttons().find((b) =>
    re.test((b.getAttribute("title") || "") + (b.getAttribute("aria-label") || ""))
  );
const text = () => document.body.textContent || "";

const typeInto = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  ).set;
  setter.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const writeReply = (html) => {
  const editor = document.querySelector(".ql-editor");
  assert(editor, "the reply editor is up");
  editor.innerHTML = html;
  editor.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const openThread = async (subject, words) => {
  const leaf = [...document.querySelectorAll("*")].find(
    (e) => e.childElementCount === 0 && (e.textContent || "").trim() === subject
  );
  assert(leaf, `the list shows "${subject}"`);
  clickEl(leaf);
  await sleep(900);
  assert(text().includes(words), `"${subject}" is open`);
};

/** The thread's own Archive, in the reader's toolbar. */
const archiveOpenThread = () => {
  const button = buttons().find((b) =>
    (b.getAttribute("aria-label") || b.getAttribute("title") || "").startsWith("Archive (")
  );
  assert(button, "the reader offers Archive");
  clickEl(button);
};

async function main() {
  try {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "send-outlives-archive-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await waitFor(() => text().includes(KITE.subject));

    // A reply, sent, and the thread archived while it counts.
    await openThread(KITE.subject, "bring the red kite?");
    clickEl(byTitle(/^reply \(/i));
    await sleep(1500);
    writeReply("<p>Yes, and spare string.</p>");
    await sleep(300);
    const sendNow = buttons().find(
      (b) => /^send \(/i.test(b.getAttribute("title") || "") && !b.disabled
    );
    assert(sendNow, "the reply can be sent");
    clickEl(sendNow);
    await sleep(400);
    assert.equal(sends.length, 0, "the reply waits out its count");

    archiveOpenThread();
    await sleep(600);
    assert.deepEqual(archived, ["kite-1"], "the thread is archived");
    assert(!text().includes("bring the red kite?"), "and its pane has gone");
    assert.equal(sends.length, 0, "and the reply has not gone yet");

    await outlastTheCount();
    assert.equal(sends.length, 1, "the reply went when the count ran out");
    const reply = sends[0];
    assert.deepEqual(reply.to, ["asta@haveklub.example"], "to the same person");
    assert.equal(reply.inReplyTo, "<k1@haveklub.example>", "as an answer to the same message");
    assert.equal(reply.threadId, "kite-1", "in the same conversation");
    assert(String(reply.html ?? reply.body).includes("spare string"), "with the words written");
    pass("a reply still goes when its thread is archived during the count");

    // A forward, the same way.
    await openThread(FERRY.subject, "Shall we take it together?");
    clickEl(byTitle(/^forward/i));
    await sleep(500);
    const recipientBox = [...document.querySelectorAll("input")].find((i) =>
      /name@example\.com/.test(i.getAttribute("placeholder") || "")
    );
    assert(recipientBox, "a forward shows its recipient box");
    typeInto(recipientBox, "ulf@havn.example,");
    await sleep(300);
    const forwardNow = buttons().find(
      (b) =>
        /^forward \(/i.test(b.getAttribute("title") || "") &&
        !b.disabled &&
        /forward/i.test(b.textContent || "")
    );
    assert(forwardNow, "the forward can be sent");
    clickEl(forwardNow);
    await sleep(400);
    assert.equal(sends.length, 1, "the forward waits out its count");

    archiveOpenThread();
    await sleep(600);
    assert.deepEqual(archived, ["kite-1", "ferry-1"], "the thread is archived");

    await outlastTheCount();
    assert.equal(sends.length, 2, "the forward went when the count ran out");
    assert.deepEqual(sends[1].to, ["ulf@havn.example"], "to the person it was for");
    assert(sends[1].forward, "as a forward");
    pass("a forward still goes when its thread is archived during the count");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the send-outlives-archive walk failed:", err);
    process.exit(1);
  }
}

void main();
