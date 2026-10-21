/**
 * The page's own controls, mounted against happy-dom with invented mail.
 *
 * - A mailbox tab narrows the list to that mailbox, and All shows both.
 * - A mailbox tab dragged before another moves there.
 * - Folders opens the rail and closes it, and a conversation dragged over
 *   it opens the rail.
 * - The list's button hides the list, shows it again, and pins it when the
 *   pointer brought it out.
 * - The handle between the list and the reader changes the list's width.
 * - Sync reads the list again.
 * - The Settings menu opens from the title bar.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-page-controls.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
