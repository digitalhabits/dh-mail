/**
 * The main window sends a message that a reply window hands to it.
 *
 * The page is the main window. The suite plays the reply window: it writes
 * an offer in the store that the windows share and sends the shell's event.
 * The page must then run the send as its own: the count with Undo at the
 * foot of the list, and the bubble in the conversation if it is open.
 *
 * The walks: a conversation that is open, and one that is not; Undo in
 * each; an offer told two times; an offer that was withdrawn; a message for
 * later; and a send that fails with no conversation on screen.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-send-handover.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
