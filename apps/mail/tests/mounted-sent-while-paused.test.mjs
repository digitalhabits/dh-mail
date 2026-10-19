/**
 * Sent is fetched for a paused or hidden mailbox.
 *
 * A pause stops new mail from coming in. A tester sent a message from a
 * paused mailbox and could not see it in Sent, to check that it went
 * (2026-10-19): the list skipped the paused mailbox in every view. Sent
 * mail is not new mail, so Sent asks every mailbox. A hidden mailbox too:
 * hiding one takes the mail that comes in off the screen, not the mail
 * you sent. Renders the real list hook against a recorded API.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-sent-while-paused.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
