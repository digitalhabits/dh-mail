/**
 * What the line above a message still has to say.
 *
 * The reader used to head every message with the sender, the address, the time
 * and everybody it went to. In a two-person thread that is the same words over
 * and over, and the screen already says them. The line now appears only when
 * it says something the message before it did not.
 */

import {
  audienceOf,
  messageMeta,
  messageMetaSaysNothing,
  threadAuthorship,
} from "@/lib/mail/message-meta";

import { check, suite } from "./harness.mjs";

const me = "ulrik@example.org";
const myOther = "ulrik@work.example.org";
const him = "mikkel@example.com";
const her = "ana@example.com";

const from = (sender, to, cc) => ({
  fromEmail: sender,
  toEmails: to,
  ccEmails: cc,
  own: sender === me || sender === myOther,
});

/** One writer on each side: nobody has to be named. */
const ONE_EACH = { manyOthers: false, manyOwn: false, ourAddresses: [me] };

suite(async () => {
  // --- An ordinary back-and-forth ------------------------------------------
  //
  // Two people, taking turns. Nothing changes, so nothing is said.

  const hisFirst = from(him, [me]);
  const myReply = from(me, [him]);

  check(
    "the first message of a thread says nothing",
    messageMetaSaysNothing(messageMeta(hisFirst, null, ONE_EACH)) === true
  );
  check(
    "nor does a reply to it",
    messageMetaSaysNothing(messageMeta(myReply, hisFirst, ONE_EACH)) === true
  );
  check(
    "nor does his answer to that",
    messageMetaSaysNothing(messageMeta(hisFirst, myReply, ONE_EACH)) === true
  );

  // The trap this is built to avoid. Comparing recipients alone marks every
  // turn as a change, because his message is addressed to me and mine to him.
  check(
    "taking turns is not a change of audience",
    audienceOf(hisFirst).join() === audienceOf(myReply).join()
  );

  // --- Somebody joins -------------------------------------------------------

  const withHer = messageMeta(from(me, [him, her]), hisFirst, ONE_EACH);
  check("a new address is named", withHer.added.join() === her);
  check("and nobody is said to have left", withHer.removed.length === 0);
  check("so the line appears", messageMetaSaysNothing(withHer) === false);

  // On Cc as well as on To — both reach her, and that is what matters.
  const herOnCc = messageMeta(from(me, [him], [her]), hisFirst, ONE_EACH);
  check("a Cc counts the same", herOnCc.added.join() === her);

  // --- Somebody is dropped --------------------------------------------------

  const dropped = messageMeta(from(me, [him]), from(me, [him, her]), ONE_EACH);
  check("an address left out is named", dropped.removed.join() === her);
  check("and nothing is said to be new", dropped.added.length === 0);

  // --- Who is talking -------------------------------------------------------
  //
  // With one other person, the side a bubble sits on says which of the two it
  // was. With two it cannot, and a message with no name over it is a guess.

  const twoWay = threadAuthorship([
    { fromEmail: him, own: false },
    { fromEmail: me, own: true },
    { fromEmail: him, own: false },
  ]);
  check("one other writer needs no names", twoWay.manyOthers === false);
  check("and neither does one of ours", twoWay.manyOwn === false);
  check(
    "two others do",
    threadAuthorship([
      { fromEmail: him, own: false },
      { fromEmail: her, own: false },
    ]).manyOthers === true
  );
  // The same person writing under two display names is still one person: the
  // address decides, not the name on the header.
  check(
    "case and padding do not make a second writer",
    threadAuthorship([
      { fromEmail: him, own: false },
      { fromEmail: ` ${him.toUpperCase()} `, own: false },
    ]).manyOthers === false
  );

  const group = { manyOthers: true, manyOwn: false, ourAddresses: [me] };
  check(
    "in a group thread the first message is named",
    messageMeta(hisFirst, null, group).sender === true
  );
  check(
    "and so is the next person to speak",
    messageMeta(from(her, [me, him]), hisFirst, group).sender === true
  );
  check(
    "but a second message from the same person is not",
    messageMeta(from(him, [me, her]), from(him, [me, her]), group).sender ===
      false
  );

  // --- Our own addresses ----------------------------------------------------
  //
  // A reply we sent from another of our addresses must not pass for one sent
  // from the account. Once two of ours are in a thread, the side of the
  // conversation no longer says which of them wrote.

  const bothOfMine = threadAuthorship(
    [
      { fromEmail: me, own: true },
      { fromEmail: myOther, own: true },
      { fromEmail: him, own: false },
    ],
    me
  );
  check("two of our own addresses are counted", bothOfMine.manyOwn === true);
  check("and the other side is still one person", bothOfMine.manyOthers === false);
  // The account is ours whether or not it has written in this thread yet.
  check(
    "the account counts as ours on its own",
    threadAuthorship([{ fromEmail: him, own: false }], me).ourAddresses.join() ===
      me
  );

  const alias = messageMeta(from(myOther, [him]), hisFirst, bothOfMine);
  check("a reply from our other address is named", alias.sender === true);
  // The audience counts the sender, so an alias swap looks like one address
  // joining and another leaving. Nobody joined — we answered from elsewhere.
  check("and is not also called an arrival", alias.added.length === 0);
  check("nor the old one a departure", alias.removed.length === 0);

  // Somebody who really did join is still reported alongside it.
  const aliasAndHer = messageMeta(
    from(myOther, [him, her]),
    hisFirst,
    bothOfMine
  );
  check("a real arrival survives the alias swap", aliasAndHer.added.join() === her);
  check("and the sender is still named", aliasAndHer.sender === true);

  // --- Addresses are compared, not spellings -------------------------------

  const shouted = messageMeta(
    from(me, [him.toUpperCase()]),
    from(me, [him]),
    ONE_EACH
  );
  check(
    "the same address in capitals is the same address",
    messageMetaSaysNothing(shouted) === true
  );
  const repeated = audienceOf(from(me, [him, him], [him]));
  check("and one named twice is counted once", repeated.length === 2);
});
