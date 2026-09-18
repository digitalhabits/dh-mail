/**
 * The phone walk itself — see mounted-phone.test.mjs for why it is two
 * files. The fixtures are the ones mounted-smoke uses, invented like every
 * fixture here.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (p === "/api/mail/threads")
    return json({ threads: [CHOIR, LOAN], nextCursor: null });
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
          references: "<choir-m1@sangkor.example> <choir-m3@sangkor.example>",
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
const byLabel = (text) => buttons().find((b) => b.getAttribute("aria-label") === text);
const bodyText = () => document.body.textContent || "";
const rowFor = (subject) =>
  [...document.querySelectorAll("[data-thread-key]")].find((row) =>
    (row.textContent || "").includes(subject)
  );

async function main() {
  let root;
  try {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "phone-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await sleep(700);

    assert(document.querySelector(".mail-shell.mail-phone"), "the phone frame is up");
    assert(bodyText().includes("Choir practice moves to Thursday"));
    assert(bodyText().includes("Your library loan is due back"));
    pass("the page mounts in the phone frame and paints the fetched rows");

    assert(!byTitle(/expand list/i), "no list expand on a phone");
    assert(!document.querySelector('[role="separator"]'), "nothing to drag");
    assert(byTitle(/new email/i), "New email is at the thumb");
    assert(byLabel("Folders"), "the folders are behind a button");
    assert(byLabel("Search"), "and search behind the glass");
    pass("the desktop chrome is gone: no resize handles, no expand; a footer and a button instead");

    assert(!document.querySelector(".mail-phone-detail"), "nothing over the list yet");
    clickEl(rowFor("Choir practice moves to Thursday"));
    await sleep(700);
    const detail = document.querySelector(".mail-phone-detail");
    assert(detail, "the thread opened over the list");
    assert(bodyText().includes("See you by the organ."));
    const back = detail.querySelector(".mail-phone-back button");
    assert(back && /Inbox/.test(back.textContent || ""), "the way back names the list");
    assert(!byTitle(/focus mode/i), "the reader offers no focus mode: there is no list beside it");
    pass("a tap on a row opens the thread over the list, with the way back at the top");

    clickEl(back);
    await sleep(500);
    assert(!document.querySelector(".mail-phone-detail"), "the thread has left");
    assert(bodyText().includes("Your library loan is due back"), "the list is there");
    pass("the way back returns to the list");

    const row = rowFor("Your library loan is due back");
    row.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        isPrimary: true,
        clientX: 40,
        clientY: 120,
      })
    );
    await sleep(700);
    assert(document.querySelector('[role="menu"]'), "the row's menu is up");
    assert(byTitle(/mark as unread|mark as read/i) || /unread/i.test(bodyText()), "with the row's actions in it");
    pass("a long press on a row opens the same menu a right-click does");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(200);

    const drawer = document.querySelector(".mail-phone-drawer");
    assert(drawer && drawer.getAttribute("aria-hidden") === "true", "the drawer starts closed");
    clickEl(byLabel("Folders"));
    await sleep(300);
    assert(drawer.getAttribute("aria-hidden") === "false", "the drawer is open");
    assert(byTitle(/close folders/i), "and a scrim closes it");
    clickEl(byTitle(/close folders/i));
    await sleep(300);
    assert(drawer.getAttribute("aria-hidden") === "true", "closed again");
    pass("the folders come out of the drawer and go back");

    clickEl(byLabel("Search"));
    await sleep(300);
    const field = document.querySelector('.mail-phone-search input[type="search"]');
    assert(field, "the search field took the top row");
    assert(bodyText().includes("Everywhere"), "with the scope chips under it");
    pass("the glass opens the search in place");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the mounted phone walk failed:", err);
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
