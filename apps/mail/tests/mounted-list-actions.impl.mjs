/**
 * The walks — see mounted-list-actions.test.mjs.
 *
 * Every fixture is invented. No line of them was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { toastSink } from "sonner";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";
import { PURGE_UNDO_SECONDS } from "@/lib/mail/pending-purge";

/**
 * The drafts database, kept in a Map, as in mounted-composer-send.
 *
 * Node has no IndexedDB, and Edit as new stores its copy as a draft before
 * it opens the composer. Only the drafts database opens; every other name
 * fails to open, as all of them did before, so the thread cache behaves as
 * it does in the other mounted suites.
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

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACCOUNT = "ulla@aavang.example";

/** Four conversations, newest first, so that the list order is known. */
const row = (threadId, subject, fromName, fromEmail, lastAt, text) => ({
  summary: {
    account: ACCOUNT,
    threadId,
    subject,
    fromName,
    fromEmail,
    // Shorter than the body, so the body on screen means the thread is open.
    snippet: text.slice(0, 12),
    lastAt,
    unread: false,
    messageCount: 1,
    tab: "other",
    externalParticipants: [{ name: fromName, email: fromEmail }],
  },
  message: {
    id: `${threadId}-m1`,
    fromName,
    fromEmail,
    toEmails: [ACCOUNT],
    ccEmails: [],
    sentAt: lastAt,
    bodyText: text,
    own: false,
    rfcMessageId: `<${threadId}-m1@example.test>`,
  },
});
const ROWS = [
  row("choir-1", "Choir practice moves to Thursday", "Merle Mikkelsen",
    "merle@sangkor.example", "2026-08-20T09:12:00.000Z",
    "The hall is being painted on Tuesday."),
  row("loan-1", "Your library loan is due back", "Byens Bibliotek",
    "noreply@bibliotek.example", "2026-08-19T15:40:00.000Z",
    "One item is due on Friday."),
  row("bike-1", "The bike shed key", "Otto Brink",
    "otto@gaarden.example", "2026-08-18T11:05:00.000Z",
    "The new key hangs by the door."),
  row("garden-1", "Seeds for the shared bed", "Asta Holm",
    "asta@haveklub.example", "2026-08-17T07:30:00.000Z",
    "I have beans and too many radishes."),
  // A second one from Merle, so that her row in the people view is a person
  // with two conversations and not one that opens its thread straight away.
  row("robes-1", "Choir robes for the autumn", "Merle Mikkelsen",
    "merle@sangkor.example", "2026-08-16T16:20:00.000Z",
    "The robes are back from the cleaner."),
  // A second one from Asta, so that she has a person menu of her own. A
  // person with one conversation gets that conversation's menu instead.
  row("seedlings-1", "Seedlings for the window boxes", "Asta Holm",
    "asta@haveklub.example", "2026-08-15T12:00:00.000Z",
    "The seedlings are ready to go out."),
];
const [CHOIR, LOAN, BIKE, GARDEN] = ROWS.map((r) => r.summary);

/**
 * The server, as far as these walks need one.
 *
 * It keeps which threads are out of the inbox, so a list fetched after an
 * archive does not hold the row, and one fetched after an Undo does. Every
 * POST is written down in `posts`.
 */
