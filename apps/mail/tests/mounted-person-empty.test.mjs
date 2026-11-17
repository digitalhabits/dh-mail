/**
 * A person left with no conversation, for the moment after the last one is
 * archived: the pane must still draw. It once read its newest conversation
 * with none there, the page went blank, and the person's window never
 * closed. Invented addresses only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-person-empty.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
