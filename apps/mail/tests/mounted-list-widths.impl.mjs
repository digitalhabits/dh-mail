/**
 * The walk itself — see mounted-list-widths.test.mjs. The fixtures are the
 * smoke walk's, invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let listReads = 0;
const ACCOUNT = "ulla@aavang.example";
const CHOIR = {
  account: ACCOUNT,
  threadId: "choir-1",
  subject: "Choir practice moves to Thursday",
  fromName: "Merle Mikkelsen",
  fromEmail: "merle@sangkor.example",
  snippet: "The hall is being painted on Tuesday, so…",
  lastAt: "2026-08-20T09:12:00.000Z",
  unread: false,
  messageCount: 3,
  tab: "other",
  externalParticipants: [
    { name: "Merle Mikkelsen", email: "merle@sangkor.example" },
  ],
};
const LOAN = {
  account: ACCOUNT,
  threadId: "loan-1",
  subject: "Your library loan is due back",
  fromName: "Byens Bibliotek",
  fromEmail: "noreply@bibliotek.example",
  snippet: "One item is due on Friday.",
  lastAt: "2026-08-19T15:40:00.000Z",
  unread: true,
  messageCount: 1,
  tab: "other",
  externalParticipants: [
    { name: "Byens Bibliotek", email: "noreply@bibliotek.example" },
  ],
};
const CHOIR_MESSAGES = [
  {
    id: "m1",
    fromName: "Merle Mikkelsen",
    fromEmail: "merle@sangkor.example",
    toEmails: [ACCOUNT],
    ccEmails: [],
    sentAt: "2026-08-19T08:00:00.000Z",
    bodyText: "The hall is being painted on Tuesday, so can we move to Thursday?",
    own: false,
    rfcMessageId: "<choir-m1@sangkor.example>",
  },
  {
    id: "m2",
    fromName: "Ulla Aavang",
    fromEmail: ACCOUNT,
    toEmails: ["merle@sangkor.example"],
    ccEmails: [],
    sentAt: "2026-08-19T18:30:00.000Z",
    bodyText: "Thursday works for me. Same time?",
    own: true,
    rfcMessageId: "<choir-m2@aavang.example>",
  },
  {
    id: "m3",
    fromName: "Merle Mikkelsen",
    fromEmail: "merle@sangkor.example",
    toEmails: [ACCOUNT],
    ccEmails: [],
    sentAt: "2026-08-20T09:12:00.000Z",
    bodyText: "Same time. See you by the organ.",
    own: false,
    rfcMessageId: "<choir-m3@sangkor.example>",
  },
];

const unknownPaths = new Set();
setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (p === "/api/mail/threads") {
    listReads += 1;
    return json({ threads: [CHOIR, LOAN], nextCursor: null });
  }
  if (p === "/api/mail/thread")
    return json({
      thread: {
        account: ACCOUNT,
        threadId: "choir-1",
        subject: "Choir practice moves to Thursday",
        participants: ["You", "Merle Mikkelsen"],
        messages: CHOIR_MESSAGES,
        totalMessageCount: CHOIR_MESSAGES.length,
        hasOlder: false,
        hasNewer: false,
        reply: {
          inReplyTo: "<choir-m3@sangkor.example>",
          references:
            "<choir-m1@sangkor.example> <choir-m2@aavang.example> <choir-m3@sangkor.example>",
          to: ["merle@sangkor.example"],
          cc: [],
          allTo: ["merle@sangkor.example"],
          allCc: [],
        },
      },
    });
  if (p === "/api/mail/snoozed")
    return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
  // The composer's address box reads these when it opens.
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
const byLabel = (re) => buttons().find((b) => re.test(b.getAttribute("aria-label") || ""));

async function main() {
  let root;
  try {
    // The list at its least width, as a reader who dragged it there left it.
    window.localStorage.setItem("redd-plan-mail-list-width", "56");
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "narrow-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await sleep(700);

    const compose = byLabel(/^New email$/);
    const sync = byLabel(/^Sync/);
    assert(compose && sync, "New email and Sync are there");
    assert.equal((compose.textContent || "").trim(), "", "New email is an icon alone");
    assert.equal((sync.textContent || "").trim(), "", "and so is Sync");
    pass("at its narrowest, the head of the list is a column of icons");

    const before = listReads;
    clickEl(sync);
    await sleep(700);
    assert(listReads > before, `Sync reads the list again (${before} -> ${listReads})`);
    pass("Sync, as an icon, reads the list again");

    clickEl(byLabel(/^New email$/));
    await sleep(700);
    assert(document.querySelector("textarea"), "a composer is open, with its subject box");
    pass("New email, as an icon, opens a composer");
    root.unmount();

    // Wide enough for a row on one line (40rem, 640px at the default size).
    window.localStorage.setItem("redd-plan-mail-list-width", "700");
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "wide-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await sleep(700);
    const senders = [...document.querySelectorAll("[data-thread-key] p")]
      .filter((p) => p.className.includes("w-[10rem]"))
      .map((p) => (p.textContent || "").trim());
    assert(senders.includes("Merle Mikkelsen"), `each row names its sender in a column of its own: ${senders.join(", ")}`);
    pass("wide enough, each row is one line, with the sender in a column of its own");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the list widths walk failed:", err);
    if (unknownPaths.size) console.error("paths the fixture transport did not know:", [...unknownPaths]);
    process.exit(1);
  }
}

void main();
