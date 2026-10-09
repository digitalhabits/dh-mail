/**
 * Which threads the list believes have a chat window open.
 *
 * The shell's window list is the truth, and it is asked when this window
 * comes to the front. Between those asks the list works from this set, so
 * what matters is that it changes only when it really differs — a new set
 * object on every check would repaint the whole list on every focus.
 */

import assert from "node:assert/strict";

import {
  believedPopoutKeys,
  getPopoutKeysSnapshot,
  notePopoutOpened,
  popoutThreadKey,
  setOpenPopoutKeys,
  subscribeMailPopouts,
} from "@/lib/mail/popout";

let notified = 0;
const stop = subscribeMailPopouts(() => notified++);

const KEY = popoutThreadKey("me@example.org", "t1");

/** Popping one out puts it in the set, and tells the list once. */
notePopoutOpened("me@example.org", "t1");
assert.equal(getPopoutKeysSnapshot().has(KEY), true);
assert.equal(notified, 1);

/** Popping the same one out again is not a change. */
notePopoutOpened("me@example.org", "t1");
assert.equal(notified, 1, "the same thread twice repainted the list");

/** The keys survive as something to check against the shell. */
assert.deepEqual(believedPopoutKeys(), [KEY]);

/** The shell agreeing is not a change either. */
setOpenPopoutKeys(new Set([KEY]));
assert.equal(notified, 1, "an unchanged answer repainted the list");

/** The shell saying the window is gone drops it, and says so. */
setOpenPopoutKeys(new Set());
assert.equal(getPopoutKeysSnapshot().has(KEY), false);
assert.equal(notified, 2);
assert.deepEqual(believedPopoutKeys(), []);

stop();
console.log("PASS  the popped-out set changes only when it differs");
