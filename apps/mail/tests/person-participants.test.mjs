/**
 * One person on a thread, even under two addresses.
 *
 * The list keeps both mailboxes. The person row must not: the same full
 * name twice on one thread is one correspondent, and a one-to-one
 * conversation must stay a one-to-one row.
 */

import {
  collapseSameNameParticipants,
  groupThreadsByPerson,
  threadPeople,
} from "@/lib/mail/person-participants";
import { mailerIdentityAddress } from "@/lib/mail/person-identity";

import { check, suite } from "./harness.mjs";

const me = "ulrik@example.com";
const davidCampus = "david@example.com";
const davidHome = "david@example.org";

function thread(participants, from = participants[0]) {
  return {
    account: me,
    threadId: "t-1",
    subject: "Two bits of good news",
    fromName: from?.name ?? "",
    fromEmail: from?.email ?? "",
    snippet: "",
    lastAt: "2026-08-22T10:00:00.000Z",
    unread: false,
    messageCount: 1,
    tab: "people",
    externalParticipants: participants,
  };
}

suite(async () => {
  const sameNameTwice = collapseSameNameParticipants([
    { name: "Dana Vale", email: davidCampus },
    { name: "Dana Vale", email: davidHome },
  ]);
  check(
    "the same full name under two addresses is one participant",
    sameNameTwice.length === 1 && sameNameTwice[0].email === davidCampus,
    sameNameTwice.map((p) => p.email).join(",")
  );

  const twoPeople = collapseSameNameParticipants([
    { name: "Dana Vale", email: "dana@example.com" },
    { name: "Chris Vale", email: "chris@example.org" },
  ]);
  check(
    "two different names stay two",
    twoPeople.length === 2,
    String(twoPeople.length)
  );

  const nameless = collapseSameNameParticipants([
    { name: "", email: "anon@example.com" },
    { name: "Dana Vale", email: "dana@example.com" },
  ]);
  check(
    "an entry with no name is never merged",
    nameless.length === 2 && nameless[0].email === "anon@example.com",
    nameless.map((p) => p.email).join(",")
  );

  const blankTwice = collapseSameNameParticipants([
    { name: "   ", email: "one@example.com" },
    { name: "", email: "two@example.org" },
  ]);
  check(
    "two empty names are never merged either",
    blankTwice.length === 2,
    String(blankTwice.length)
  );

  const duplicate = groupThreadsByPerson([
    thread([
      { name: "Dana Vale", email: davidCampus },
      { name: "Dana Vale", email: davidHome },
    ]),
  ]);
  check("a name twice on one thread is not a group", duplicate.length === 1);
  const row = duplicate[0];
  check(
    "it is a one-to-one row keyed on the first address",
    row &&
      row.isGroup === false &&
      row.key === `person:${davidCampus}` &&
      row.email === davidCampus &&
      row.participantCount === 1 &&
      row.people.length === 1 &&
      row.people[0].email === davidCampus,
    row ? `${row.key} ${row.people.map((p) => p.email).join(",")}` : "no row"
  );

  const group = groupThreadsByPerson([
    thread([
      { name: "Dana Vale", email: "dana@example.com" },
      { name: "Chris Vale", email: "chris@example.org" },
    ]),
  ]);
  check(
    "two different names on one thread are still a group",
    group[0]?.isGroup === true &&
      group[0].key === "group:chris@example.org,dana@example.com" &&
      group[0].participantCount === 2 &&
      group[0].people.length === 2,
    group[0]?.key ?? "no row"
  );

  const lonely = groupThreadsByPerson([
    thread([
      { name: "", email: "anon@example.com" },
      { name: "Dana Vale", email: "dana@example.com" },
    ]),
  ]);
  check(
    "an unnamed address next to a named one stays a second person",
    lonely[0]?.isGroup === true && lonely[0].participantCount === 2,
    lonely[0] ? String(lonely[0].participantCount) : "no row"
  );

  // ---- What the thread list draws its avatar from ---------------------------
  const chris = { name: "Chris Vale", email: "chris@example.org" };
  const dana = { name: "Dana Vale", email: "dana@example.com" };
  const seen = threadPeople(
    thread([dana, chris, { name: "Ulrik", email: me }], chris)
  );
  check(
    "a thread's people are the others, the one who wrote last first, never you",
    seen.isGroup === true &&
      seen.named.map((p) => p.email).join(",") === `${chris.email},${dana.email}`,
    seen.named.map((p) => p.email).join(",")
  );
  const sameRow = groupThreadsByPerson([
    thread([dana, chris, { name: "Ulrik", email: me }], chris),
  ])[0];
  check(
    "the person view's row names the same people in the same order, so both lists show one pile",
    sameRow?.people.map((p) => p.email).join(",") ===
      seen.named.map((p) => p.email).join(","),
    sameRow?.people.map((p) => p.email).join(",") ?? "no row"
  );
  check(
    "a one-to-one thread is not a group, so its row keeps one face",
    threadPeople(thread([dana])).isGroup === false
  );

  // ---- A machine that stamps a token on each address ------------------------
  check(
    "a tokened mailer address is read as the word at its domain",
    mailerIdentityAddress("no-reply-Qd83kTz0aLpW7mNc2RbV1x@mail.example.com") === "no-reply@mail.example.com" &&
      mailerIdentityAddress("notifications+a1b2c3d4e5f6@slack.example") === "notifications@slack.example",
    mailerIdentityAddress("no-reply-Qd83kTz0aLpW7mNc2RbV1x@mail.example.com")
  );
  check(
    "a person's address is left as it is",
    mailerIdentityAddress("Dana.Vale@example.com") === "dana.vale@example.com" &&
      mailerIdentityAddress("ulrik+github@example.com") === "ulrik+github@example.com" &&
      mailerIdentityAddress("no-reply@example.com") === "no-reply@example.com" &&
      mailerIdentityAddress("no-reply-billing@example.com") === "no-reply-billing@example.com"
  );
  const stamped = groupThreadsByPerson([
    { ...thread([{ name: "Acme", email: "no-reply-Qd83kTz0aLpW7mNc2RbV1x@mail.example.com" }]), threadId: "a1" },
    { ...thread([{ name: "Acme", email: "no-reply-7hGt2KxPq09LmZc4Wd_YbA@mail.example.com" }]), threadId: "a2" },
    { ...thread([{ name: "Acme", email: "no-reply-m3RvB8nJ5sXe1TgU6oCk0Z@mail.example.com" }]), threadId: "a3" },
  ]);
  check(
    "six mails from a tokened mailer are one row on the People view",
    stamped.length === 1 && stamped[0].threads.length === 3 && stamped[0].name === "Acme",
    stamped.map((r) => r.key).join(" | ")
  );
});
