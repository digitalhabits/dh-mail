/**
 * A line about a mailbox names that mailbox's own server.
 *
 * An Outlook account was told "Mail cannot reach Gmail for
 * ulrik.lyngs@outlook.com". The word was baked into the string, from back
 * when Gmail was the only server there was, and the refusal toast next to
 * it said the same. The page already knew which server the mailbox
 * belongs to — two lines above the notice it picks Outlook or Gmail for
 * the Reconnect button.
 *
 * Every address here is invented.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mailSay } from "@/lib/mail/i18n-strings";

import { check, suite } from "./harness.mjs";
import { mailPageSource } from "./mail-page-source.mjs";

const MAIL = join(
  process.cwd(),
  "../../products/mail/packages/mail"
);
const src = (path) => readFileSync(join(MAIL, path), "utf8");

suite(async () => {
  const offlineOutlook = mailSay("syncOffline", {
    provider: "Outlook",
    account: "vera@outlook.example",
  });
  const offlineGmail = mailSay("syncOffline", {
    provider: "Gmail",
    account: "vera@example.com",
  });
  check(
    "an Outlook mailbox is told about Outlook",
    offlineOutlook.includes("Outlook") && !offlineOutlook.includes("Gmail"),
    offlineOutlook
  );
  check(
    "and a Gmail mailbox about Gmail",
    offlineGmail.includes("Gmail") && !offlineGmail.includes("Outlook"),
    offlineGmail
  );
  check(
    "each line names the mailbox it is about",
    offlineOutlook.includes("vera@outlook.example") &&
      !offlineOutlook.includes("{"),
    offlineOutlook
  );

  const refused = mailSay("actionRefused", {
    provider: "Outlook",
    kind: "archive",
    account: "vera@outlook.example",
  });
  check(
    "the refusal says which server refused",
    refused.includes("Outlook") && !refused.includes("Gmail"),
    refused
  );

  /*
    The guard. A string that takes a mailbox must not name one server: the
    mailbox decides which. Outlook may be named where Outlook is the
    destination and not the mailbox's server — the hand-over says where the
    draft went, and that is Outlook whoever the mailbox belongs to.
  */
  // The words, one file per language.
  const strings = src("lib/mail/i18n-en.ts") + "\n" + src("lib/mail/i18n-da.ts");
  const HANDOVER = ["draftIsInOutlookFrom", "openInOutlookFrom"];
  const baked = strings
    .split("\n")
    .filter(
      (line) =>
        line.includes("{account}") &&
        /\b(Gmail|Outlook)\b/.test(line) &&
        !HANDOVER.some((key) => line.includes(`${key}:`))
    );
  check(
    "no line about a mailbox names one server outright",
    baked.length === 0,
    baked.length ? baked.map((l) => l.trim()).join(" / ") : "none"
  );

  /* Both ends pick the name from the mailbox. */
  // Whitespace collapsed: the line is what matters, not how deep it stands.
  const page = mailPageSource().replace(/\s+/g, " ");
  check(
    "the list notice picks the name from the mailbox",
    page.includes('provider: isOutlookAccount(s.account) ? "Outlook" : "Gmail",'),
    page.includes('t("syncOffline"') ? "drawn" : "missing"
  );
  const states = src("lib/mail/use-sync-states.ts");
  check(
    "and so does the refusal toast",
    states.includes(
      'provider: isOutlookRef.current(account) ? "Outlook" : "Gmail",'
    )
  );
  check(
    "without re-registering the worker's listeners when the set loads",
    states.includes("isOutlookRef.current = isOutlookAccount;") &&
      states.includes("}, [isOutlookAccount]);")
  );
});
