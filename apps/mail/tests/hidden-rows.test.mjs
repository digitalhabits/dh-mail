/**
 * A row the reader removed is hidden where it was, and shown where it went.
 *
 * The hide kept a removed row out of every list for a minute. A conversation
 * keeps its id when it moves, so a mail sent to Trash was hidden in Trash
 * too: for a minute it was in no folder of the app, while Outlook's own site
 * showed it in Deleted Items. It read as deleted for good.
 */

import {
  hideRow,
  newHiddenRows,
  pruneHiddenRows,
  rowIsHidden,
  unhideRow,
} from "@/lib/mail/hidden-rows";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const T = 1_000_000;
  const key = "vera@outlook.example|conv-1";

  const hidden = newHiddenRows();
  hideRow(hidden, key, "view:inbox", T + 60_000);

  check("deleted from the inbox: hidden in the inbox", rowIsHidden(hidden, key, "view:inbox", T + 1_000));
  check(
    "and shown in Trash at once, which is where it went",
    rowIsHidden(hidden, key, "view:trash", T + 1_000) === false
  );
  check(
    "and in a folder view, and in Archived",
    !rowIsHidden(hidden, key, "label:Receipts", T + 1_000) && !rowIsHidden(hidden, key, "view:archived", T + 1_000)
  );
  check(
    "back in the inbox inside the minute, it is still hidden: a late list reply cannot bring it back",
    rowIsHidden(hidden, key, "view:inbox", T + 59_000)
  );
  check("after the minute it is hidden nowhere", !rowIsHidden(hidden, key, "view:inbox", T + 60_000));

  check("another conversation is never hidden", !rowIsHidden(hidden, "vera@outlook.example|conv-2", "view:inbox", T));

  // Undo takes the hide off.
  hideRow(hidden, key, "view:inbox", T + 60_000);
  unhideRow(hidden, key);
  check("Undo shows the row again in the view it left", !rowIsHidden(hidden, key, "view:inbox", T + 1_000));

  // "Delete forever" hides in Trash, and only there.
  hideRow(hidden, key, "view:trash", T + 60_000);
  check(
    "a hide made in Trash hides in Trash",
    rowIsHidden(hidden, key, "view:trash", T + 1_000) && !rowIsHidden(hidden, key, "view:inbox", T + 1_000)
  );

  pruneHiddenRows(hidden, T + 61_000);
  check("old hides are forgotten, with their view", hidden.until.size === 0 && hidden.view.size === 0);

  // A hide with no view on record hides everywhere, as all of them once did.
  hidden.until.set(key, T + 60_000);
  check("a hide with no view hides in every view", rowIsHidden(hidden, key, "view:sent", T + 1_000));
});
