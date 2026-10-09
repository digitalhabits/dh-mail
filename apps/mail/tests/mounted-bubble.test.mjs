/**
 * One message in a thread, drawn as its bubble, mounted against happy-dom
 * with invented mail.
 *
 * - The line over it names the sender when the thread's side no longer
 *   does, and who was added; our own messages are named by address.
 * - Its files show as chips under the words, and a calendar invite as a
 *   card.
 * - A message of ours on its way says "Sending"; one that failed says
 *   "Not sent", and Retry and Edit do what they say.
 *
 * Show more is not walked: it follows the message's measured height, and
 * happy-dom lays nothing out.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-bubble.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
