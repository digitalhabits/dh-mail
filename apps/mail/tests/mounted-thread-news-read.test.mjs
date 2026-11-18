/**
 * The open conversation reads again when mail changes, and that read must
 * not mark the conversation read. "Mark as unread" is a change too: a read
 * that marked the conversation read put the row back to read at once.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-thread-news-read.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
