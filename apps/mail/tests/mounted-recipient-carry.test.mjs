/**
 * A recipient carried between To, Cc and Bcc, mounted against happy-dom
 * with invented addresses.
 *
 * - A chip carried from To to Cc, from Cc to Bcc and from Bcc to To leaves
 *   the field it came from and lands in the other.
 * - A chip dropped on a field that has that address already is only taken
 *   out of where it was: nobody is on the message twice.
 * - A chip let go over its own field, or before it has moved, stays put.
 * - A chip dropped on the Bcc button, with no Bcc row shown, lands in Bcc.
 * - Escape puts a carried chip back.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-recipient-carry.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
