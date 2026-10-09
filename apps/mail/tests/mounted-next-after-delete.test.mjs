/**
 * The thread opened after a delete is marked read.
 *
 * After a delete, an archive or a move, the next thread is opened by
 * setting the selection. It showed, and its row kept the unread dot until
 * it was clicked. This walks the hook that owns opening (use-row-opening)
 * through both roads: a click, and a selection set the way a delete sets
 * it. Then "Mark as unread" on the open thread, which must stay unread.
 *
 * Mounted as the other `mounted-` suites are, against happy-dom. The mail
 * is invented.
 *
 * The DOM globals must be in place before a component module runs. Thus
 * the walk is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-next-after-delete.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
