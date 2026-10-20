/**
 * The walk itself — see mounted-two-mailboxes.test.mjs. Fixtures invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { MailPage } from "@/components/mail/MailPage";

import { waitFor } from "./mounted-dom.mjs";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ULLA = "ulla@aavang.example";
const TEA = "tea@aavang.example";
const row = (account, threadId, subject, lastAt) => ({
  account,
  threadId,
  subject,
  fromName: "Merle Mikkelsen",
  fromEmail: "merle@sangkor.example",
  snippet: subject,
  lastAt,
  unread: false,
  messageCount: 1,
  tab: "other",
  externalParticipants: [{ name: "Merle Mikkelsen", email: "merle@sangkor.example" }],
});
const ROWS = {
  [ULLA]: [row(ULLA, "u1", "Choir practice moves to Thursday", "2026-08-20T09:00:00.000Z")],
  [TEA]: [row(TEA, "t1", "Cakes for the choir evening", "2026-08-19T09:00:00.000Z")],
};

/** Mailboxes whose list fails, and every list read, by mailbox. */
const failing = new Set();
/** Mailboxes connected but hidden from Mail. */
const hiddenMailboxes = new Set();
const reads = [];
/** How long each folder's answer takes, by folder. */
const delayMs = {};
const SENT_ROW = row(ULLA, "s1", "Re: the hall booking", "2026-08-18T09:00:00.000Z");
setMailApiTransport(async (path) => {
  const url = new URL(path, "http://localhost:3473");
  const p = url.pathname;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (p === "/api/mail/threads") {
    const account = url.searchParams.get("account") ?? "(all)";
    const folder = url.searchParams.get("folder") ?? "inbox";
    reads.push(account);
    if (delayMs[folder]) await sleep(delayMs[folder]);
    if (failing.has(account)) return json({ error: "The mailbox did not answer" }, 500);
    if (folder === "sent") return json({ threads: [SENT_ROW], nextCursor: null });
    // Asked for no one mailbox, it answers for all; the list keeps the
    // mailboxes it has.
    return json({ threads: account === "(all)" ? Object.values(ROWS).flat() : (ROWS[account] ?? []), nextCursor: null });
  }
  // Connected mailboxes, and which are hidden from Mail (hiddenMailboxes).
  if (p === "/api/gmail/accounts") {
    return json({ accounts: [ULLA, TEA].map((email) => ({ email, inMailTab: !hiddenMailboxes.has(email) })) });
  }
  if (p === "/api/outlook/accounts") return json({ accounts: [] });
  if (p === "/api/mail/snoozed") return json(url.searchParams.get("countOnly") ? { count: 0 } : { threads: [] });
  if (p === "/api/mail/autoreply") return json({ autoReplies: [] });
  if (p.startsWith("/api/mail/folders")) return json({ folders: [] });
  return json({});
});

const clickEl = (el) => {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
};
const text = () => document.body.textContent || "";
// The notice over the list, as the app words it (mailboxUnreadable).
const UNREADABLE = (email) => `${email} could not be read`;
const byLabel = (re) => [...document.querySelectorAll("button")].find((b) => re.test(b.getAttribute("aria-label") || ""));

let mounts = 0;
async function mount(accounts, ready) {
  mounts += 1;
  window.localStorage.clear();
  // One row per thread: this walk was written for it (stacking is on by default).
  window.localStorage.setItem("redd-plan-mail-view-mode", "threads");
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById("root"));
  root.render(React.createElement(MailPage, { accounts, // Each mount its own viewer, so no mount finds another's cached list.
      viewerId: `viewer-${mounts}`, ownAddresses: accounts }));
  await waitFor(ready);
  return root;
}

