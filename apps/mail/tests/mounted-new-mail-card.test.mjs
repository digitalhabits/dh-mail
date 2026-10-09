/**
 * The new-mail card has the three views, and keeps the draft across them.
 *
 * The card is the composer in the bottom right corner. It stands in the
 * same frame as the reply card — see `floating-card.tsx` — so it can be
 * put away, opened again, given the whole window, and brought back.
 *
 * In the pane first: the card has its three resize handles and the row
 * under it offers a signature. Then the walk writes a message, and moves
 * the card through every view. The
 * words, the recipients and the file in the strip must survive each move:
 * the card is never unmounted, only shown at another size, and a draft
 * that went missing on a change of view would be the reader's own writing.
 * Last, Send: after its count the message goes to the send route with its
 * recipient, subject, words and file.
 *
 * Mounted as the other `mounted-` suites are, against happy-dom. Every
 * name and every line is invented. No part of it was in a real mailbox.
 *
 * The DOM globals must be in place before a component module runs. Thus
 * the page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-new-mail-card.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
