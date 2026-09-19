/**
 * "Delete forever" waits, and Undo means it was never done.
 *
 * Mail that is deleted for good cannot be put back, so the request is held
 * for a few seconds. These check the three ends a held delete can have: the
 * count runs out and it runs once, the reader takes it back and it never
 * runs, or the window closes and it never runs. The last one is the opposite
 * of Send, on purpose: the mail stays in Trash.
 */

import {
  PURGE_UNDO_SECONDS,
  dropPendingPurges,
  holdPurge,
  pendingPurgeCount,
} from "@/lib/mail/pending-purge";

import { check, suite } from "./harness.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

suite(async () => {
  check(
    "the count is longer than Send's five seconds",
    PURGE_UNDO_SECONDS > 5,
    String(PURGE_UNDO_SECONDS)
  );

  {
    let ran = 0;
    const held = holdPurge(() => (ran += 1), 30);
    check("nothing runs while the count is on", ran === 0 && pendingPurgeCount() === 1);
    await wait(80);
    check("it runs once when the count ends", ran === 1 && pendingPurgeCount() === 0, String(ran));
    check("and Undo after that says it was too late", held.cancel() === false);
  }

  {
    let ran = 0;
    const held = holdPurge(() => (ran += 1), 30);
    check("Undo inside the count stops it", held.cancel() === true);
    await wait(80);
    check("and it never runs", ran === 0, String(ran));
    check("a second Undo is not a second anything", held.cancel() === false);
  }

  {
    let ran = 0;
    holdPurge(() => (ran += 1), 30);
    holdPurge(() => (ran += 1), 30);
    const dropped = dropPendingPurges();
    await wait(80);
    check(
      "a window that closes inside the count deletes nothing",
      dropped === 2 && ran === 0 && pendingPurgeCount() === 0,
      `${dropped} ${ran}`
    );
  }
});
