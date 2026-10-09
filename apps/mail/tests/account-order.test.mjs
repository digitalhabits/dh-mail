/**
 * Dragging a mailbox heading to a new place in the rail.
 *
 * One move — put this mailbox in front of that one — and the arrangement that
 * comes out of it, which is what the rail, the chips, and the settings panel
 * all read. Neither provider can hold it, so it is kept as a preference.
 */

import assert from "node:assert/strict";

import {
  accountDropPlace,
  mergeAccountOrder,
  moveAccountBefore,
  sortAccountsByOrder,
} from "@/lib/mail/account-order";

const LIST = ["a@example.com", "b@example.com", "c@example.com"];

/** Up: in front of the first one is the top of the list. */
assert.deepEqual(moveAccountBefore(LIST, "c@example.com", "a@example.com"), [
  "c@example.com",
  "a@example.com",
  "b@example.com",
]);

/** Into the middle. */
assert.deepEqual(moveAccountBefore(LIST, "a@example.com", "c@example.com"), [
  "b@example.com",
  "a@example.com",
  "c@example.com",
]);

/** Nothing in front of it: the end of the list. */
assert.deepEqual(moveAccountBefore(LIST, "a@example.com", null), [
  "b@example.com",
  "c@example.com",
  "a@example.com",
]);

/** A drop in front of itself is a drag that thought better of it. */
assert.deepEqual(moveAccountBefore(LIST, "b@example.com", "b@example.com"), LIST);

/** The address is matched the way mail matches one. */
assert.deepEqual(moveAccountBefore(LIST, "C@Example.com", " a@example.com "), [
  "c@example.com",
  "a@example.com",
  "b@example.com",
]);

/** A mailbox nobody has heard of moves nothing. */
assert.deepEqual(moveAccountBefore(LIST, "z@example.com", "a@example.com"), LIST);
assert.deepEqual(moveAccountBefore(LIST, "a@example.com", "z@example.com"), LIST);

/** The hidden mailboxes in a provider's list keep their places. */
{
  const full = ["a@example.com", "hidden@example.com", "b@example.com"];
  assert.deepEqual(moveAccountBefore(full, "b@example.com", "a@example.com"), [
    "b@example.com",
    "a@example.com",
    "hidden@example.com",
  ]);
}

// --- The reader's arrangement ------------------------------------------------

/** No arrangement: the list is left as the host gave it. */
assert.deepEqual(sortAccountsByOrder(LIST, []), LIST);

/** An arrangement, in full. */
assert.deepEqual(
  sortAccountsByOrder(LIST, ["c@example.com", "a@example.com", "b@example.com"]),
  ["c@example.com", "a@example.com", "b@example.com"]
);

/** The addresses are matched however they are cased. */
assert.deepEqual(
  sortAccountsByOrder(
    ["A@Example.com", "b@example.com"],
    ["b@example.com", "a@example.com"]
  ),
  ["b@example.com", "A@Example.com"]
);

/** Nothing known above it: a mailbox the arrangement never named stays put. */
assert.deepEqual(
  sortAccountsByOrder(["new@example.com", "b@example.com"], ["b@example.com"]),
  ["new@example.com", "b@example.com"]
);

/** A mailbox connected since the last drag follows the one it came after. */
assert.deepEqual(
  sortAccountsByOrder(
    ["a@example.com", "new@example.com", "b@example.com"],
    ["b@example.com", "a@example.com"]
  ),
  ["b@example.com", "a@example.com", "new@example.com"]
);

/** A mailbox in the arrangement that is no longer connected is passed over. */
assert.deepEqual(
  sortAccountsByOrder(
    ["a@example.com", "b@example.com"],
    ["gone@example.com", "b@example.com", "a@example.com"]
  ),
  ["b@example.com", "a@example.com"]
);

/** Two providers, interleaved: the arrangement is the reader's to make. */
assert.deepEqual(
  sortAccountsByOrder(
    ["g1@example.com", "g2@example.com", "o1@outlook.example"],
    ["g1@example.com", "o1@outlook.example", "g2@example.com"]
  ),
  ["g1@example.com", "o1@outlook.example", "g2@example.com"]
);

// --- Reordering mailboxes without losing the All tab -------------------------

/** The settings panel moves mailboxes; the All tab keeps its place. */
assert.deepEqual(
  mergeAccountOrder(
    ["a@example.com", "all", "b@example.com", "c@example.com"],
    ["c@example.com", "b@example.com", "a@example.com"]
  ),
  ["c@example.com", "all", "b@example.com", "a@example.com"]
);

/** A mailbox the arrangement never knew is added at the end. */
assert.deepEqual(
  mergeAccountOrder(["all", "a@example.com"], ["a@example.com", "new@example.com"]),
  ["all", "a@example.com", "new@example.com"]
);

/** Nothing but mailboxes: the new order stands as given. */
assert.deepEqual(
  mergeAccountOrder(["a@example.com", "b@example.com"], ["b@example.com", "a@example.com"]),
  ["b@example.com", "a@example.com"]
);

// --- Reading a drop off the rail --------------------------------------------

/**
 * Three mailboxes, folded, each row twenty pixels tall and the first at the
 * top of the rail. The middles are at 10, 30 and 50.
 */
const SPANS = [
  { account: "a@example.com", top: 0, bottom: 20 },
  { account: "b@example.com", top: 20, bottom: 40 },
  { account: "c@example.com", top: 40, bottom: 60 },
];

/** The top of the rail is the top of the list, however far up it is read. */
assert.equal(
  accountDropPlace(LIST, SPANS, "c@example.com", 4),
  "a@example.com"
);
assert.equal(
  accountDropPlace(LIST, SPANS, "c@example.com", -40),
  "a@example.com"
);

/** Past the first middle is the space under the first mailbox. */
assert.equal(
  accountDropPlace(LIST, SPANS, "c@example.com", 12),
  "b@example.com"
);

/** Below the last middle is the end of the list, however far below. */
assert.equal(accountDropPlace(LIST, SPANS, "a@example.com", 52), null);
assert.equal(accountDropPlace(LIST, SPANS, "a@example.com", 400), null);

/** A place that changes nothing is no place: the rail draws no line. */
assert.equal(accountDropPlace(LIST, SPANS, "a@example.com", 4), undefined);
assert.equal(accountDropPlace(LIST, SPANS, "a@example.com", 12), undefined);
assert.equal(accountDropPlace(LIST, SPANS, "c@example.com", 400), undefined);

/** A rail with one mailbox has nowhere to put it. */
assert.equal(
  accountDropPlace(["a@example.com"], [SPANS[0]], "a@example.com", 400),
  undefined
);