const server = {
  gone: new Set(),
  posts: [],
  /** The out-of-office replies the provider holds, one per mailbox. */
  autoReplies: [],
  /** Messages the provider holds to send later, and the ones it gave up on. */
  held: [],
  /** Conversations that arrive at the next list read, not before. */
  arriving: [],
  /** Conversations in Trash, which the Trash view lists. */
  trashed: new Set(),
  /** The folders the mailbox has. */
  folders: [],
  /** POST paths that answer with a server error, for walks of a failure. */
  failing: new Set(),
  reset() {
    this.gone.clear();
    this.posts = [];
    this.autoReplies = [];
    this.held = [];
    this.arriving = [];
    this.trashed = new Set();
    this.folders = [{ account: ACCOUNT, name: "Receipts", count: 0 }];
    this.failing = new Set();
  },
  postsTo(path) {
    return this.posts.filter((p) => p.path === path).map((p) => p.body.threadId);
  },
};
const unknownPaths = new Set();
setMailApiTransport(async (path, init) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  if (p === "/api/mail/autoreply" && init?.method === "POST") {
    const body = JSON.parse(init.body);
    server.posts.push({ path: p, body });
    server.autoReplies = [
      ...server.autoReplies.filter((a) => a.account !== body.account),
      body,
    ];
    return json({ autoReply: body });
  }
  if (p === "/api/mail/scheduled") {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body);
      server.posts.push({ path: p, body });
      server.held = server.held.filter((h) => h.id !== body.id);
      return json({ ok: true });
    }
    return json({ messages: server.held });
  }
  if (init?.method === "POST" && server.failing.has(p)) {
    server.posts.push({ path: p, body: init.body ? JSON.parse(init.body) : {} });
    return new Response(JSON.stringify({ error: "The provider refused it" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (init?.method === "POST") {
    const body = init.body ? JSON.parse(init.body) : {};
    server.posts.push({ path: p, body });
    // What leaves the inbox, and what comes back to it.
    const leaves = ["/api/mail/archive", "/api/mail/trash", "/api/mail/snooze",
      "/api/mail/junk", "/api/mail/folders/move"];
    const returns = ["/api/mail/unarchive", "/api/mail/untrash",
      "/api/mail/unsnooze", "/api/mail/not-junk", "/api/mail/folders/unmove"];
    if (leaves.includes(p)) server.gone.add(body.threadId);
    if (returns.includes(p)) server.gone.delete(body.threadId);
    if (p === "/api/mail/trash") server.trashed.add(body.threadId);
    if (p === "/api/mail/untrash" || p === "/api/mail/delete-forever")
      server.trashed.delete(body.threadId);
    if (p === "/api/mail/folders/move")
      return json({ folderName: body.folderName, movedOut: true });
    return json({ ok: true });
  }
  if (p === "/api/mail/threads" && url.searchParams.get("folder") === "trash")
    return json({
      threads: ROWS.map((r) => r.summary).filter((t) => server.trashed.has(t.threadId)),
      nextCursor: null,
    });
  if (p === "/api/mail/threads")
    return json({
      threads: [...server.arriving, ...ROWS.map((r) => r.summary)].filter(
        (t) => !server.gone.has(t.threadId)
      ),
      nextCursor: null,
    });
  if (p === "/api/mail/thread") {
    const found = ROWS.find((r) => r.summary.threadId === url.searchParams.get("id"));
    if (!found) return json({});
    return json({
      thread: {
        account: ACCOUNT,
        threadId: found.summary.threadId,
        subject: found.summary.subject,
        participants: ["You", found.summary.fromName],
        messages: [found.message],
        totalMessageCount: 1,
        hasOlder: false,
        hasNewer: false,
        reply: {
          inReplyTo: found.message.rfcMessageId,
          references: found.message.rfcMessageId,
          to: [found.summary.fromEmail],
          cc: [],
          allTo: [found.summary.fromEmail],
          allCc: [],
        },
      },
    });
  }
  if (p === "/api/mail/snoozed")
    return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: server.autoReplies });
  if (p.startsWith("/api/mail/folders")) return json({ folders: server.folders });
  if (p === "/api/mail/contacts") return json({ contacts: [], sources: [] });
  if (p === "/api/mail/contact-lists") return json({ lists: [] });
  unknownPaths.add(p);
  return json({});
});

/** Every toast the page raises, newest last. */
let toasts = [];
toastSink.push = (t) => toasts.push(t);
const undoToasts = () => toasts.filter((t) => t.data?.action?.label);

const clickEl = (el, init = {}) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, ...init })
    );
  }
};
/** A key, sent from the focused element as a browser does, and up to the window. */
const press = (key, init = {}) =>
  (document.activeElement || document.body).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  );
const undoKey = () => press("z", { metaKey: true, code: "KeyZ" });

const rowEl = (t) =>
  [...document.querySelectorAll("[data-thread-key]")].find((el) =>
    (el.textContent || "").includes(t.subject)
  );
const inList = (t) => Boolean(rowEl(t));
/** The body of the open thread is on screen. */
const reading = (i) => (document.body.textContent || "").includes(ROWS[i].message.bodyText);
/** The reader's or the selection's action, not the small one on a row. */
const paneAction = (name) =>
  [...document.querySelectorAll("button")].find((b) =>
    (b.getAttribute("aria-label") || b.getAttribute("title") || "").startsWith(`${name} (`)
  );

let root = null;
async function mount({ people = false, autoReplies = [] } = {}) {
  root?.unmount();
  localStorage.clear();
  if (people) localStorage.setItem("redd-plan-mail-view-mode", "people");
  sessionStorage.clear();
  server.reset();
  server.autoReplies = autoReplies;
  toasts = [];
  draftRows.clear();
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById("root"));
  root.render(
    React.createElement(MailPage, {
      accounts: [ACCOUNT],
      viewerId: "list-actions-viewer",
      ownAddresses: [ACCOUNT],
    })
  );
  await sleep(700);
  if (people) return;
  for (const t of ROWS) assert(inList(t.summary), `${t.summary.subject} is in the list`);
}
async function open(t) {
  clickEl(rowEl(t));
  await sleep(600);
}

async function archiveThenCommandZ() {
  await mount();
  await open(CHOIR);
  assert(reading(0), "the first thread is open");
  clickEl(paneAction("Archive"));
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/archive"), ["choir-1"]);
  assert(!inList(CHOIR), "the archived row has left the list");
  assert(reading(1), "the next row opened in its place");
  pass("Archive in the reader sends the request, and the next row opens");

  undoKey();
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/unarchive"), ["choir-1"]);
  assert(inList(CHOIR), "the row is back");
  pass("Command+Z asks the server to unarchive, and the row comes back");

  undoKey();
  await sleep(300);
  assert.equal(server.postsTo("/api/mail/unarchive").length, 1, "the stack was empty");
  pass("a second Command+Z has nothing left to undo");
}

