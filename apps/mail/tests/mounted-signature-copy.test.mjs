/**
 * The signature under the message can be changed for that message only.
 *
 * Mounted as mounted-composer-send is, against happy-dom and the transport
 * seam. The walks check that:
 *
 * - A reply and a new message show the signature as an editor, under the
 *   message.
 * - Backspace in the signature does not run the Delete shortcut.
 * - A reply with the signature as it is sends no copy, so the message is
 *   the same as before copies existed.
 * - A changed copy is kept in the draft, comes back when the thread opens
 *   again and after Undo of a send, and goes out with the send. The saved
 *   signature is not written.
 * - A new From address brings its own signature while the copy is
 *   unchanged, and a changed copy stays through a change of From.
 * - Down at the end of the message goes to the signature, and Up at the
 *   start of the signature goes back.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-signature-copy.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
