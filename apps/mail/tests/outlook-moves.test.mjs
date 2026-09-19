/**
 * A mail moved in an Outlook mailbox is never in no folder.
 *
 * Graph gives a moved message a new id. The folder it left reports the old id
 * gone within seconds, and the folder it went to reports the new one up to a
 * minute later, or more when Graph's change feed lags. The copy used to drop
 * the row on the first report. A mail sent to Trash then stood in Trash for a
 * moment, vanished from every folder, and came back a minute later. To the
 * reader it had been deleted.
 */

import {
  HOLD_MS,
  forgetOutlookMoves,
  heldOutlookMoveCount,
  noteOutlookMove,
  removalsToApplyNow,
  settledOutlookMoves,
} from "@/lib/mail/outlook-moves";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const T = 1_000_000;

  // The ordinary case: the inbox speaks first, Deleted Items a minute later.
  forgetOutlookMoves();
  noteOutlookMove("old-1", "new-1", T);
  check(
    "the inbox says the old id is gone: the row stays, since this app moved it",
    removalsToApplyNow(["old-1", "stranger"], T + 10_000).join(",") === "stranger"
  );
  check(
    "other folders' changes do not release it",
    settledOutlookMoves(["something-else"], T + 20_000).length === 0 && heldOutlookMoveCount() === 1
  );
  check(
    "the new id arrives: the old row goes in the same step, so the mail is never shown twice",
    settledOutlookMoves(["x", "new-1"], T + 70_000).join(",") === "old-1" && heldOutlookMoveCount() === 0
  );
  check(
    "and a late word about the old id removes nothing that is still there",
    removalsToApplyNow(["old-1"], T + 80_000).join(",") === "old-1"
  );

  // The other order: the destination speaks first.
  forgetOutlookMoves();
  noteOutlookMove("old-2", "new-2", T);
  check(
    "the new id first: the old row goes at once",
    settledOutlookMoves(["new-2"], T + 1_000).join(",") === "old-2"
  );

  // Graph never reports the new id (or answered the move with no body).
  forgetOutlookMoves();
  noteOutlookMove("old-3", null, T);
  removalsToApplyNow(["old-3"], T + 10_000);
  check(
    "with no new id to wait for, the row is kept for the hold and no longer",
    settledOutlookMoves([], T + HOLD_MS - 1).length === 0 &&
      settledOutlookMoves([], T + HOLD_MS).join(",") === "old-3"
  );

  // The hold runs out and the source folder never said the message left.
  forgetOutlookMoves();
  noteOutlookMove("old-4", "new-4", T);
  check(
    "a row the source never reported gone is not removed by the clock",
    settledOutlookMoves([], T + HOLD_MS + 1).length === 0 && heldOutlookMoveCount() === 0
  );
  check(
    "and when the source does report it, nothing holds that back",
    removalsToApplyNow(["old-4"], T + HOLD_MS + 2).join(",") === "old-4"
  );

  // A message this app did not move is removed as before.
  forgetOutlookMoves();
  check(
    "a removal nobody here caused is applied at once",
    removalsToApplyNow(["a", "b"], T).join(",") === "a,b"
  );

  // A move that changed no id holds nothing.
  noteOutlookMove("same", "same", T);
  check("the same id on both sides is not a move to hold", heldOutlookMoveCount() === 0);
});
