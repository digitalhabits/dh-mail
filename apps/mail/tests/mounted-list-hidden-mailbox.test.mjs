/**
 * A mailbox hidden from Mail leaves the All tab.
 *
 * The list is loaded for every connected mailbox, and All let every thread
 * through, so a Gmail hidden from Mail kept its threads in All while its
 * tab was greyed (2026-10-14). All means the mailboxes that are shown.
 */

import { accountPassesMailboxScope } from "@/components/mail/mail-list-state";
import { check, suite } from "./harness.mjs";

// What the page shows after hiding the Gmail: only the Exchange mailbox.
const shown = ["ex@uni.example"];

suite(async () => {
  check("All keeps a shown mailbox's thread", accountPassesMailboxScope("ex@uni.example", [], shown));
  check("All drops a hidden mailbox's thread", !accountPassesMailboxScope("me@gmail.example", [], shown));
  check("the address is matched without case", accountPassesMailboxScope("EX@Uni.example", [], shown));
  check("a thread with no mailbox is kept", accountPassesMailboxScope("", [], shown));
  check("before the mailboxes are read, nothing is dropped", accountPassesMailboxScope("me@gmail.example", [], []));
  check(
    "a tab still shows only its own mailbox",
    !accountPassesMailboxScope("ex@uni.example", ["me@gmail.example"], ["ex@uni.example", "me@gmail.example", "x@y.example"])
  );
});
