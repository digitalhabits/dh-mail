/**
 * The number beside a folder name while the provider catches up.
 *
 * The bug these guard: a folder that lost a conversation kept its old number.
 * A correction was held only while it was higher than the provider's, so
 * filing a mail in a folder showed at once and taking one out never did.
 */

import assert from "node:assert/strict";

import {
  applyStickyFolderCounts,
  bumpFolderCount,
  FOLDER_COUNT_STICKY_MS,
} from "@/lib/mail/folder-counts";

const NOW = 1_700_000_000_000;
const GMAIL = "you@gmail.com";
const OUTLOOK = "you@outlook.com";

const folders = () => [
  { account: GMAIL, name: "Accounting", count: 4 },
  { account: GMAIL, name: "Blocked", count: 2 },
];

const key = (account, name) => `${account}\u0000${name}`;

/** Filing one in a folder counts up. */
{
  const sticky = new Map();
  const next = bumpFolderCount(folders(), sticky, GMAIL, "Blocked", 1, NOW);
  assert.equal(next.find((f) => f.name === "Blocked").count, 3);
  assert.equal(next.find((f) => f.name === "Accounting").count, 4);
}

/** Taking one out counts down. This is what was broken. */
{
  const sticky = new Map();
  const next = bumpFolderCount(folders(), sticky, GMAIL, "Blocked", -1, NOW);
  assert.equal(next.find((f) => f.name === "Blocked").count, 1);
}

/** And it stays down while the provider still says the old number. */
{
  const sticky = new Map();
  bumpFolderCount(folders(), sticky, GMAIL, "Blocked", -1, NOW);
  const shown = applyStickyFolderCounts(folders(), sticky, NOW + 1000);
  assert.equal(shown.find((f) => f.name === "Blocked").count, 1);
}

/** Once the provider agrees, its number is the one shown. */
{
  const sticky = new Map();
  bumpFolderCount(folders(), sticky, GMAIL, "Blocked", -1, NOW);
  const caughtUp = [
    { account: GMAIL, name: "Accounting", count: 4 },
    { account: GMAIL, name: "Blocked", count: 1 },
  ];
  const shown = applyStickyFolderCounts(caughtUp, sticky, NOW + 1000);
  assert.equal(shown.find((f) => f.name === "Blocked").count, 1);
  assert.equal(sticky.size, 0, "the correction is spent");
}

/** A provider number that moved for any other reason wins too. */
{
  const sticky = new Map();
  bumpFolderCount(folders(), sticky, GMAIL, "Blocked", -1, NOW);
  const newMail = [
    { account: GMAIL, name: "Accounting", count: 4 },
    { account: GMAIL, name: "Blocked", count: 7 },
  ];
  const shown = applyStickyFolderCounts(newMail, sticky, NOW + 1000);
  assert.equal(shown.find((f) => f.name === "Blocked").count, 7);
}

/** A correction cannot outlive its window, however wrong the provider is. */
{
  const sticky = new Map();
  bumpFolderCount(folders(), sticky, GMAIL, "Blocked", -1, NOW);
  const shown = applyStickyFolderCounts(
    folders(),
    sticky,
    NOW + FOLDER_COUNT_STICKY_MS + 1
  );
  assert.equal(shown.find((f) => f.name === "Blocked").count, 2);
}

/**
 * Two in a row count from the provider's number, not from our own first
 * correction — otherwise the second bump would treat 1 as what Gmail said.
 */
{
  const sticky = new Map();
  let list = bumpFolderCount(folders(), sticky, GMAIL, "Blocked", -1, NOW);
  list = bumpFolderCount(list, sticky, GMAIL, "Blocked", -1, NOW);
  assert.equal(list.find((f) => f.name === "Blocked").count, 0);
  assert.equal(sticky.get(key(GMAIL, "blocked")).serverCount, 2);
  // Gmail has not caught up with either, so both still stand.
  const shown = applyStickyFolderCounts(folders(), sticky, NOW + 1000);
  assert.equal(shown.find((f) => f.name === "Blocked").count, 0);
}

/** A count never goes below nothing. */
{
  const sticky = new Map();
  const next = bumpFolderCount(
    [{ account: GMAIL, name: "Blocked", count: 0 }],
    sticky,
    GMAIL,
    "Blocked",
    -1,
    NOW
  );
  assert.equal(next[0].count, 0);
}

/** Filing in a folder we have not listed yet adds it, in its place. */
{
  const sticky = new Map();
  const next = bumpFolderCount(folders(), sticky, GMAIL, "Bills", 1, NOW);
  assert.deepEqual(
    next.map((f) => f.name),
    ["Accounting", "Bills", "Blocked"]
  );
  assert.equal(next.find((f) => f.name === "Bills").count, 1);
}

/** Losing one from a folder we have never listed says nothing we can use. */
{
  const sticky = new Map();
  const next = bumpFolderCount(folders(), sticky, GMAIL, "Bills", -1, NOW);
  assert.deepEqual(
    next.map((f) => f.name),
    ["Accounting", "Blocked"]
  );
  assert.equal(sticky.size, 0);
}

/** Folder names match whatever their case, and whatever space is around them. */
{
  const sticky = new Map();
  const next = bumpFolderCount(folders(), sticky, GMAIL, "  blocked ", -1, NOW);
  assert.equal(next.find((f) => f.name === "Blocked").count, 1);
}

/**
 * Two mailboxes can each hold an Archive, and filing into one says nothing
 * about the other. Keyed by name alone, one correction moved both badges.
 */
{
  const sticky = new Map();
  const both = [
    { account: GMAIL, name: "Archive", count: 4 },
    { account: OUTLOOK, name: "Archive", count: 9 },
  ];
  const next = bumpFolderCount(both, sticky, GMAIL, "Archive", 1, NOW);
  assert.equal(next.find((f) => f.account === GMAIL).count, 5);
  assert.equal(
    next.find((f) => f.account === OUTLOOK).count,
    9,
    "the other mailbox's Archive is a different folder"
  );
}

/** A folder added for a mailbox that had none goes under that mailbox. */
{
  const sticky = new Map();
  const next = bumpFolderCount(folders(), sticky, OUTLOOK, "Receipts", 1, NOW);
  const added = next.find((f) => f.name === "Receipts");
  assert.equal(added.account, OUTLOOK);
  assert.deepEqual(
    next.map((f) => `${f.account}/${f.name}`),
    [
      `${GMAIL}/Accounting`,
      `${GMAIL}/Blocked`,
      `${OUTLOOK}/Receipts`,
    ],
    "sorted by mailbox first, so the rail's sections come out whole"
  );
}

console.log("folder-counts: ok");
