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

    tabFor(new RegExp(BLANK.account)).click();
    await sleep(300);
    toggle().click();
    await sleep(800);
    assert.equal(posts.length, 2, "no post for an empty responder");
    assert(
      /write|skriv/i.test(document.body.textContent || ""),
      "the wait is named"
    );
    pass("switched on with nothing written, it waits and says why");

    root.unmount();
    process.exit(0);
  } catch (err) {
    console.error("the auto-reply walk failed:", err);
    console.error("posts so far:", JSON.stringify(posts));
    process.exit(1);
  }
}

void main();
