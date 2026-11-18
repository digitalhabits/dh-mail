/**
 * The walk itself — see mounted-thread-news-read.test.mjs. The people here
 * are invented.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { useThreadNewsRead } from "@/components/mail/use-thread-news-read";
import { setMailApiTransport } from "@/lib/mail/api";
import { SYNC_CHANGED_WINDOW_EVENT } from "@/lib/mail/local-store";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDA = "ida.holm@aavang.example";
const THREAD = "thread-1";

const asked = [];
setMailApiTransport(async (path) => {
  asked.push(path);
  return new Response(JSON.stringify({ thread: { messages: [{ id: "m1" }] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

function Pane() {
  const [, setThread] = React.useState(null);
  useThreadNewsRead({ account: IDA, threadId: THREAD, setThread });
  return null;
}

async function walk() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(React.createElement(Pane));
  await sleep(30);
  assert.equal(asked.length, 0, "nothing is read before there is news");

  // News about another conversation is not for this one.
  window.dispatchEvent(new CustomEvent(SYNC_CHANGED_WINDOW_EVENT, { detail: { account: IDA, threadId: "thread-2" } }));
  await sleep(600);
  assert.equal(asked.length, 0, "news about another conversation reads nothing");
  pass("news about another conversation reads nothing");

  window.dispatchEvent(new CustomEvent(SYNC_CHANGED_WINDOW_EVENT, { detail: { account: IDA, threadId: THREAD } }));
  await sleep(600);
  assert.equal(asked.length, 1, "news about this conversation reads it once");
  const query = new URLSearchParams(asked[0].split("?")[1]);
  assert.equal(query.get("id"), THREAD);
  assert.equal(query.get("markRead"), "0", "the read does not mark the conversation read");
  pass("the read after news does not mark the conversation read");

  root.unmount();
  process.exit(0);
}

walk().catch((err) => {
  console.error(err);
  process.exit(1);
});