async function main() {
  try {
    let root = await mount([ULLA, TEA], () => text().includes("Cakes for the choir evening") && text().includes("Choir practice moves to Thursday"));
    assert(reads.includes(ULLA) && reads.includes(TEA), `each mailbox is asked on its own: ${reads.join(", ")}`);
    assert(text().includes("Choir practice moves to Thursday"), "Ulla's row is listed");
    assert(text().includes("Cakes for the choir evening"), "and Tea's");
    pass("with two mailboxes, each is asked on its own, and the rows of both are listed");

    // The tabs' menu: hiding and pausing in one (account-hours-menu.tsx).
    const buttonWith = (re) => [...document.querySelectorAll("button")].find((b) => re.test((b.textContent || "").trim()));
    const stored = (key) => JSON.parse(window.localStorage.getItem(key) ?? "null");
    const menuItem = (re) => [...document.querySelectorAll('[role="menuitem"]')].find((b) => re.test((b.textContent || "").trim()));
    clickEl(buttonWith(/^All$/));
    await sleep(200);
    assert(text().includes("Schedule") && text().includes("Same hours for all"), `a second press on All opens its menu: ${text().slice(0, 300)}`);
    assert([...document.querySelectorAll('[role="tab"]')].map((b) => b.textContent).join("|") === "Shown in Mail|New mail arrives", "with the two schedules as tabs");
    assert(!byLabel(/^Pause receiving mail/), "and no ▾ by Sync");
    clickEl(menuItem(/^tea/));
    await sleep(200);
    assert(text().includes("When do you want to see this account in your inbox?"), "an account's row opens its schedule");
    assert(/AlwaysCurrent/.test(buttonWith(/^Always/).textContent.replace(/\s+/g, "")), "with Always as Current");
    assert(text().includes("No changes yet."), "and no changes yet");
    clickEl(buttonWith(/^Weekdays only/));
    await sleep(100);
    assert(text().includes("Not saved yet."), "a pick is not saved until Done");
    clickEl(buttonWith(/^Done$/));
    await sleep(200);
    assert.deepEqual(stored("redd-plan-mail-hide")?.accounts?.[TEA]?.hours, [{ start: "00:00", end: "00:00", days: [5, 6] }], `Done keeps Tea hidden at the weekend: ${JSON.stringify(stored("redd-plan-mail-hide"))}`);
    assert(text().includes("Same hours for all"), "and goes back to the menu");
    clickEl(buttonWith(/^Same hours for all/));
    await sleep(200);
    assert(text().includes("When do you want to see your accounts in your inbox?"), `All's page asks about every account: ${text().slice(0, 300)}`);
    clickEl(byLabel(/^Back$/));
    await sleep(200);

    // To show it early: each account can have its own words.
    clickEl(menuItem(/^To show it early/));
    await sleep(200);
    assert(text().includes("Each account can have its own"), `All's page lists each account: ${text().slice(0, 300)}`);
    clickEl(menuItem(/^tea/));
    await sleep(200);
    const slider = document.querySelector('input[type="range"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(slider, "12");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(200);
    assert.equal(stored("redd-plan-mail-hide")?.accounts?.[TEA]?.showWords, 12, `Tea has words of her own: ${JSON.stringify(stored("redd-plan-mail-hide"))}`);
    assert(stored("redd-plan-mail-hide")?.showWords == null, "and every account's are untouched");
    clickEl(byLabel(/^Back$/));
    await sleep(200);
    assert(text().includes("Type 12 words") && text().includes("Nothing to type"), "All's page shows each account's words");
    clickEl(byLabel(/^Back$/));
    await sleep(200);
    assert(text().includes("Differs per account"), "and the menu says they differ");
    pass("the words to type are each account's own, set from its row on All's page");
    pass("the All menu lists each account, and an account's schedule is the setup question");

    clickEl([...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent === "New mail arrives"));
    await sleep(100);
    clickEl(menuItem(/^ulla/));
    await sleep(200);
    assert(text().includes("When should new mail come in?"), "the new-mail schedule opens");
    assert(/SameasAllaccountsCurrent/.test(buttonWith(/^Same as All accounts/).textContent.replace(/\s+/g, "")), "following All is Current");
    clickEl(buttonWith(/^Working hours/));
    await sleep(100);
    clickEl(buttonWith(/^Done$/));
    await sleep(200);
    const pauseRow = stored("redd-plan-mail-pause")?.accounts?.[ULLA];
    assert(pauseRow?.quietHours?.length > 0, `Ulla has new-mail hours of her own: ${JSON.stringify(stored("redd-plan-mail-pause"))}`);
    pass("new mail's schedule can follow All or have hours of its own");

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(150);
    // The tab, not the folder rail's heading with the whole address.
    clickEl(buttonWith(/^ulla$/));
    await sleep(300);
    clickEl(buttonWith(/^ulla$/));
    await sleep(200);
    assert(text().includes("Hide for a while") && text().includes("Schedule"), `a second press on an account opens its menu: ${text().slice(0, 300)}`);
    assert(!text().includes("Choose a picture"), "without the picture: that is in Settings and the setup dialog now");
    assert(text().includes("Hide for a while"), "and Hide for a while, while it is shown");
    assert(menuItem(/^Until I show it$/), "with Until I show it among the times");
    // The first time offered: hidden until then, kept on this machine.
    const firstTime = [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.querySelector(".tabular-nums"));
    clickEl(firstTime);
    await sleep(300);
    assert(stored("redd-plan-mail-hide")?.accounts?.[ULLA]?.hiddenUntil > Date.now(), `a time hides Ulla until then: ${JSON.stringify(stored("redd-plan-mail-hide"))}`);
    pass("an account's menu hides it for a while");
    window.localStorage.removeItem("redd-plan-mail-hide");
    window.dispatchEvent(new Event("redd-plan-mail-hide-changed"));
    await sleep(300);

    failing.add(TEA);
    clickEl(byLabel(/^Sync/));
    await sleep(900);
    assert(text().includes("Choir practice moves to Thursday"), "Ulla's row stays");
    assert(text().includes(UNREADABLE(TEA)), `the list names the mailbox that failed: ${text().slice(0, 400)}`);
    assert(!text().includes(UNREADABLE(ULLA)), "and only that one");
    pass("when one mailbox fails, the list names it and keeps the other's rows");
    failing.clear();

    // Back to a view read before: its cached rows show at once, while the
    // new answer is still on its way.
    const view = (name) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === name);
    clickEl(view("Sent"));
    await sleep(700);
    assert(text().includes("Re: the hall booking"), "Sent shows its row");
    delayMs.inbox = 600;
    clickEl(view("Inbox"));
    await sleep(150);
    assert(text().includes("Choir practice moves to Thursday"), "back in the inbox, its cached rows show before the answer lands");
    await sleep(800);
    pass("back in a view read before, its cached rows show while it is read again");

    // An answer for a view the reader has left does not land in the one
    // they are in.
    delayMs.inbox = 700;
    clickEl(byLabel(/^Sync/));
    await sleep(100);
    delayMs.inbox = 0;
    clickEl(view("Sent"));
    await sleep(1200);
    assert(text().includes("Re: the hall booking"), "Sent shows its row");
    assert(!text().includes("Choir practice moves to Thursday"), "and the inbox's late answer does not land in it");
    pass("a late answer for a view the reader has left does not land in the one they are in");
    root.unmount();

    // The same with one mailbox, where the list is one read, not one per
    // mailbox.
    delayMs.inbox = 0;
    root = await mount([ULLA], () => text().includes("Choir practice moves to Thursday"));
    const oneView = (name) => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === name);
    assert(text().includes("Choir practice moves to Thursday"), "one mailbox: the inbox row is listed");
    delayMs.inbox = 700;
    clickEl(byLabel(/^Sync/));
    await sleep(100);
    delayMs.inbox = 0;
    clickEl(oneView("Sent"));
    await sleep(1200);
    assert(text().includes("Re: the hall booking"), "one mailbox: Sent shows its row");
    assert(!text().includes("Choir practice moves to Thursday"), "one mailbox: the inbox's late answer does not land in Sent");
    pass("with one mailbox too, a late answer does not land in the view the reader moved to");
    root.unmount();

    failing.clear();
    failing.add(ULLA);
    failing.add("(all)");
    root = await mount([ULLA], () => /did not answer|Couldn.t load/i.test(text()));
    assert(/did not answer|Couldn.t load/i.test(text()), `the list says the read failed: ${text().slice(0, 400)}`);
    pass("with one mailbox that fails on the first read, the list says so");
    root.unmount();

    // Two connected, one hidden: the mailbox row stays, with the hidden
    // one's tab in it, or nothing would be left to show it again from.
    failing.clear();
    hiddenMailboxes.add(TEA);
    root = await mount([ULLA], () => text().includes("Choir practice moves to Thursday"));
    await sleep(600);
    const allTab = () => [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "All");
    assert(allTab(), "the mailbox row shows with one of two mailboxes hidden");
    // The way to the folders stands before the mailbox tabs, and only there.
    const folderButtons = [...document.querySelectorAll("button")].filter((b) =>
      /^folders$/i.test(b.getAttribute("aria-label") || "")
    );
    assert.equal(folderButtons.length, 1, "one way to the folders");
    assert(
      folderButtons[0].compareDocumentPosition(allTab()) & Node.DOCUMENT_POSITION_FOLLOWING,
      "before the mailbox tabs"
    );
    root.unmount();
    hiddenMailboxes.clear();
    pass("with two mailboxes connected and one hidden, the mailbox row stays");

    // Both hidden: the list says they are hidden, and how to show one,
    // not "Connect an account".
    hiddenMailboxes.add(ULLA);
    hiddenMailboxes.add(TEA);
    root = await mount([], () => text().includes("hidden for now"));
    assert(!text().includes("Connect an account"), "not the connect notice");
    // Nor the reading pane's: it said "No mailbox connected yet" over hidden mailboxes.
    assert(!text().includes("No mailbox connected yet"), "not the reading pane's no-mailbox line");
    assert(text().includes(ULLA) && text().includes(TEA), "each hidden mailbox is named");
    assert(
      [...document.querySelectorAll("button")].filter((b) => (b.textContent || "").trim() === "Show in Mail now").length === 2,
      "with Show in Mail now for each"
    );
    root.unmount();
    hiddenMailboxes.clear();
    pass("with every mailbox hidden, the list says so and offers to show one");

    process.exit(0);
  } catch (err) {
    console.error("the two mailboxes walk failed:", err);
    process.exit(1);
  }
}

void main();
