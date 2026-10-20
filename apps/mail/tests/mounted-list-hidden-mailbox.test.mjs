/**
 * A mailbox hidden from Mail leaves the All tab.
 *
 * The list is loaded for every connected mailbox, and All let every thread
 * through, so a Gmail hidden from Mail kept its threads in All while its
 * tab was greyed (2026-10-14). All means the mailboxes that are shown.
 */

import { accountPassesMailboxScope, mailSearchPlaceholder } from "@/components/mail/mail-list-state";
import { makeMailT } from "@/lib/mail/i18n-strings";
import { listIncludesHiddenMailboxes } from "@/lib/mail/account-scope";
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

  // Sent holds the hidden mailboxes' sent mail too (2026-10-19).
  const hidden = ["me@gmail.example"];
  check("in Sent, All keeps a hidden mailbox's thread", accountPassesMailboxScope("Me@gmail.example", [], shown, hidden));
  check(
    "but a tab still shows only its own mailbox",
    !accountPassesMailboxScope("me@gmail.example", ["ex@uni.example"], ["ex@uni.example", "x@y.example"], hidden)
  );
  check("the server's Sent asks hidden mailboxes", listIncludesHiddenMailboxes({ folder: "sent" }));
  check("and so does a search kept inside Sent", listIncludesHiddenMailboxes({ folder: "sent", q: "x", folderScoped: true }));
  check("a search that reaches all mail does not", !listIncludesHiddenMailboxes({ folder: "sent", q: "x" }));
  check("nor does the inbox", !listIncludesHiddenMailboxes({ folder: "inbox" }));
  check("nor a folder named by label", !listIncludesHiddenMailboxes({ folder: "sent", label: "Receipts" }));

  // The search box does not promise all mail when hidden accounts are left
  // out of a search (2026-10-20).
  const t = makeMailT("en");
  const box = (exceptHidden) => mailSearchPlaceholder({ folderName: null, customListName: null, tab: "all", t, exceptHidden });
  check("the box says all mail by default", box(false) === "Search all mail");
  check("and says which mail it leaves out", box(true) === "Search all mail (except hidden accounts)");
});
