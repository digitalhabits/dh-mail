/**
 * The walk — see mounted-next-after-delete.test.mjs.
 *
 * Every fixture is invented. No line of it was in a real mailbox.
 */

import assert from "node:assert/strict";

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { useRowOpening } from "@/components/mail/use-row-opening";

const pass = (line) => console.log(`PASS  ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Do it, and let React render and run its effects. The bundle is React's
 * production build, which has no act(). */
const act = async (fn) => {
  await fn();
  await sleep(50);
};

const ACCOUNT = "ulla@aavang.example";
const row = (threadId, subject) => ({
  account: ACCOUNT,
  threadId,
  subject,
  snippet: "",
  lastAt: "2026-03-04T10:00:00.000Z",
  unread: true,
  tab: "inbox",
});

/** What the page posts to /api/mail/read, by thread. */
const reads = [];
setMailApiTransport(async (path, init) => {
  if (path === "/api/mail/read") reads.push(JSON.parse(String(init?.body)).threadId);
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

/** The hook's hands, for the walk. */
const page = {};

function Harness() {
  const [threads, setThreads] = React.useState([
    row("t1", "Chairs for the choir evening"),
    row("t2", "The hall key"),
  ]);
  const [selected, setSelected] = React.useState(null);
  const threadsRef = React.useRef(threads);
  threadsRef.current = threads;
  const openThreadRef = React.useRef(null);
  const empty = React.useRef([]);
  const { openThread } = useRowOpening({
    listCacheKey: "test",
    threads,
    setThreads,
    threadsRef,
    viewerId: "test-viewer",
    setComposing: () => {},
    setListExpanded: () => {},
    setSelected,
    openThreadRef,
    selected,
    selectedPersonKey: null,
    selectRowWithModifier: () => false,
    clearMultiSelection: () => {},
    landOnPerson: () => {},
    screenThreadOrderRef: empty,
    personRowOrderRef: empty,
  });
  Object.assign(page, { threads, setThreads, setSelected, openThread });
  return null;
}

const unread = (id) => page.threads.find((t) => t.threadId === id)?.unread;

async function main() {
  let root;
  try {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(React.createElement(Harness)));

    await act(async () => page.openThread(page.threads[0]));
    assert.equal(unread("t1"), false, "the clicked row is read");
    // The store is told a moment later, so the thread can still see which
    // of its messages are new when it opens on the first of them.
    assert.deepEqual(reads, [], "and the store is not told at the click");
    await sleep(3200);
    assert.deepEqual(reads, ["t1"], "and the server is told once");
    pass("a click marks the thread read, once");

    // A delete: the row goes, and the next one is opened by selection.
    await act(async () => {
      page.setThreads((current) => current.filter((t) => t.threadId !== "t1"));
      page.setSelected({ account: ACCOUNT, threadId: "t2", inPeople: false });
    });
    assert.equal(unread("t2"), false, "the next row is read");
    await sleep(3200);
    assert.deepEqual(reads, ["t1", "t2"], "and the server is told");
    pass("the thread opened after a delete is marked read");

    // Mark as unread on the open thread: the selection stays.
    await act(async () => {
      page.setThreads((current) => current.map((t) => ({ ...t, unread: true })));
      page.setSelected({ account: ACCOUNT, threadId: "t2", inPeople: false });
    });
    assert.equal(unread("t2"), true, "it stays unread");
    await sleep(3200);
    assert.deepEqual(reads, ["t1", "t2"], "and nothing more is sent");
    pass("Mark as unread on the open thread stays unread");

    // Opened, and marked unread again before the store was told: it stays unread.
    await act(async () => page.openThread(page.threads.find((t) => t.threadId === "t2")));
    await act(async () => {
      page.setThreads((current) => current.map((t) => (t.threadId === "t2" ? { ...t, unread: true } : t)));
    });
    await sleep(3200);
    assert.deepEqual(reads, ["t1", "t2"], "the late word to the store is not sent");
    pass("marked unread again within the moment, the thread is not marked read behind the reader");
  } catch (err) {
    console.error("FAIL ", err?.message || err);
    process.exitCode = 1;
  } finally {
    try {
      root?.unmount();
    } catch {
      /* the page is going away anyway */
    }
  }
  process.exit(process.exitCode ?? 0);
}

void main();
