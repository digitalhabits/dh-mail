/**
 * Offline, the list says so once, says that what the reader does is kept,
 * and says how many changes wait to be sent. Back online, the line goes.
 *
 * Two ways to be offline: the computer has no network, or it has one and
 * no mail server answers (every mailbox's sync stopped on the network).
 * Invented example data only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-offline-line.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