async function deleteThenCommandZ() {
  await mount();
  await open(LOAN);
  clickEl(paneAction("Delete"));
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/trash"), ["loan-1"]);
  assert(!inList(LOAN));
  assert(reading(2), "the row after it opened");
  pass("Delete in the reader sends the thread to Trash, and the next row opens");

  undoKey();
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/untrash"), ["loan-1"]);
  assert(inList(LOAN));
  pass("Command+Z takes it out of Trash again");
}

async function toastUndoTakesBackItsOwn() {
  await mount();
  await open(CHOIR);
  clickEl(paneAction("Archive"));
  await sleep(600);
  // The next row is open now: the loan.
  clickEl(paneAction("Archive"));
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/archive"), ["choir-1", "loan-1"]);
  const [first, second] = undoToasts();
  assert(first && second, "each archive raised a toast with an Undo");
  assert(first.message.includes(CHOIR.subject), `first toast: ${first.message}`);

  first.data.action.onClick();
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/unarchive"), ["choir-1"]);
  assert(inList(CHOIR) && !inList(LOAN), "only the first came back");
  pass("the Undo on an older toast takes back that archive, not the newest");

  undoKey();
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/unarchive"), ["choir-1", "loan-1"]);
  assert(inList(LOAN));
  pass("and Command+Z then takes back the one still on the stack");
}

async function arrowKeysWalkTheList() {
  await mount();
  press("ArrowDown");
  await sleep(600);
  assert(reading(0), "the first Down opens the top row");
  press("ArrowDown");
  await sleep(600);
  assert(reading(1), "the next Down opens the second");
  press("ArrowUp");
  await sleep(600);
  assert(reading(0), "Up goes back");
  press("ArrowUp");
  await sleep(300);
  assert(reading(0), "Up at the top stays there");
  pass("Down and Up open the next and the previous row");
}

async function rangeSelectionArchive() {
  await mount();
  await open(CHOIR);
  clickEl(rowEl(BIKE), { shiftKey: true });
  await sleep(400);
  assert(
    (document.body.textContent || "").includes("3 conversations selected"),
    "the selection pane counts three"
  );
  pass("a shift-click selects the range from the open row");

  clickEl(paneAction("Archive"));
  await sleep(700);
  assert.deepEqual(
    [...server.postsTo("/api/mail/archive")].sort(),
    ["bike-1", "choir-1", "loan-1"]
  );
  assert(!inList(CHOIR) && !inList(LOAN) && !inList(BIKE));
  assert(inList(GARDEN));
  assert(reading(3), "the row after the range opened");
  assert.equal(undoToasts().length, 1, "one toast for the whole selection");
  pass("Archive on the selection sends one request per thread, then opens the row after it");

  undoKey();
  await sleep(700);
  assert.deepEqual(
    [...server.postsTo("/api/mail/unarchive")].sort(),
    ["bike-1", "choir-1", "loan-1"]
  );
  assert(inList(CHOIR) && inList(LOAN) && inList(BIKE));
  pass("one Command+Z brings the whole selection back");
}

const personEl = (name) =>
  [...document.querySelectorAll("[data-person-key]")].find((el) =>
    (el.textContent || "").includes(name)
  );

async function archiveAPersonThenCommandZ() {
  await mount({ people: true });
  assert(personEl("Merle Mikkelsen"), "Merle has a row in the people view");
  clickEl(personEl("Merle Mikkelsen"));
  await sleep(600);
  const archiveAll = [...document.querySelectorAll("button")].find((b) =>
    (b.getAttribute("title") || "").startsWith(
      "Archive all 2 conversations with Merle Mikkelsen"
    )
  );
  assert(archiveAll, "the person pane offers to archive both conversations");
  clickEl(archiveAll);
  await sleep(700);
  assert.deepEqual([...server.postsTo("/api/mail/archive")].sort(), ["choir-1", "robes-1"]);
  assert(!personEl("Merle Mikkelsen"), "her row has left the list");
  assert(personEl("Otto Brink"), "the others stay");
  assert.equal(undoToasts().length, 1, "one toast for both");
  pass("Archive all in the person pane archives each of that person's threads");

  // Command+Z, not the toast: the toast's Undo worked, but nothing was put
  // on the stack, so Command+Z did nothing here.
  undoKey();
  await sleep(700);
  assert.deepEqual([...server.postsTo("/api/mail/unarchive")].sort(), ["choir-1", "robes-1"]);
  assert(personEl("Merle Mikkelsen"), "her row is back");
  pass("one Command+Z brings them all back");
}

