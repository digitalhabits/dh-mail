/**
 * A reply still goes when its thread is archived during the count.
 *
 * Send closes the composer and starts a few seconds' count, and the reader
 * goes on: the next thing they do is often to archive the thread. The pane
 * that wrote the reply is gone then. The count does not belong to it, and the
 * request was made whole when Send was pressed, so the reply must leave when
 * the count runs out — to the same people, as an answer to the same message.
 *
 * A forward is held the same way, and goes the same way.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-send-outlives-archive.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
