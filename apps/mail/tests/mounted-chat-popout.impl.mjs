/**
 * The walk itself — see mounted-chat-popout.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { ChatPopout } from "@/components/mail/ChatPopout";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "brit@hagemo.example";
const PERSON = "torstein@vollen.example";
const message = (id, fromEmail, text, at) => ({
  id,
  threadId: "rowing-1",
  rfcMessageId: `<${id}@hagemo.example>`,
  from: fromEmail === ACCOUNT ? `Brit Hagemo <${ACCOUNT}>` : `Torstein Vollen <${PERSON}>`,
  fromEmail,
  fromName: fromEmail === ACCOUNT ? "Brit Hagemo" : "Torstein Vollen",
  to: [fromEmail === ACCOUNT ? PERSON : ACCOUNT],
  cc: [],
  subject: "Rowing on Sunday",
  date: at,
  internalDate: Date.parse(at),
  bodyText: text,
  bodyHtml: "",
  snippet: text,
  attachments: [],
  labelIds: [],
});
const THREAD = {
  account: ACCOUNT,
  threadId: "rowing-1",
  subject: "Rowing on Sunday",
  participants: ["Brit Hagemo", "Torstein Vollen"],
  messages: [
    message("m1", PERSON, "Is the boat free on Sunday morning?", "2026-08-20T08:00:00.000Z"),
    message("m2", ACCOUNT, "It is, from nine.", "2026-08-20T08:30:00.000Z"),
  ],
  totalMessageCount: 2,
  hasOlder: false,
  hasNewer: false,
  reply: { inReplyTo: "<m2@hagemo.example>", references: "<m2@hagemo.example>", to: [PERSON], cc: [], allTo: [PERSON], allCc: [] },
};
const posts = [];
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (init?.method === "POST") {
    posts.push({ path: p, body: init.body ? JSON.parse(init.body) : null });
    return json({ ok: true, id: "sent-1", threadId: "rowing-1" });
  }
  if (p === "/api/mail/thread") return json({ thread: THREAD });
  if (p === "/api/mail/signature") return json({});
  return json({});
});

const text = () => document.body.textContent || "";

async function main() {
  // happy-dom lays nothing out: every box says it is 900px tall inside.
  Object.defineProperty(window.HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 900 });
  let closed = 0;
  window.close = () => {
    closed += 1;
  };
  try {
    document.body.innerHTML = '<div id="root"></div>';
    const root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(ChatPopout, {
        account: ACCOUNT,
        threadId: "rowing-1",
        personName: "Torstein Vollen",
        personEmail: PERSON,
        subject: "Rowing on Sunday",
      })
    );
    await waitFor(() => text().includes("Is the boat free on Sunday morning?") && text().includes("It is, from nine."));
    await sleep(200);
    const pinned = [...document.querySelectorAll("div")].filter((el) => el.scrollTop === 900);
    assert(pinned.length >= 1, "the scroller is at the end");
    pass("the window reads the thread and shows its bubbles, with the view at the end");

    const editor = await waitFor(() => document.querySelector(".mail-chat-input .ql-editor"));
    assert(editor, "the box to write in is there");
    editor.innerHTML = "<p>See you at the boathouse.</p>";
    editor.dispatchEvent(new window.Event("input", { bubbles: true }));
    await sleep(100);
    await sleep(300);
    // Quill acts on a key only while it has the focus and a caret.
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new window.Event("selectionchange"));
    await sleep(100);
    editor.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    await sleep(300);
    await waitFor(() => posts.some((x) => x.path === "/api/mail/send"));
    const sent = posts.find((x) => x.path === "/api/mail/send");
    assert(sent, "Enter sends");
    assert(JSON.stringify(sent.body).includes("See you at the boathouse."), JSON.stringify(sent.body).slice(0, 200));
    assert.equal(sent.body.threadId, "rowing-1");
    pass("Enter in the box sends the words to the thread");

    window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await waitFor(() => closed > 0);
    assert.equal(closed, 1, "the window goes");
    pass("Escape puts the window away");
  } catch (err) {
    console.error("the mounted walk failed:", err);
    process.exit(1);
  }
  process.exit(0);
}

void main();
