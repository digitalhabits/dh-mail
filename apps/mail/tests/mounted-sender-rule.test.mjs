/**
 * "Rules for <sender>" in a row's menu, and the rule dialog, drawn for real.
 *
 * - The line is not drawn for a conversation with no sender but the reader.
 * - One click on "Always archive" keeps a rule for the address, and asks
 *   for the mail already in the inbox to go too.
 * - "Always move to a folder…" and "More options…" open the dialog.
 * - The dialog: the whole domain, a folder picked from the mailbox's own
 *   folders, Save held back until a folder is picked.
 * - A sender with a rule shows it, and it can be removed.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-sender-rule.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
