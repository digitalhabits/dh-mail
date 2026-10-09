/**
 * The mounted walk itself — see mounted-smoke.test.mjs for why it is two
 * files. Fixtures are invented, as every fixture here must be: no line of
 * them ever stood in anybody's real mailbox.
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
    attachments: [
      { attachmentId: "seating", filename: "seating-plan.txt", mimeType: "text/plain", size: 812 },
    ],
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
const press = (key, init = {}) =>
  (document.activeElement || document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  );
const stored = (name) => window.localStorage.getItem(name);
const UI_SCALE = "redd-plan-mail-ui-scale";
const ZOOM = "redd-plan-mail-zoom";

async function main() {
  let root;
  try {
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById("root"));
    root.render(
      React.createElement(MailPage, {
        accounts: [ACCOUNT],
        viewerId: "smoke-viewer",
        ownAddresses: [ACCOUNT],
      })
    );
    await sleep(700);

    assert(bodyText().includes("Choir practice moves to Thursday"));
    assert(bodyText().includes("Your library loan is due back"));
    pass("the page mounts and paints the fetched rows");

    // With nothing open, Command+Plus and Minus size the app.
    press("=", { metaKey: true, code: "Equal" });
    await sleep(100);
    assert(Number(stored(UI_SCALE)) > 1, `Command+Plus with nothing open makes the app larger (${stored(UI_SCALE)})`);
    press("-", { metaKey: true, code: "Minus" });
    await sleep(100);
    assert.equal(stored(UI_SCALE), null, `and Command+Minus brings it back (${stored(UI_SCALE)})`);
    // Option+Command: always the app, and 0 puts it back.
    press("≠", { metaKey: true, altKey: true, code: "Equal" });
    await sleep(100);
    assert(Number(stored(UI_SCALE)) > 1, "Option+Command+Plus makes the app larger");
    press("º", { metaKey: true, altKey: true, code: "Digit0" });
    await sleep(100);
    assert.equal(stored(UI_SCALE), null, "and Option+Command+0 puts it back");
    pass("the text size keys size the app when nothing is open");

    const rowLeaf = [...document.querySelectorAll("*")].filter(
      (e) =>
        e.childElementCount === 0 &&
        /Choir practice moves to Thursday/.test(e.textContent || "")
    );
    clickEl(rowLeaf[rowLeaf.length - 1]);
    await sleep(700);
    assert(byTitle(/^archive/i), "the reader's toolbar is up");
    assert(!byTitle(/focus mode/i), "with no Focus mode button on it");
    assert(bodyText().includes("See you by the organ."));
    pass("a click on a row opens the thread and its messages");

    const heading = document.querySelector(".mail-thread-header h2");
    assert.equal(heading?.textContent?.trim(), "Choir practice moves to Thursday", "the heading names the thread");
    assert(byTitle(/^1 attachment/), "and the strip rolls up the thread's one file");
    pass("the thread's heading names it, and its files are rolled up in the strip");

    // With a thread open, Command+Plus is the thread's zoom; the app stays.
    const zoomBefore = Number(stored(ZOOM) ?? 1);
    press("=", { metaKey: true, code: "Equal" });
    await sleep(400);
    assert(Number(stored(ZOOM)) > zoomBefore, `Command+Plus with a thread open zooms the thread (${zoomBefore} -> ${stored(ZOOM)})`);
    assert.equal(stored(UI_SCALE), null, "and leaves the app's size alone");
    press("-", { metaKey: true, code: "Minus" });
    await sleep(400);
    assert.equal(Number(stored(ZOOM)), zoomBefore, "Command+Minus zooms it back");
    press("≠", { metaKey: true, altKey: true, code: "Equal" });
    await sleep(100);
    assert(Number(stored(UI_SCALE)) > 1, "Option+Command+Plus is still the app with a thread open");
    press("º", { metaKey: true, altKey: true, code: "Digit0" });
    await sleep(100);
    pass("with a thread open, Command+Plus zooms the thread and Option+Command+Plus the app");

    clickEl(byTitle(/hide the mail list/i));
    await sleep(700);
    const listShown = () => Boolean(document.querySelector("[data-list-expanded]"));
    assert(!listShown(), "the list has left");
    pass("the list's own button puts it away");

    // The pointer on the edge it went into brings it out, with a pin.
    const edge = document.querySelector("[data-mail-list-edge]");
    assert(edge, "its edge waits for the pointer");
    edge.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await sleep(100);
    assert(listShown(), "the pointer on the edge brings it out");
    clickEl(byTitle(/keep the mail list shown/i));
    await sleep(700);
    assert(listShown() && byTitle(/hide the mail list/i), "the pin keeps it");
    assert(!document.querySelector("[data-mail-list-edge]"), "and the edge stands down");
    pass("the edge brings it out, and the pin keeps it shown");

    /*
      A search brings a hidden list out, since its answers are in the list.
      Its button is then the pin: the list is hidden, out only for now.
      Hidden during a search, it still comes out from the edge.
    */
    const searchBox = document.querySelector('input[type="search"]');
    assert(searchBox, "the title bar has the search box");
    const search = (value) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(searchBox, value);
      searchBox.dispatchEvent(new window.Event("input", { bubbles: true }));
    };
    clickEl(byTitle(/hide the mail list/i));
    await sleep(700);
    assert(!listShown(), "the list is put away again");
    search("choir");
    await sleep(900);
    assert(listShown(), "a search brings it out");
    assert(byTitle(/keep the mail list shown/i), "with the pin");
    assert(!byTitle(/hide the mail list/i), "and no hide button");
    pass("a search brings a hidden list out, with the pin");

    clickEl(byTitle(/keep the mail list shown/i));
    await sleep(700);
    assert(listShown() && byTitle(/hide the mail list/i), "the pin keeps it");
    clickEl(byTitle(/hide the mail list/i));
    await sleep(700);
    assert(!listShown(), "hidden during the search, it goes");
    const searchEdge = document.querySelector("[data-mail-list-edge]");
    assert(searchEdge, "and its edge waits for the pointer");
    searchEdge.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    await sleep(100);
    assert(listShown(), "the edge brings it out during the search");
    clickEl(byTitle(/keep the mail list shown/i));
    await sleep(700);
    assert(listShown() && byTitle(/hide the mail list/i), "and the pin keeps it");
    search("");
    await sleep(700);
    assert(listShown(), "kept, it stays when the search is cleared");
    pass("hidden during a search, the list comes out from the edge and can be pinned");

    // The list's own expand has no button any more; its shortcut stays.
    const expanded = () => document.querySelector("[data-list-expanded]")?.getAttribute("data-list-expanded");
    assert(!byTitle(/expand list/i), "no expand button beside New email");
    press("l", { metaKey: true, altKey: true, code: "KeyL" });
    await sleep(700);
    assert.equal(expanded(), "true");
    pass("the list's own expand (Option+Command+L) takes the pane");

    press("l", { metaKey: true, altKey: true, code: "KeyL" });
    await sleep(700);
    assert.equal(expanded(), "false");
    pass("and gives it back");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the mounted walk failed:", err);
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
