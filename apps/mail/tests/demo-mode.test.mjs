/**
 * The invented mailbox.
 *
 * Demo mode swaps the transport, so the interface is the real one and only
 * the answers are made up. These checks are about the two things that would
 * embarrass us: an answer the interface cannot read, and a real address in
 * a picture meant for a website.
 */

import { handleDemoMailApi } from "../src/demo/transport";
import {
  DEMO_ACCOUNT,
  DEMO_SECOND_ACCOUNT,
  demoThreadDetail,
  demoThreads,
} from "../src/demo/data";
import { check, suite } from "./harness.mjs";

const json = async (path) => (await handleDemoMailApi(path)).json();

suite(async () => {
  // ---- Nothing real -------------------------------------------------------
  //
  // A name can always coincide with somebody; an address cannot, if it is on
  // a domain nobody may register. RFC 2606 reserves `.example` for exactly
  // this. These pictures get published, so the guarantee is worth enforcing
  // rather than remembering.
  const everything = JSON.stringify([
    demoThreads(),
    demoThreadDetail("t-harbour"),
    demoThreadDetail("t-catalogue"),
    DEMO_ACCOUNT,
    DEMO_SECOND_ACCOUNT,
  ]);
  const addresses = [...everything.matchAll(/[\w.+-]+@[\w.-]+/g)].map((m) => m[0]);
  const offenders = addresses.filter((a) => !a.toLowerCase().endsWith(".example"));
  check(
    "every address in the demo is on the reserved .example domain",
    offenders.length === 0,
    offenders.slice(0, 3).join(", ")
  );
  check("and there are addresses to check", addresses.length > 20, addresses.length);

  // The other half of the promise: names that announce themselves as made up.
  //
  // Every one alliterates — Anton Asmund, Benny Björg, Caroline Citron — and
  // that is the rule, not a coincidence to be admired. A name that merely
  // sounds plausible always belongs to somebody somewhere; a cast that runs
  // down the alphabet in matching initials belongs to nobody, and reads as
  // the joke it is in a published picture.
  const initial = (word) =>
    word
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z]/g, "")
      .charAt(0)
      .toLowerCase();
  const alliterates = (name) => {
    const words = name.split(/\s+/).filter((w) => /[a-zA-ZäöåøæÄÖÅØÆ]/.test(w));
    return words.length >= 2 && initial(words[0]) === initial(words[words.length - 1]);
  };
  const people = new Set(
    demoThreads().flatMap((t) => t.messages.map((m) => m.fromName))
  );
  const offbeat = [...people].filter((n) => !alliterates(n));
  check(
    "every name alliterates, which is what says it was made up",
    offbeat.length === 0,
    offbeat.join(", ")
  );
  check(
    "and there is a cast to check, not one name",
    people.size >= 8,
    people.size
  );

  const list = await json("/api/mail/threads");
  check(
    "the list comes back with a dozen rows",
    list.success === true && Array.isArray(list.threads) && list.threads.length >= 12,
    list.threads?.length
  );
  check(
    "every row carries what the list draws",
    list.threads.every(
      (t) =>
        t.account && t.threadId && t.subject && t.fromName && t.lastAt &&
        typeof t.messageCount === "number" && Array.isArray(t.externalParticipants)
    )
  );

  const thread = await json("/api/mail/thread?id=t-harbour");
  const long = await json("/api/mail/thread?id=t-catalogue");
  check(
    "a long thread really is long, so the reader has something to scroll",
    long.thread?.messages?.length === 22,
    long.thread?.messages?.length
  );
  check(
    "and it runs over weeks rather than all at once",
    Date.parse(long.thread.messages[21].sentAt) -
      Date.parse(long.thread.messages[0].sentAt) >
      14 * 24 * 60 * 60 * 1000
  );

  check(
    "a thread opens with its messages, oldest first",
    thread.thread?.messages?.length === 4 &&
      Date.parse(thread.thread.messages[0].sentAt) <
        Date.parse(thread.thread.messages[3].sentAt)
  );
  check(
    "the newest one carries the files the list promised",
    thread.thread.messages[3].attachments?.length === 3
  );
  check(
    "a thread nobody has heard of does not throw",
    (await json("/api/mail/thread?id=nope")).error !== undefined
  );

  const accounts = await json("/api/gmail/accounts");
  check(
    "the mailbox reads as connected, so no sign-in screen appears",
    accounts.accounts?.[0]?.inMailTab === true
  );

  // ---- A path nobody thought about ----------------------------------------
  const unknown = await json("/api/mail/something-new");
  check(
    "an unknown path answers rather than failing the screen",
    unknown.success === true
  );

  check(
    "a send says plainly that it goes nowhere",
    (await json("/api/mail/send")).error === "Demo mode — nothing is sent"
  );
});
