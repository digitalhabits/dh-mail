/**
 * How the list is read, mounted against happy-dom with invented mail.
 *
 * - With two mailboxes, each is asked on its own, and the rows of both
 *   are listed.
 * - When one of them fails, the list names it, and keeps the other's rows.
 * - Back in a view read before, its cached rows show while it is read again.
 * - An answer for a view the reader has left does not land in the one
 *   they are in.
 * - With one mailbox that fails on the first read, the list says so.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-two-mailboxes.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