async function commandNOpensANewMessage() {
  await mount();
  const sendButton = () =>
    [...document.querySelectorAll("button")].find((b) =>
      (b.getAttribute("title") || "").startsWith("Send (")
    );
  assert(!sendButton(), "no composer before the key");
  press("n", { metaKey: true, code: "KeyN" });
  await sleep(600);
  await sleep(600);
  assert(sendButton(), "a composer with a Send button is open");
  pass("Command+N opens a new message");
}

/** An out-of-office that is on, with no end date. */
const AWAY = {
  account: ACCOUNT,
  provider: "gmail",
  subjectSupported: true,
  enabled: true,
  subject: "Away",
  bodyHtml: "<p>Back on Monday.</p>",
  restrictToContacts: false,
  startTime: null,
  endTime: null,
  needsReconnect: false,
};

async function autoReplyLineAndManage() {
  await mount({ autoReplies: [AWAY] });
  const text = () => document.body.textContent || "";
  assert(!text().includes("Auto-reply on for"), "not read yet: the read waits");
  await sleep(2400);
  assert(text().includes("Auto-reply on for"), "the page says the auto-reply is on");
  pass("the auto-reply is read after its pause, and the page says it is on");

  const manage = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "Manage"
  );
  assert(manage, "the line offers Manage");
  clickEl(manage);
  await sleep(500);
  const toggle = document.querySelector("[role=switch],input[type=checkbox]");
  assert(toggle, "the dialog is open, with its switch");
  pass("Manage opens the auto-reply dialog");

  toggle.click();
  await sleep(900);
  const saved = server.posts.filter((x) => x.path === "/api/mail/autoreply");
  assert.equal(saved.length, 1, "the dialog saved once");
  assert.equal(saved[0].body.enabled, false);
  assert(!text().includes("Auto-reply on for"), "the line went with it");
  pass("a save in the dialog reaches the page: the line goes when the reply is off");
}

async function commandClickSelection() {
  await mount();
  await open(CHOIR);
  const says = (n) => (document.body.textContent || "").includes(`${n} conversations selected`);
  clickEl(rowEl(BIKE), { metaKey: true });
  await sleep(300);
  assert(says(2), "the open row and the clicked one");
  clickEl(rowEl(GARDEN), { metaKey: true });
  await sleep(300);
  assert(says(3), "a second Command-click adds one");
  clickEl(rowEl(BIKE), { metaKey: true });
  await sleep(300);
  assert(says(2) && !says(3), "a Command-click on a selected row takes it out");
  pass("Command-click adds a row to the selection, and takes it out again");

  press("Escape");
  await sleep(400);
  assert(!says(2), "the selection is gone");
  assert(reading(0), "and the open thread is still open under it");
  pass("Escape clears the selection and leaves the open thread");

  clickEl(rowEl(LOAN), { metaKey: true });
  await sleep(300);
  assert(says(2));
  press("Backspace");
  await sleep(700);
  assert.deepEqual([...server.postsTo("/api/mail/trash")].sort(), ["choir-1", "loan-1"]);
  assert(!inList(CHOIR) && !inList(LOAN));
  assert(reading(2), "the row after the selection opened");
  pass("Backspace deletes the selection and opens the row after it");
}

/** A reply the provider could not send, waiting in the Outbox. */
const FAILED = {
  id: "held-1",
  sendAt: "2026-08-21T08:00:00.000Z",
  account: ACCOUNT,
  threadId: "choir-1",
  toName: "Merle Mikkelsen",
  subject: "Re: Choir practice moves to Thursday",
  bodyText: "Thursday suits me.",
  to: ["merle@sangkor.example"],
  cc: [],
  status: "failed",
  error: "The server refused the message",
};

async function outboxTryAgain() {
  server.held = [];
  await mount();
  server.held = [FAILED];
  // The Outbox is read on mount and when the window gets focus.
  window.dispatchEvent(new window.Event("focus"));
  await sleep(500);
  const text = () => document.body.textContent || "";
  assert(text().includes("Outbox · 1"), "the Outbox shows the held message");
  const again = [...document.querySelectorAll("[role=button]")].find(
    (el) => (el.textContent || "").trim() === "Try again"
  );
  assert(again, "a failed message offers Try again");
  clickEl(again);
  await sleep(500);
  const sent = server.posts.filter((x) => x.path === "/api/mail/scheduled");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { account: ACCOUNT, id: "held-1", action: "sendNow" });
  assert(!text().includes("Outbox ·"), "the Outbox is read again, and is empty");
  pass("Try again on a held message sends it, and the Outbox is read again");
}

async function syncSaysWhatArrived() {
  await mount();
  const NEW = {
    ...GARDEN,
    threadId: "kettle-1",
    subject: "The kettle in the hall",
    lastAt: "2026-08-21T10:00:00.000Z",
  };
  server.arriving = [NEW];
  const sync = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === "Sync inbox"
  );
  assert(sync, "the Sync button is there");
  clickEl(sync);
  await sleep(700);
  assert(inList(NEW), "the new conversation is in the list");
  pass("Sync reads the list again, and the new conversation arrives");
  // The count was taken from the rows before the page drew the new ones, so
  // it was always zero and this toast never showed.
  assert(
    toasts.some((x) => x.kind === "success" && x.message === "1 new message"),
    "the page says one came in"
  );
  pass("and says how many came in");
}

