/**
 * The walk itself — see mounted-paused-snooze-wake.test.mjs.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { usePausedSnoozeWakes } from "@/components/mail/use-paused-snooze-wakes";
import { setMailApiTransport } from "@/lib/mail/api";
import { MAIL_LAST_LIVE_READ_KEY } from "@/lib/mail/storage-keys";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ME = "vera@mail.test";

const row = (threadId, lastAt, snoozedUntil) => ({
  account: ME,
  threadId,
  subject: `Subject ${threadId}`,
  fromName: "Ann Sender",
  fromEmail: "ann@sender.test",
  snippet: "",
  lastAt: new Date(lastAt).toISOString(),
  unread: false,
  messageCount: 1,
  tab: "people",
  ...(snoozedUntil ? { snoozedUntil: new Date(snoozedUntil).toISOString() } : {}),
});

const asked = [];
let answer = [];
setMailApiTransport(async (path) => {
  asked.push(path);
  return new Response(JSON.stringify({ success: true, threads: answer }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

let shown = [];
function Inbox({ pauseState }) {
  const [threads, setThreads] = React.useState([row("a", Date.now() - 60_000)]);
  shown = threads;
  usePausedSnoozeWakes({
    inboxShown: true,
    listEmails: [ME],
    pauseState,
    setThreads,
    viewerId: "viewer",
    listCacheKey: "inbox",
  });
  return null;
}

async function main() {
  const lastRead = Date.now() - 10 * 60_000;
  window.localStorage.setItem(MAIL_LAST_LIVE_READ_KEY, JSON.stringify({ [ME]: lastRead }));
  const now = Date.now();
  answer = [
    // Woke after the last read of the inbox: missing from the list on screen.
    row("earlier", now - 3 * 60 * 60_000, now - 60_000),
    // Wakes in a moment.
    row("soon", now - 2 * 60 * 60_000, now + 150),
    // Wakes tomorrow.
    row("tomorrow", now - 60 * 60_000, now + 86_400_000),
  ];

  document.body.innerHTML = '<div id="r"></div>';
  const root = createRoot(document.getElementById("r"));
  try {
    const paused = { pausedUntil: Date.now() + 60 * 60_000, quietHours: [] };
    root.render(React.createElement(Inbox, { pauseState: paused }));
    await sleep(60);
    const since = new URL(asked[0], "http://x").searchParams.get("since");
    assert.equal(since, new Date(lastRead).toISOString(), "the snoozes are read back to the last live read");
    pass("the snoozes are read back to the last live read of the inbox");
    assert.deepEqual(shown.map((t) => t.threadId).sort(), ["a", "earlier"]);
    assert.equal(shown.find((t) => t.threadId === "earlier").snoozedUntil, undefined);
    pass("a snooze that woke since then is back in the paused inbox at once");

    await sleep(300);
    assert.ok(shown.some((t) => t.threadId === "soon"), "the next snooze comes back when it wakes");
    assert.ok(!shown.some((t) => t.threadId === "tomorrow"), "a snooze still asleep stays away");
    pass("the next snooze comes back on time, and one still asleep stays away");

    root.render(null);
    asked.length = 0;
    root.render(React.createElement(Inbox, { pauseState: { quietHours: [] } }));
    await sleep(60);
    assert.equal(asked.length, 0, "an inbox that is not paused reads its own list");
    pass("a mailbox that is not paused asks nothing of this");
  } finally {
    root.unmount();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
