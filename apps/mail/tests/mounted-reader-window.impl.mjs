/**
 * The reader-window walk itself — see mounted-reader-window.test.mjs for
 * why it is two files. Fixtures are invented, as every fixture here must
 * be: no line of them ever stood in anybody's real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MAIL_CHANGED_KEY } from "@/lib/mail/reader-window";
import { ThreadReaderWindow } from "@/components/mail/ThreadReaderWindow";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";
const OTHER_ACCOUNT = "ulla@aavang-arbejde.example";
const THREAD_ID = "allotment-1";

/**
 * What the opener hands over: this thread, plus the copy of the same
 * conversation that arrived in the reader's other mailbox and was folded
 * into the row. Written the way openMailThreadWindow writes it.
 */
window.localStorage.setItem(
  `redd-plan-mail-reader-handoff:${ACCOUNT}|${THREAD_ID}`,
  JSON.stringify({
    at: Date.now(),
    copies: [
      { account: ACCOUNT, threadId: THREAD_ID },
      { account: OTHER_ACCOUNT, threadId: "allotment-9" },
    ],
  })
);

const MESSAGES = [
  {
    id: "m1",
    fromName: "Haveforeningen Solsikken",
    fromEmail: "bestyrelse@solsikken.example",
    toEmails: [ACCOUNT],
    ccEmails: [OTHER_ACCOUNT],
    sentAt: "2026-08-28T10:00:00.000Z",
    bodyText: "The water is turned off on Saturday while the pipes are moved.",
    own: false,
    rfcMessageId: "<allot-m1@solsikken.example>",
  },
  {
    id: "m2",
    fromName: "Ulla Aavang",
    fromEmail: ACCOUNT,
    toEmails: ["bestyrelse@solsikken.example"],
    ccEmails: [],
    sentAt: "2026-08-28T12:30:00.000Z",
    bodyText: "Thanks for the warning — I will fill the cans on Friday.",
    own: true,
    rfcMessageId: "<allot-m2@aavang.example>",
  },
];

const archived = [];
const unknownPaths = new Set();
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (p === "/api/mail/thread")
    return json({
      thread: {
        account: ACCOUNT,
        threadId: THREAD_ID,
        subject: "Water off on Saturday",
        participants: ["You", "Haveforeningen Solsikken"],
        messages: MESSAGES,
        totalMessageCount: MESSAGES.length,
        hasOlder: false,
        hasNewer: false,
        reply: {
          inReplyTo: "<allot-m1@solsikken.example>",
          references: "<allot-m1@solsikken.example>",
          to: ["bestyrelse@solsikken.example"],
          cc: [],
          allTo: ["bestyrelse@solsikken.example"],
          allCc: [],
        },
      },
    });
  if (p === "/api/mail/archive") {
    archived.push(JSON.parse(init?.body ?? "{}"));
    return json({ success: true });
  }
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
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
const bodyText = () => document.body.textContent || "";

async function main() {
  let root;
  try {
    // The window that closes when an action removes the conversation.
    let windowClosed = false;
    window.close = () => {
      windowClosed = true;
    };

    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(ThreadReaderWindow, {
        account: ACCOUNT,
        threadId: THREAD_ID,
        accounts: [ACCOUNT, OTHER_ACCOUNT],
        name: "Haveforeningen Solsikken",
        email: "bestyrelse@solsikken.example",
        subject: "Water off on Saturday",
      })
    );
    await sleep(700);

    assert(bodyText().includes("I will fill the cans on Friday."));
    assert(byTitle(/^archive/i), "the reader's toolbar is up");
    pass("the window mounts and paints the thread from the transport");

    assert(!byTitle(/focus mode/i) && !byTitle(/show mail list/i));
    pass("no focus toggle — there is no list here to hide");

    clickEl(byTitle(/^archive/i));
    await sleep(500);
    const hit = archived
      .map((c) => `${c.account}|${c.threadId}`)
      .sort()
      .join(", ");
    assert.equal(
      hit,
      `${OTHER_ACCOUNT}|allotment-9, ${ACCOUNT}|${THREAD_ID}`,
      "both copies from the handoff are archived"
    );
    pass(`archive takes every copy the opener handed over — ${hit}`);

    assert(windowClosed, "the window closed with the conversation");
    const signal = window.localStorage.getItem(MAIL_CHANGED_KEY);
    assert(signal && signal.includes(THREAD_ID), "and told the other windows");
    pass("then the window goes, and the list is told to catch up");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the reader window walk failed:", err);
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
