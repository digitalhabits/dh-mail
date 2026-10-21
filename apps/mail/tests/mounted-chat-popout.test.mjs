/**
 * The chat window, mounted against happy-dom with invented mail.
 *
 * - It reads the thread and shows its bubbles, with the view at the end.
 * - Enter in the box sends the words to the thread.
 * - Escape puts the window away.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-chat-popout.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
