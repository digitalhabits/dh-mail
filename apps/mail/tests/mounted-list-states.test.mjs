/**
 * What the mail list shows when it has no rows of mail to show, and its
 * Drafts view, mounted against happy-dom with invented mail.
 *
 * - With no mailbox connected, it says how to connect one.
 * - With a mailbox and no mail, it says so.
 * - In Drafts, it lists the drafts the provider holds.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-list-states.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
