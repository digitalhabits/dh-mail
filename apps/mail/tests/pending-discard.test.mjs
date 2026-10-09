/**
 * Work held back long enough for the reader to change their mind.
 *
 * Discarding a reply throws away the draft the provider is holding, and a
 * Gmail draft cannot be un-deleted. So Undo cannot put it back — it has to
 * mean the request was never sent. That only works if the hold is reliable:
 * one send per discard, none at all after an undo, and a hold that outlives
 * the composer, which is gone the moment the draft is discarded.
 */

import {
  cancelPendingDiscard,
  DISCARD_UNDO_MS,
  flushPendingDiscards,
  hasPendingDiscard,
  schedulePendingDiscard,
} from "@/lib/mail/pending-discard";

import { check, suite } from "./harness.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

suite(async () => {
  check(
    "the window is long enough to read a toast and act on it",
    DISCARD_UNDO_MS >= 5_000
  );

  // --- Left alone, it sends ------------------------------------------------
  {
    let sent = 0;
    schedulePendingDiscard("a", () => sent++, 10);
    check("held, not sent yet", sent === 0 && hasPendingDiscard("a"));
    await wait(30);
    check("sent once the window closes", sent === 1);
    check("and is no longer held", hasPendingDiscard("a") === false);
  }

  // --- Taken back, it never sends -----------------------------------------
  {
    let sent = 0;
    schedulePendingDiscard("b", () => sent++, 10);
    check("undo finds something to take back", cancelPendingDiscard("b") === true);
    await wait(30);
    check("nothing was sent", sent === 0);
    check(
      "and a second undo has nothing to do",
      cancelPendingDiscard("b") === false
    );
  }

  // --- Discarding the same thread twice -----------------------------------
  //
  // Keyed by thread, so the second hold replaces the first. Two sends for one
  // draft would be one request answered with 404.
  {
    let sent = 0;
    schedulePendingDiscard("c", () => sent++, 10);
    schedulePendingDiscard("c", () => sent++, 10);
    await wait(30);
    check("one hold per thread, so one send", sent === 1);
  }

  // --- Two threads at once -------------------------------------------------
  {
    const sent = [];
    schedulePendingDiscard("d", () => sent.push("d"), 10);
    schedulePendingDiscard("e", () => sent.push("e"), 10);
    check("taking one back leaves the other", cancelPendingDiscard("d") === true);
    await wait(30);
    check("only the one left alone was sent", sent.join(",") === "e");
  }

  // --- The window closing --------------------------------------------------
  //
  // The reader has had their chance. Sending now beats losing the request,
  // which would leave a draft in Gmail that the app said it had thrown away.
  {
    let sent = 0;
    schedulePendingDiscard("f", () => sent++, 60_000);
    flushPendingDiscards();
    check("a flush sends what was waiting", sent === 1);
    check("and holds nothing after", hasPendingDiscard("f") === false);
    await wait(20);
    check("the timer does not fire again on top", sent === 1);
  }

  check("a flush with nothing waiting is harmless", (() => {
    flushPendingDiscards();
    return true;
  })());
});
