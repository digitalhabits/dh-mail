/**
 * Did a draft's words already go out (lib/mail/sent-draft.ts)? A thread
 * opened on a reply that had been sent, with the old words in the composer
 * (a tester, 2026-10-05). The net: one of our own messages carrying the
 * draft's opening spends the draft. Invented mail only.
 */

import { draftWordsWentOut, wordsOf } from "@/lib/mail/sent-draft";

import { check, suite } from "./harness.mjs";

const draft =
  "<p>Kære begge</p><p><br></p><p>Tak for skemaet! To kommentarer til foråret: kan mellemtimen fra 10-11 sløjfes?</p>";
const sentText =
  "Kære begge\n\nTak for skemaet! To kommentarer til foråret: kan mellemtimen fra 10-11\nsløjfes?\n\nVenlig hilsen\nKim\n\n> On Monday someone wrote:\n> the schedule";

suite(async () => {
  check("words keep letters of any script, lower case", wordsOf("Kære  BEGGE, 10–11!") === "kære begge 10 11");
  check(
    "our sent reply carrying the draft's words spends it",
    draftWordsWentOut(draft, [{ own: true, bodyText: sentText }])
  );
  check(
    "the same words sent as HTML count too",
    draftWordsWentOut(draft, [{ own: true, bodyText: "", bodyHtml: `<div>${draft}<p>Venlig hilsen</p></div>` }])
  );
  check("somebody else's message does not count", !draftWordsWentOut(draft, [{ own: false, bodyText: sentText }]));
  check("a draft does not count as sent", !draftWordsWentOut(draft, [{ own: true, isDraft: true, bodyText: sentText }]));
  check(
    "a reply that says something else leaves the draft",
    !draftWordsWentOut(draft, [{ own: true, bodyText: "Kære begge\n\nJeg vender tilbage i morgen." }])
  );
  check(
    "too few words to tell by decide nothing",
    !draftWordsWentOut("<p>Hi Angela,</p>", [{ own: true, bodyText: "Hi Angela, thanks for lunch!" }])
  );
  check("no messages, nothing sent", !draftWordsWentOut(draft, []));
});
