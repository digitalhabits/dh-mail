/**
 * Send in the reply window hands the message to the main window.
 *
 * The page is the reply window. The suite plays the shell and the main
 * window. Three walks:
 *
 * - the main window takes the message: the window closes at once and sends
 *   nothing, and the message that was handed over is whole
 * - an older shell does not know the command: the window sends the message
 *   itself, as before, and closes after the send
 * - the main window does not answer: after three seconds the window takes
 *   the offer back and sends the message itself, and a late claim by the
 *   main window gets nothing
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-reply-window-send.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
