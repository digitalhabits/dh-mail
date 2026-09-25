/**
 * The mail list at its narrowest and at its widest, mounted against
 * happy-dom with invented mail. happy-dom lays nothing out, so the width
 * is the one the reader left stored.
 *
 * - Dragged down to its least width, the head of the list is New email,
 *   Sync and the folders as icons alone, and each still does what it does
 *   in the wide head: New email opens a composer, Sync reads the list.
 * - Wide enough, each row is one line: the sender in a column of its own,
 *   then the subject and snippet.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-list-widths.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