async function windowKeys() {
  await mount();
  press("f", { metaKey: true, altKey: true, code: "KeyF" });
  await sleep(200);
  assert.equal(document.activeElement?.tagName, "INPUT", "the search field has the focus");
  document.activeElement.blur();
  pass("Option+Command+F puts the focus in the search field");

  const pressed = () =>
    [...document.querySelectorAll("button")]
      .find((b) => /restore list|expand list/i.test(b.getAttribute("title") || ""))
      ?.getAttribute("aria-pressed");
  assert.equal(pressed(), "false");
  press("l", { metaKey: true, altKey: true, code: "KeyL" });
  await sleep(500);
  assert.equal(pressed(), "true", "the list takes the pane");
  press("l", { metaKey: true, altKey: true, code: "KeyL" });
  await sleep(500);
  assert.equal(pressed(), "false", "and gives it back");
  pass("Option+Command+L expands the list and gives the pane back");

  await mount({ people: true });
  press("ArrowDown");
  await sleep(600);
  const openPerson = () =>
    [...document.querySelectorAll("button")].find((b) =>
      (b.getAttribute("title") || "").startsWith("Archive all 2 conversations with Merle")
    );
  assert(openPerson(), "the first Down opens the top person, Merle");
  press("ArrowDown");
  await sleep(600);
  assert(!openPerson(), "the next Down leaves her for the next person");
  press("ArrowUp");
  await sleep(600);
  assert(openPerson(), "Up comes back to her");
  pass("Down and Up walk the people in the people view");
}

const sendButton = () =>
  [...document.querySelectorAll("button")].find((b) =>
    (b.getAttribute("title") || "").startsWith("Send (")
  );

async function editAsNewFromTheRowMenu() {
  await mount();
  rowEl(CHOIR).dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
  );
  await sleep(300);
  const item = [...document.querySelectorAll("[role=menuitem]")].find(
    (b) => (b.textContent || "").trim() === "Edit as new"
  );
  assert(item, "the row menu offers Edit as new");
  clickEl(item);
  await sleep(900);
  const drafts = [...draftRows.values()];
  assert.equal(drafts.length, 1, "one draft was stored");
  assert.equal(drafts[0].kind, "compose");
  assert.equal(drafts[0].subject, CHOIR.subject);
  assert.deepEqual(drafts[0].toList, [], "nobody in To");
  assert(drafts[0].body.includes("The hall is being painted"), drafts[0].body);
  assert(sendButton(), "a composer is open on it");
  pass("Edit as new stores a copy with no recipients and opens a composer on it");
}

async function forwardFromAChatPopout() {
  await mount();
  const request = JSON.stringify({
    account: ACCOUNT,
    threadId: "bike-1",
    messageId: "bike-1-m1",
    at: Date.now(),
  });
  window.dispatchEvent(
    new window.StorageEvent("storage", {
      key: "redd-plan-mail-forward-request",
      newValue: request,
    })
  );
  await sleep(1200);
  assert(reading(2), "the thread the pop-out named is open");
  // A forward's subject is the field's placeholder until it is changed.
  const fields = [...document.querySelectorAll("input, textarea")].map(
    (f) => f.getAttribute("placeholder") || ""
  );
  assert(
    fields.includes(`Fwd: ${BIKE.subject}`),
    `a forward is being written: ${JSON.stringify(fields)}`
  );
  pass("A forward asked for from a chat pop-out opens the thread and a forward");
}

async function editAsNewFromAChatPopout() {
  await mount();
  window.dispatchEvent(
    new window.StorageEvent("storage", {
      key: "redd-plan-mail-edit-as-new-request",
      newValue: JSON.stringify({
        account: ACCOUNT,
        threadId: "bike-1",
        messageId: "bike-1-m1",
        at: Date.now(),
      }),
    })
  );
  await sleep(900);
  const drafts = [...draftRows.values()];
  assert.equal(drafts.length, 1, "one draft was stored");
  assert.equal(drafts[0].subject, BIKE.subject, "a copy of the message named");
  assert(sendButton(), "a composer is open on it");
  pass("Edit as new asked for from a chat pop-out opens a composer on a copy");
}

const typeInto = (el, value) => {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const personOrder = () =>
  [...document.querySelectorAll("[data-person-key]")].map((el) =>
    ROWS.map((r) => r.summary.fromName).find((n) => (el.textContent || "").includes(n))
  );
const personMenu = async (name) => {
  personEl(name).dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })
  );
  await sleep(300);
};
const menuItem = (label) =>
  [...document.querySelectorAll("[role=menuitem]")].find(
    (b) => (b.textContent || "").trim() === label
  );

