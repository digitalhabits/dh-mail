/**
 * A discarded draft in the Drafts view opens the next draft.
 *
 * The inbox lands on the conversation below after a delete. The Drafts view
 * dropped to the empty pane, so a reader clearing out drafts had to click
 * each next one. These checks give the rule a list of rows and a record of
 * what it opened.
 */

import {
  draftOpensHere,
  draftsInView,
  isThreadDraftRow,
  openDraftAfter,
  openDraftRow,
  openDraftRowId,
} from "@/components/mail/draft-opening";

import { check, suite } from "./harness.mjs";

const vera = "vera@example.com";
const otto = "otto@example.com";

/** A row as the Drafts list holds it. Invented data only. */
function row(id, { origin = "here", account = vera, threadId = null } = {}) {
  return { id, origin, account, threadId, subject: `Subject ${id}`, snippet: "", to: ["a@example.org"], updatedAt: null };
}

/** Openers that write down what was asked of them. */
function recorder() {
  const calls = [];
  return {
    calls,
    open: {
      setSelected: (v) => calls.push(["select", v]),
      setSelectedPersonKey: (v) => calls.push(["person", v]),
      startCompose: (v) => calls.push(["compose", v]),
      closeCompose: () => calls.push(["close"]),
    },
  };
}

suite(async () => {
  const a = row("compose:a");
  const b = row("compose:b");
  const c = row("r1", { origin: "gmail", threadId: "t1" });
  const d = row("compose:d", { account: otto });

  // A new-message draft goes: the one below opens in the composer.
  let r = recorder();
  openDraftAfter([a, b, c], (x) => x.id === "compose:a", r.open);
  check("the draft below opens", r.calls.length === 1 && r.calls[0][0] === "compose" && r.calls[0][1].draftKey === "compose:b", r.calls);

  // The last one goes: the one above opens.
  r = recorder();
  openDraftAfter([a, b], (x) => x.id === "compose:b", r.open);
  check("at the end, the draft above opens", r.calls[0]?.[1]?.draftKey === "compose:a", r.calls);

  // The next is a reply: the composer closes and its thread opens.
  r = recorder();
  openDraftAfter([b, c], (x) => x.id === "compose:b", r.open);
  const selected = r.calls.find(([k]) => k === "select")?.[1];
  check("a reply opens its thread", selected?.threadId === "t1" && selected.account === vera, r.calls);
  check("and the composer closes before it", r.calls[0][0] === "close", r.calls);

  // The only draft goes: the pane empties.
  r = recorder();
  openDraftAfter([a], (x) => x.id === "compose:a", r.open);
  check("no draft left, nothing opens", r.calls.some(([k, v]) => k === "select" && v === null) && !r.calls.some(([k]) => k === "compose"), r.calls);

  // A thread in two rows (ours and the provider's) goes whole: neither twin opens.
  const ours = row("thread:vera:t2", { threadId: "t2" });
  const theirs = row("r2", { origin: "gmail", threadId: "t2" });
  const after = row("compose:e");
  r = recorder();
  openDraftAfter([ours, theirs, after], (x) => isThreadDraftRow(x, { account: vera, threadId: "t2" }), r.open);
  check("a thread's twin row is skipped", r.calls.find(([k]) => k === "compose")?.[1]?.draftKey === "compose:e", r.calls);

  // A reply from a mailbox that is not connected would open to an error: the
  // next draft that can open is chosen instead. A new message still opens.
  const gone = row("thread:old:t7", { account: "old@example.com", threadId: "t7" });
  const oldNew = row("compose:old", { account: "old@example.com" });
  r = recorder();
  openDraftAfter([a, gone, b], (x) => x.id === "compose:a", r.open, [vera]);
  check("a reply from a missing mailbox is skipped", r.calls[0]?.[1]?.draftKey === "compose:b", r.calls);
  check("a new message from a missing mailbox can open", draftOpensHere(oldNew, [vera]));
  check("a reply in a connected mailbox can open, whatever the case", draftOpensHere(c, ["VERA@example.com"]));
  check("without the mailboxes every row can open", draftOpensHere(gone));
  r = recorder();
  openDraftAfter([a, gone], (x) => x.id === "compose:a", r.open, [vera]);
  check("with only unopenable drafts left, the pane empties", r.calls.some(([k, v]) => k === "select" && v === null), r.calls);

  // The thread match ignores case in the address, and needs the mailbox.
  check("thread match ignores case", isThreadDraftRow(c, { account: "VERA@example.com", threadId: "t1" }));
  check("thread match needs the mailbox", !isThreadDraftRow(c, { account: otto, threadId: "t1" }));

  // The view under one mailbox keeps only its rows, in order.
  const inView = draftsInView([a, d, b], otto.toUpperCase());
  check("one mailbox's view keeps its rows", inView.length === 1 && inView[0] === d, inView);
  check("all mailboxes keep every row", draftsInView([a, d, b], null).length === 3);

  // The search box filters the drafts: every word, anywhere in the row, any case.
  const toOtto = { ...row("compose:f"), subject: "Course places", to: ["eleanor@example.org"], snippet: "Dear Eleanor" };
  const found = draftsInView([a, toOtto, d], null, "ELEANOR course");
  check("search finds a draft by its recipient and subject", found.length === 1 && found[0] === toOtto, found);
  check("every word must match", draftsInView([toOtto], null, "eleanor nobody").length === 0);
  check("an empty search keeps every row", draftsInView([a, toOtto], null, "  ").length === 2);

  // The open row: a new message by its key, a reply by its thread.
  const replyRow = row("thread:vera@example.com:t9", { threadId: "t9" });
  check("an open reply draft is marked by its thread", openDraftRowId([a, replyRow], { composeKey: null, thread: { account: vera, threadId: "t9" } }) === replyRow.id);
  check("an open new message is marked by its key", openDraftRowId([a, replyRow], { composeKey: "compose:a", thread: null }) === "compose:a");
  check("nothing open marks nothing", openDraftRowId([a, replyRow], { composeKey: null, thread: null }) === null);

  // A click opens a row as before: a provider draft with no thread opens nothing.
  r = recorder();
  openDraftRow(row("r3", { origin: "outlook" }), r.open);
  check("a provider draft with no thread opens nothing", r.calls.length === 0, r.calls);
});
