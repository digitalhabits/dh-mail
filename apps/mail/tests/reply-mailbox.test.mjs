/**
 * A reply goes from the mailbox the mail was sent to.
 *
 * A mail had the reader's work address in To and another of his addresses
 * in Cc. Both mailboxes held it, the list showed one row, and the reply
 * went from the mailbox whose copy the row opened: the one on Cc
 * (reported 2026-11-18). Invented addresses.
 */

import { setOwnMailIdentity } from "@/lib/own-addresses";
import { replyMailbox } from "@/lib/mail/reply-target";

import { check, suite } from "./harness.mjs";

const work = "tester@work.example";
const home = "tester@home.example";
const third = "tester@third.example";
const alias = "t.ester@dept.work.example";
const ann = "ann@partner.example";

suite(async () => {
  setOwnMailIdentity({ addresses: [work, home, third, alias] });
  const pick = (account, holders, to, cc, from = ann) => replyMailbox({ account, holders, from, to, cc });

  check("in Cc here, in To there: the reply goes from there", pick(home, [work], [work, ann], [home]) === work);
  check("in To here, in Cc there: it stays", pick(work, [home], [work], [home]) === work);
  check("both in To: the open mailbox stays", pick(home, [work], [work, home], []) === home);
  check("both in Cc: the open mailbox stays", pick(home, [work], [ann], [work, home]) === home);
  check("in neither here, in Cc there: the reply goes from there", pick(home, [work], [ann], [work]) === work);
  check("no other mailbox holds the mail: it stays", pick(home, [], [work], [home]) === home);
  check("letter case does not count", pick(home, ["Tester@Work.example"], ["TESTER@work.example"], [home]) === "Tester@Work.example");

  check("an alias in To is the one mailbox that is not named", pick(home, [work], [alias, ann], [home]) === work);
  check("an alias in Cc does not win over To", pick(home, [work], [home], [alias]) === home);
  check("an alias in Cc is equal to Cc: the open mailbox stays", pick(home, [work], [ann], [home, alias]) === home);
  check("two mailboxes not named: the alias is nobody's", pick(home, [work, third], [alias], []) === home);
  check("an address that is not the reader's is not an alias", pick(home, [work], ["someone@dept.work.example"], [home]) === home);

  // An Exchange mailbox: connected as one address, written to at another.
  const login = "abc123@dept.work.example";
  const main = "kim.example@dept.work.example";
  const addressesOf = (mailbox) => (mailbox === login ? [login, main] : []);
  const exchange = (account, holders, to, cc, from = ann) => replyMailbox({ account, holders, from, to, cc, addressesOf });
  check("the mailbox's other address in To names the mailbox", exchange(home, [login], [main, ann], [home]) === login);
  check("also with two more mailboxes that hold the mail", exchange(home, [login, third], [main], [home]) === login);
  check("its other address in Cc does not win over To", exchange(home, [login], [home], [main]) === home);
  check("open in the Exchange mailbox, its other address in To: it stays", exchange(login, [home], [main], [home]) === login);
  check("a mail sent from its other address is the reader's own", exchange(home, [login], [login], [home], main) === home);

  check("a mail the reader sent is left alone", pick(home, [work], [work], [home], home) === home);
  check("also when sent from another mailbox of his", pick(home, [work], [work], [home], third) === home);
});