async function personMenuAndSearch() {
  await mount({ people: true });
  assert.notEqual(personOrder()[0], "Asta Holm", "Asta is not first to begin with");
  await personMenu("Asta Holm");
  assert(menuItem("Pin to the top"), "the person menu offers a pin");
  clickEl(menuItem("Pin to the top"));
  await sleep(500);
  assert.equal(personOrder()[0], "Asta Holm", "Asta moved to the top");
  // Above the day headings, not only first under them.
  const heading = [...document.querySelectorAll("p")].find(
    (el) => (el.textContent || "").trim() === "Earlier"
  );
  assert(heading, "the rest stand under a day heading");
  assert(
    personEl("Asta Holm").compareDocumentPosition(heading) &
      window.Node.DOCUMENT_POSITION_FOLLOWING,
    "the pinned person stands above the day headings"
  );
  assert(toasts.some((x) => x.message === "Asta Holm pinned to the top"));
  await personMenu("Asta Holm");
  clickEl(menuItem("Unpin"));
  await sleep(500);
  assert.notEqual(personOrder()[0], "Asta Holm", "and back among the rest");
  pass("the person menu pins a person to the top, and unpins");

  await personMenu("Asta Holm");
  clickEl(menuItem("Snooze…"));
  await sleep(500);
  assert(
    (document.body.textContent || "").includes("Tomorrow"),
    "the snooze times are up"
  );
  // The picker hangs from a one-pixel anchor where the menu was.
  const anchors = () => document.querySelectorAll("span.fixed.h-px.w-px").length;
  assert.equal(anchors(), 1, "the times hang from the menu's place");
  press("Escape");
  await sleep(300);
  assert(!(document.body.textContent || "").includes("Tomorrow"), "Escape closes them");
  assert.equal(anchors(), 0, "and the picker is gone, not only hidden");
  pass("Snooze… in the person menu opens the snooze times, and Escape takes them away");

  const field = [...document.querySelectorAll("input")].find(
    (i) => i.getAttribute("placeholder") === "Search all mail"
  );
  typeInto(field, "bibliotek");
  await sleep(200);
  assert.deepEqual(personOrder(), ["Byens Bibliotek"], "only the person the words find");
  pass("a search in the people view keeps only the people it finds");
}

const buttonNamed = (name) =>
  [...document.querySelectorAll("button")].find(
    (b) => (b.getAttribute("aria-label") || b.getAttribute("title") || "") === name
  );
const buttonWithText = (text, root = document) =>
  [...root.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === text);
const postsOf = (path) => server.posts.filter((x) => x.path === path);

async function readAndUnread() {
  await mount();
  await open(CHOIR);
  press("u", { metaKey: true, code: "KeyU" });
  await sleep(500);
  assert.deepEqual(server.postsTo("/api/mail/unread"), ["choir-1"]);
  press("u", { metaKey: true, code: "KeyU" });
  await sleep(500);
  assert.deepEqual(server.postsTo("/api/mail/read"), ["choir-1"]);
  pass("Command+U marks the open thread unread, and read again");
}

async function pinTheOpenThread() {
  await mount();
  await open(LOAN);
  const first = () =>
    ROWS.find((r) =>
      (document.querySelector("[data-thread-key]")?.textContent || "").includes(r.summary.subject)
    )?.summary.threadId;
  assert.equal(first(), "choir-1");
  press("i", { metaKey: true, shiftKey: true, code: "KeyI" });
  await sleep(500);
  assert.equal(first(), "loan-1", "the pinned thread stands first");
  assert(toasts.some((x) => x.message === "Pinned"));
  press("i", { metaKey: true, shiftKey: true, code: "KeyI" });
  await sleep(500);
  assert.equal(first(), "choir-1", "and goes back to its place");
  pass("Shift+Command+I pins the open thread to the top, and unpins it");
}

async function snoozeThenCommandZ() {
  await mount();
  await open(BIKE);
  press("k", { metaKey: true, code: "KeyK" });
  await sleep(500);
  const tomorrow = buttonWithText("Tomorrow") ??
    [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Tomorrow"));
  assert(tomorrow, "the snooze times are up");
  clickEl(tomorrow);
  await sleep(700);
  const sent = postsOf("/api/mail/snooze");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.threadId, "bike-1");
  assert(Date.parse(sent[0].body.until) > Date.now(), "a time in the future");
  assert(!inList(BIKE), "the row has left the inbox");
  assert(reading(3), "the next row opened");
  pass("Command+K and Tomorrow snooze the open thread, and the next row opens");

  undoKey();
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/unsnooze"), ["bike-1"]);
  assert(inList(BIKE));
  pass("Command+Z wakes it again");
}

