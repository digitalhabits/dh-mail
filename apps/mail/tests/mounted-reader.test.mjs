/**
 * The Reader, mounted against happy-dom with invented mail.
 *
 * - The Reader button shows on a long message and not on a short one, and
 *   the cutoff in Settings > Reading moves it.
 * - The button opens the Reader over the window: the sender label, the
 *   date, and the message's words.
 * - Esc and "Back to thread" close it, and focus goes back to the bubble.
 * - Reply and Forward close it and ask for the composer for that message.
 * - A forward shows the "Forwarded · …" line and the forwarded subject.
 *
 * happy-dom lays nothing out, so the walk gives each box a height from its
 * text: one line for every 50 characters.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-reader.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
