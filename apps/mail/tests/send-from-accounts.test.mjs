/**
 * From offers every mailbox, the hidden ones too.
 *
 * Reported 2026-10-13: a mailbox hidden from the Mail tab could not be
 * picked in From. Hiding takes a mailbox's mail off the screen; it does
 * not take the address away. Every address here is invented.
 */

import { sendFromAccounts } from "@/lib/mail/account-scope";
import { check, suite } from "./harness.mjs";

suite(async () => {
  const shown = ["ana@example.org", "team@example.org"];
  const from = sendFromAccounts(shown, ["kim@example.edu"]);
  check("a hidden mailbox is in From, after the shown ones", from.join() === "ana@example.org,team@example.org,kim@example.edu", from.join());
  check("a mailbox named twice is offered once", sendFromAccounts(shown, ["Team@Example.org"]).length === 2);
  check("with none hidden, From is the shown mailboxes", sendFromAccounts(shown).join() === shown.join());
});