async function moveToFolderAndJunk() {
  await mount();
  await open(GARDEN);
  press("m", { metaKey: true, shiftKey: true, code: "KeyM" });
  await sleep(500);
  const menu = document.querySelector("[data-mail-move-menu]");
  assert(menu, "the move menu is up");
  const receipts = [...menu.querySelectorAll("button")].find((b) =>
    (b.textContent || "").includes("Receipts")
  );
  assert(receipts, "it offers the mailbox's folder");
  clickEl(receipts);
  await sleep(700);
  const moved = postsOf("/api/mail/folders/move");
  assert.equal(moved.length, 1);
  assert.equal(moved[0].body.threadId, "garden-1");
  assert.equal(moved[0].body.folderName, "Receipts");
  assert(!inList(GARDEN), "the row has left the inbox");
  pass("Shift+Command+M moves the open thread to a folder");

  undoKey();
  await sleep(600);
  assert.deepEqual(server.postsTo("/api/mail/folders/unmove"), ["garden-1"]);
  assert(inList(GARDEN));
  pass("Command+Z moves it back");

  await open(LOAN);
  press("m", { metaKey: true, shiftKey: true, code: "KeyM" });
  await sleep(500);
  const junk = [...document.querySelector("[data-mail-move-menu]").querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "Junk"
  );
  assert(junk, "the move menu offers Junk");
  clickEl(junk);
  await sleep(700);
  assert.deepEqual(server.postsTo("/api/mail/junk"), ["loan-1"]);
  assert(!inList(LOAN));
  pass("Junk in the move menu files the thread as junk");
}

async function deleteAllForAPerson() {
  await mount({ people: true });
  clickEl(personEl("Merle Mikkelsen"));
  await sleep(600);
  const deleteAll = [...document.querySelectorAll("button")].find((b) =>
    (b.getAttribute("title") || "").startsWith("Delete all 2 conversations with Merle")
  );
  assert(deleteAll, "the person pane offers Delete all");
  clickEl(deleteAll);
  await sleep(300);
  assert.equal(postsOf("/api/mail/trash").length, 0, "nothing goes before the question");
  const confirm = [...document.querySelectorAll("button")].filter(
    (b) => (b.textContent || "").trim() === "Delete all"
  );
  assert.equal(confirm.length, 2, "the question has its own Delete all");
  clickEl(confirm[1]);
  await sleep(700);
  assert.deepEqual([...server.postsTo("/api/mail/trash")].sort(), ["choir-1", "robes-1"]);
  assert(!personEl("Merle Mikkelsen"));
  pass("Delete all for a person asks first, then sends each thread to Trash");

  undoKey();
  await sleep(700);
  assert.deepEqual([...server.postsTo("/api/mail/untrash")].sort(), ["choir-1", "robes-1"]);
  assert(personEl("Merle Mikkelsen"));
  pass("one Command+Z brings them back");
}

async function restoreAndDeleteForeverInTrash() {
  await mount();
  server.trashed = new Set(["loan-1", "bike-1"]);
  clickEl(buttonNamed("Trash"));
  await sleep(800);
  assert(inList(LOAN) && inList(BIKE), "Trash lists what is in it");
  assert(!inList(CHOIR), "and nothing else");

  await open(LOAN);
  clickEl(buttonNamed("Restore"));
  await sleep(700);
  assert.deepEqual(server.postsTo("/api/mail/untrash"), ["loan-1"]);
  assert(!inList(LOAN), "restored, it leaves Trash");
  pass("Restore in Trash takes the thread out of Trash");

  await open(BIKE);
  const forever = [...document.querySelectorAll("button")].find((b) =>
    (b.getAttribute("aria-label") || b.getAttribute("title") || "").startsWith("Delete forever")
  );
  assert(forever, "Trash offers Delete forever");
  clickEl(forever);
  await sleep(300);
  assert.equal(postsOf("/api/mail/delete-forever").length, 0, "nothing goes before the question");
  const confirmPurge = async () => {
    const confirm = document.querySelector("button.bg-red-600");
    assert(confirm, "the question is up");
    clickEl(confirm);
    await sleep(500);
  };
  /** The countdown pill the delete hands to toast.custom, newest last. */
  const pill = () => {
    const custom = toasts.filter((x) => x.kind === "custom");
    return custom[custom.length - 1]?.message();
  };
  await confirmPurge();
  assert(!inList(BIKE), "the row leaves at once");
  assert.equal(postsOf("/api/mail/delete-forever").length, 0, "but nothing is deleted yet");
  const count = pill();
  assert(count, "the count is up, with its Undo");
  count.props.onUndo();
  await sleep(500);
  assert(inList(BIKE), "Undo inside the count brings it back");
  pass("Delete forever asks first, and Undo inside the count deletes nothing");

  await open(BIKE);
  clickEl(
    [...document.querySelectorAll("button")].find((b) =>
      (b.getAttribute("aria-label") || b.getAttribute("title") || "").startsWith("Delete forever")
    )
  );
  await sleep(300);
  await confirmPurge();
  await sleep(PURGE_UNDO_SECONDS * 1000 + 500);
  assert.deepEqual(server.postsTo("/api/mail/delete-forever"), ["bike-1"]);
  assert(!inList(BIKE));
  pass("and when the count runs out, the thread is deleted");
}

