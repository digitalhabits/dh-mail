/**
 * The walk itself — see mounted-autoreply.test.mjs. Fixtures invented,
 * as every fixture here must be.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { AutoReplyDialog } from "@/components/mail/AutoReplyDialog";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const posts = [];
/** How long a save takes, and how many run at once. */
let postDelay = 0;
let inFlight = 0;
let mostInFlight = 0;
const WRITTEN = {
  account: "ulla@aavang.example",
  provider: "gmail",
  subjectSupported: true,
  enabled: false,
  subject: "Away",
  bodyHtml: "<p>Back on Monday.</p>",
  restrictToContacts: false,
  startTime: null,
  endTime: null,
  needsReconnect: false,
};
const BLANK = {
  ...WRITTEN,
  account: "tea@aavang.example",
  subject: "",
  bodyHtml: "",
};
const saved = new Map([
  [WRITTEN.account, WRITTEN],
  [BLANK.account, BLANK],
]);
setMailApiTransport(async (path, init) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (path.startsWith("/api/mail/autoreply")) {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body);
      posts.push(body);
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      await sleep(postDelay);
      inFlight -= 1;
      const next = { ...saved.get(body.account), ...body };
      saved.set(body.account, next);
      return json({ autoReply: next });
    }
    return json({ autoReplies: [...saved.values()] });
  }
  return json({});
});

const toggle = () =>
  [...document.querySelectorAll("[role=switch],input[type=checkbox]")][0];
const tabFor = (re) =>
  [...document.querySelectorAll("button")].find((b) => re.test(b.title || ""));

async function main() {
  try {
    document.body.innerHTML = '<div id="r"></div>';
    const root = createRoot(document.getElementById("r"));
    root.render(
      React.createElement(AutoReplyDialog, {
        open: true,
        onClose: () => {},
        onSaved: () => {},
      })
    );
    await sleep(600);

    // With two mailboxes the dialog opens on All, as the list does, and
    // says that the two replies differ now.
    const allTab = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "All");
    assert(allTab && allTab.getAttribute("aria-pressed") === "true", "the dialog opens on All");
    assert(/different replies/.test(document.body.textContent || ""), "the note says the replies differ");
    assert(/Auto-reply on all accounts/.test(document.body.textContent || ""));
    pass("with several mailboxes, the dialog opens on All, and says the replies differ");

    tabFor(new RegExp(WRITTEN.account)).click();
    await sleep(300);
    toggle().click();
    await sleep(800);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].enabled, true);
    assert.equal(posts[0].account, WRITTEN.account);
    assert(/Saved|Gemt/.test(document.body.textContent || ""));
    pass("the switch saves itself, and the footer says so");

    toggle().click();
    await sleep(800);
    assert.equal(posts.length, 2);
    assert.equal(posts[1].enabled, false);
    pass("and saves the way back off");

    // The same switch again, twice within the pause: lands where it began,
    // which is where the provider already stands — nothing to post.
    toggle().click();
    await sleep(50);
    toggle().click();
    await sleep(800);
    assert.equal(posts.length, 2);
    pass("a change that changes nothing posts nothing");

    // A slow server: a change made while a save is on its way waits for it
    // (KU refused two saves at once), and then the latest state goes.
    postDelay = 1000;
    toggle().click();
    await sleep(500);
    toggle().click();
    await sleep(2800);
    postDelay = 0;
    assert.equal(mostInFlight, 1, "never two saves at once");
    assert.equal(posts.length, 4);
    assert.equal(posts[3].enabled, false, "the latest state is saved last");
    pass("one save at a time, and the last change is the one that stands");

    tabFor(new RegExp(BLANK.account)).click();
    await sleep(300);
    toggle().click();
    await sleep(800);
    assert.equal(posts.length, 4, "no post for an empty responder");
    assert(
      /write|skriv/i.test(document.body.textContent || ""),
      "the wait is named"
    );
    pass("switched on with nothing written, it waits and says why");

    // All: one change sets the same whole reply on both mailboxes.
    [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "All").click();
    await sleep(300);
    const before = posts.length;
    const contactsBox = [...document.querySelectorAll("input[type=checkbox]")].find((i) => /Contacts/.test(i.parentElement?.textContent || ""));
    contactsBox.click();
    await sleep(900);
    const fresh = posts.slice(before);
    assert.deepEqual(fresh.map((p) => p.account).sort(), [BLANK.account, WRITTEN.account].sort(), JSON.stringify(fresh));
    assert(fresh.every((p) => p.bodyHtml === fresh[0].bodyHtml && p.restrictToContacts === true), "the same reply on both");
    assert(!/different replies/.test(document.body.textContent || ""), "and the note is gone");
    pass("a change on All sets the same reply on every mailbox, and the note goes");

    // Opened from Settings, it has a way back to Settings; opened from
    // anywhere else, only the cross.
    const backButton = () =>
      [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Back");
    assert(!backButton(), "no way back when nothing opened it from Settings");
    let wentBack = 0;
    root.render(
      React.createElement(AutoReplyDialog, {
        open: true,
        onClose: () => {},
        onBack: () => wentBack++,
        onSaved: () => {},
      })
    );
    await sleep(200);
    assert(/Settings/.test(backButton()?.textContent || ""), "the way back says Settings");
    backButton().click();
    assert.equal(wentBack, 1, "and goes back");
    pass("opened from Settings, the dialog goes back to Settings");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the auto-reply walk failed:", err);
    console.error("posts so far:", JSON.stringify(posts));
    process.exit(1);
  }
}

void main();
