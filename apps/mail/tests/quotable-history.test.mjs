/**
 * What a reply or a forward can quote from its thread.
 *
 * A server files a mail by its subject when it has nothing better. So one
 * subject sent to two organisations can become one conversation, and the
 * history of a reply to one of them carried the correspondence with the
 * other. The rule checked here keeps a mail out of the history when the
 * people that the history goes to have no part in it.
 */

import { quotableHistory } from "@/lib/mail/quote-history";

import { check, suite } from "./harness.mjs";

const ME = "vera@studio.example";
const isOwn = (email) => email === ME;
const mail = (id, from, to, extra = {}) => ({
  id,
  fromEmail: from,
  toEmails: to,
  ccEmails: [],
  rfcMessageId: `<${id}@mail.example>`,
  own: from === ME,
  ...extra,
});
const ids = (list) => list.map((m) => m.id).join(" ");

suite(async () => {
  // The same subject to two organisations, filed as one conversation.
  const toFirst = mail("first", ME, ["karen@harbour.example"]);
  const firstAnswer = mail("first-answer", "karen@harbour.example", [ME]);
  const toSecond = mail("second", ME, ["jonas@quay.example"]);
  const forward = mail("forward", ME, ["frida@quay.example"]);
  const answer = mail("answer", "frida@quay.example", [ME], { inReplyTo: "<forward@mail.example>" });
  const thread = [toFirst, firstAnswer, toSecond, forward, answer];

  const reply = quotableHistory(thread, { anchor: answer, people: ["frida@quay.example"], isOwn });
  check("a reply quotes the mail it answers and the mail that one answers", ids(reply) === "forward answer");
  check("the correspondence with another organisation stays out", !reply.includes(toFirst) && !reply.includes(firstAnswer));

  const withJonas = quotableHistory(thread, {
    anchor: answer,
    people: ["frida@quay.example", "jonas@quay.example"],
    isOwn,
  });
  check("a mail that one of the recipients received is quoted", ids(withJonas) === "second forward answer");

  check(
    "a recipient's address is matched in any case",
    ids(quotableHistory(thread, { anchor: answer, people: ["Frida@Quay.Example"], isOwn })) === "forward answer"
  );

  // An ordinary conversation loses nothing.
  const a = mail("a", "karen@harbour.example", [ME]);
  const b = mail("b", ME, ["karen@harbour.example"], { inReplyTo: "<a@mail.example>" });
  const c = mail("c", "karen@harbour.example", [ME], { references: "<a@mail.example> <b@mail.example>" });
  check(
    "a conversation with one person is quoted whole",
    ids(quotableHistory([a, b, c], { anchor: c, people: ["karen@harbour.example"], isOwn })) === "a b c"
  );

  // A new person is brought in: the people already there carry the history.
  check(
    "a person who is added gets the history of the people already there",
    ids(quotableHistory([a, b, c], { anchor: c, people: ["karen@harbour.example", "new@quay.example"], isOwn })) === "a b c"
  );

  // The answered mail's own headers name its ancestors, also one that came
  // through a list address that the recipient is not named on.
  const toList = mail("to-list", "ines@harbour.example", ["all@harbour.example"]);
  const fromList = mail("from-list", "karen@harbour.example", [ME], { references: "<TO-LIST@mail.example>" });
  check(
    "a mail that the answered mail names is quoted, whoever it was sent to",
    ids(quotableHistory([toFirst, toList, fromList], { anchor: fromList, people: ["karen@harbour.example"], isOwn })) ===
      "first to-list from-list"
  );

  // The reader is on each message, so the reader's address decides nothing.
  check(
    "the reader's own address in the recipients does not bring each mail in",
    ids(quotableHistory(thread, { anchor: answer, people: ["frida@quay.example", ME], isOwn })) === "forward answer"
  );
  const alias = "vera.vinter@college.example";
  const sentAsAlias = [
    mail("x", alias, ["karen@harbour.example"], { own: true }),
    mail("y", alias, ["frida@quay.example"], { own: true }),
    mail("z", "frida@quay.example", [alias]),
  ];
  check(
    "an address that the reader sends as counts as the reader's",
    ids(quotableHistory(sentAsAlias, { anchor: sentAsAlias[2], people: ["frida@quay.example", alias], isOwn })) === "y z"
  );

  // A forward: the other people on the forwarded mail decide.
  const forwarded = quotableHistory(thread, {
    anchor: answer,
    people: [answer.fromEmail, ...answer.toEmails],
    isOwn,
  });
  check("a forward takes the earlier mails that share a person with it", ids(forwarded) === "forward answer");

  check(
    "with no other person, each message stays",
    ids(quotableHistory(thread, { anchor: answer, people: [ME], isOwn })) === "first first-answer second forward answer"
  );
});