async function lastThreadOfAPersonLandsOnTheNext() {
  await mount({ people: true });
  // Otto has one conversation, so his row opens it.
  clickEl(personEl("Otto Brink"));
  await sleep(600);
  assert(reading(2), "Otto's one conversation is open");
  clickEl(paneAction("Archive"));
  await sleep(800);
  assert.deepEqual(server.postsTo("/api/mail/archive"), ["bike-1"]);
  assert(!personEl("Otto Brink"), "his row has gone with it");
  const astaPane = [...document.querySelectorAll("button")].find((b) =>
    (b.getAttribute("title") || "").startsWith("Archive all 2 conversations with Asta")
  );
  assert(astaPane, "the next person, Asta, is open");
  pass("archiving a person's last conversation opens the next person");
}

async function scheduledReplyAtTheEndOfItsThread() {
  await mount();
  server.held = [
    {
      ...FAILED,
      id: "held-2",
      status: "waiting",
      error: undefined,
      sendAt: "2099-01-01T09:00:00.000Z",
      bodyText: "Count me in for Thursday.",
    },
  ];
  await open(CHOIR);
  await sleep(600);
  assert(
    (document.body.textContent || "").includes("Count me in for Thursday."),
    "the held reply stands at the end of its thread"
  );
  pass("a reply the provider is holding stands at the end of its thread");
}

/** The thread the list draws first: the pinned band stands above the rest. */
const firstRow = () =>
  ROWS.find((r) =>
    (document.querySelector("[data-thread-key]")?.textContent || "").includes(r.summary.subject)
  )?.summary.threadId;
const pinKey = () => press("i", { metaKey: true, shiftKey: true, code: "KeyI" });

async function pinnedThreadArchivedAndDeleted() {
  await mount();
  await open(LOAN);
  pinKey();
  await sleep(500);
  assert.equal(firstRow(), "loan-1", "the pinned thread stands first");
  clickEl(paneAction("Archive"));
  await sleep(700);
  assert(!inList(LOAN), "archiving takes the pin off: the band does not keep drawing it");
  undoKey();
  await sleep(700);
  assert(inList(LOAN), "Command+Z brings it back");
  assert.equal(firstRow(), "loan-1", "with its pin");
  pass("archiving a pinned thread takes the pin off, and Command+Z puts both back");

  await open(BIKE);
  pinKey();
  await sleep(500);
  clickEl(paneAction("Delete"));
  await sleep(700);
  assert(!inList(BIKE), "a pinned thread sent to Trash leaves the list");
  undoKey();
  await sleep(700);
  assert(inList(BIKE), "Command+Z takes it out of Trash");
  assert(
    [...document.querySelectorAll("[data-thread-key]")].slice(0, 2).some((el) =>
      (el.textContent || "").includes(BIKE.subject)
    ),
    "and it is pinned again"
  );
  pass("deleting a pinned thread takes the pin off, and Command+Z puts both back");
}

async function failedArchiveKeepsThePin() {
  await mount();
  server.failing.add("/api/mail/archive");
  await open(GARDEN);
  pinKey();
  await sleep(500);
  assert.equal(firstRow(), "garden-1");
  clickEl(paneAction("Archive"));
  await sleep(900);
  assert.equal(server.postsTo("/api/mail/archive").length, 1, "the archive was asked for");
  assert(inList(GARDEN), "a refused archive puts the row back");
  assert.equal(firstRow(), "garden-1", "with its pin");
  assert(toasts.some((x) => x.kind === "error"), "and says it failed");
  pass("an archive the provider refuses puts the row and its pin back");
}

async function main() {
  try {
    await archiveThenCommandZ();
    await deleteThenCommandZ();
    await toastUndoTakesBackItsOwn();
    await arrowKeysWalkTheList();
    await rangeSelectionArchive();
    await commandClickSelection();
    await archiveAPersonThenCommandZ();
    await commandNOpensANewMessage();
    await autoReplyLineAndManage();
    await outboxTryAgain();
    await syncSaysWhatArrived();
    await windowKeys();
    await editAsNewFromTheRowMenu();
    await forwardFromAChatPopout();
    await editAsNewFromAChatPopout();
    await personMenuAndSearch();
    await readAndUnread();
    await pinTheOpenThread();
    await snoozeThenCommandZ();
    await moveToFolderAndJunk();
    await deleteAllForAPerson();
    await restoreAndDeleteForeverInTrash();
    await lastThreadOfAPersonLandsOnTheNext();
    await scheduledReplyAtTheEndOfItsThread();
    await pinnedThreadArchivedAndDeleted();
    await failedArchiveKeepsThePin();
    root?.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the mounted walk failed:", err);
    if (unknownPaths.size) {
      console.error("paths the fixture transport did not know:", [...unknownPaths]);
    }
    process.exit(1);
  }
}

void main();
