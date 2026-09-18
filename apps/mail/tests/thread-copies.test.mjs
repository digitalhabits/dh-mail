/**
 * One row for a mail that came to two of our mailboxes — and every copy
 * behind the row when the row is acted on.
 *
 * The bug this guards: delete the row, only its own copy went, the other
 * copy took its place on the next refresh, and the reader deleted again —
 * by which time the selection had moved on to the next conversation.
 */

import assert from "node:assert/strict";

import {
  dedupeMessagesByRfcId,
  dedupeThreadsByTip,
  everyCopy,
  rowStandsFor,
  threadKey,
} from "@/lib/mail/thread-copies";

const row = (account, threadId, tipId, lastAt, extra = {}) => ({
  account,
  threadId,
  tipId,
  lastAt,
  subject: "Kassevis af kataloger",
  fromName: "Sigrid Sten",
  fromEmail: "sigrid.sten@vaerksted.example",
  snippet: "",
  unread: false,
  ...extra,
});

/** The same message in two mailboxes is one row, and the row remembers the other. */
{
  const rows = dedupeThreadsByTip([
    row("ulrik@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
    row("team@a.example", "t-b", "<m1@x>", "2026-08-16T10:00:00Z"),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].alsoIn, [
    { account: "team@a.example", threadId: "t-b" },
  ]);
}

/** Different messages are different rows, and carry no copies. */
{
  const rows = dedupeThreadsByTip([
    row("ulrik@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
    row("ulrik@a.example", "t-c", "<m2@x>", "2026-08-16T09:00:00Z"),
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].alsoIn, undefined);
  assert.equal(rows[1].alsoIn, undefined);
}

/** Three mailboxes: the newest stands, both others are behind it. */
{
  const rows = dedupeThreadsByTip([
    row("c@a.example", "t-c", "<m1@x>", "2026-08-16T09:00:00Z"),
    row("a@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
    row("b@a.example", "t-b", "<m1@x>", "2026-08-16T09:30:00Z"),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account, "a@a.example");
  assert.deepEqual(
    rows[0].alsoIn.map(threadKey).sort(),
    ["b@a.example|t-b", "c@a.example|t-c"]
  );
}

/** Deduping again — a refresh over rows already deduped — does not double the copies. */
{
  const once = dedupeThreadsByTip([
    row("ulrik@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
    row("team@a.example", "t-b", "<m1@x>", "2026-08-16T10:00:00Z"),
  ]);
  const twice = dedupeThreadsByTip([
    ...once,
    row("team@a.example", "t-b", "<m1@x>", "2026-08-16T10:00:00Z"),
  ]);
  assert.equal(twice.length, 1);
  assert.equal(twice[0].alsoIn.length, 1);
}

/** What an action on the row acts on: the row's own copy first, then the rest. */
{
  const rows = dedupeThreadsByTip([
    row("ulrik@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
    row("team@a.example", "t-b", "<m1@x>", "2026-08-16T10:00:00Z"),
  ]);
  const copies = everyCopy({ account: "ulrik@a.example", threadId: "t-a" }, rows);
  assert.deepEqual(copies, [
    { account: "ulrik@a.example", threadId: "t-a" },
    { account: "team@a.example", threadId: "t-b" },
  ]);
}

/** A thread the list has never heard of acts on itself alone. */
assert.deepEqual(
  everyCopy({ account: "x@a.example", threadId: "t-x" }, []),
  [{ account: "x@a.example", threadId: "t-x" }]
);

/** An undo record carries its own copies: everyCopy over the record alone finds them. */
{
  const record = {
    ...row("ulrik@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
    alsoIn: [{ account: "team@a.example", threadId: "t-b" }],
  };
  assert.equal(everyCopy(record, [record]).length, 2);
}

/*
 * One bubble per message, however many copies the mailbox holds.
 *
 * Cc yourself on Outlook and Exchange keeps two items — Sent Items and the
 * Inbox — with one Message-ID between them. The conversation is queried
 * across the whole mailbox, so both came back and the thread drew the
 * message twice, side by side, both as outgoing. Gmail never did this, so
 * the same account read correctly on one provider and doubled on the other.
 */
{
  const sentCopy = { id: "AAA-sent", rfcMessageId: "<cc-self@mail.example>" };
  const inboxCopy = { id: "BBB-inbox", rfcMessageId: "<cc-self@mail.example>" };
  const reply = { id: "CCC", rfcMessageId: "<reply@mail.example>" };

  const kept = dedupeMessagesByRfcId([sentCopy, inboxCopy, reply]);
  assert.deepEqual(
    kept.map((m) => m.id),
    ["AAA-sent", "CCC"],
    "the two copies of one message collapse; the reply is untouched"
  );

  // Whichever copy came first stands for it, and the order of the rest holds.
  assert.deepEqual(
    dedupeMessagesByRfcId([inboxCopy, sentCopy, reply]).map((m) => m.id),
    ["BBB-inbox", "CCC"]
  );

  // Case and padding are the provider's business, not a different message.
  assert.equal(
    dedupeMessagesByRfcId([
      { id: "a", rfcMessageId: "<Cc-Self@Mail.Example>" },
      { id: "b", rfcMessageId: " <cc-self@mail.example> " },
    ]).length,
    1
  );
}

/*
 * A message with no Message-ID stands for itself.
 *
 * Folding those together by a missing key would hide real messages — the
 * one thing worse than showing one twice.
 */
{
  const kept = dedupeMessagesByRfcId([
    { id: "one" },
    { id: "two" },
    { id: "three", rfcMessageId: "" },
  ]);
  assert.deepEqual(kept.map((m) => m.id), ["one", "two", "three"]);
}

/*
 * Which copy wins the row is a sort whose ties fall to fetch order, so
 * between two polls the same conversation's row can change key. Everything
 * that matches the open thread against the list has to survive that.
 */

/** A row stands for its own key and for every copy folded into it. */
{
  const rows = dedupeThreadsByTip([
    row("ulrik@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
    row("team@a.example", "t-b", "<m1@x>", "2026-08-16T10:00:00Z"),
  ]);
  const kept = rows[0];
  assert.equal(rowStandsFor(kept, { account: "ulrik@a.example", threadId: "t-a" }), true);
  assert.equal(rowStandsFor(kept, { account: "team@a.example", threadId: "t-b" }), true);
  assert.equal(rowStandsFor(kept, { account: "ulrik@a.example", threadId: "t-x" }), false);
}

/** An action on the copy the row is NOT standing on still takes both. */
{
  const rows = dedupeThreadsByTip([
    row("ulrik@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
    row("team@a.example", "t-b", "<m1@x>", "2026-08-16T10:00:00Z"),
  ]);
  // The reader opened the conversation when the row stood on t-a; a later
  // poll flipped the row to t-b. Deleting the open thread must reach the
  // row's copy too, or the row survives its own deletion.
  const folded = rows[0].alsoIn[0];
  const copies = everyCopy(folded, rows).map(threadKey);
  assert.deepEqual(copies.sort(), [
    "team@a.example|t-b",
    "ulrik@a.example|t-a",
  ].sort());
}

/** A thread the list has never held acts on itself alone, as before. */
{
  const rows = dedupeThreadsByTip([
    row("ulrik@a.example", "t-a", "<m1@x>", "2026-08-16T10:00:00Z"),
  ]);
  const copies = everyCopy(
    { account: "other@a.example", threadId: "t-z" },
    rows
  ).map(threadKey);
  assert.deepEqual(copies, ["other@a.example|t-z"]);
}
