/**
 * A person is a contact card; otherwise a person is an address.
 *
 * Two addresses on one card are one person in the People view. Two cards
 * in two books that share an address are one person too. An address on no
 * card stands for itself, and two strangers who share a name stay apart.
 */

import { buildPersonIdentity } from "@/lib/mail/person-identity";
import { groupThreadsByPerson } from "@/lib/mail/person-participants";

import { check, suite } from "./harness.mjs";

const me = "vera@example.com";

function thread(id, from, at) {
  return {
    account: me,
    threadId: id,
    subject: "",
    fromName: from.name,
    fromEmail: from.email,
    snippet: "",
    lastAt: at,
    unread: false,
    messageCount: 1,
    tab: "people",
    externalParticipants: [from],
  };
}

suite(async () => {
  const identity = buildPersonIdentity([
    { source: "mac", account: "", email: "merle@college.example", card: "ABC-1" },
    { source: "mac", account: "", email: "merle@home.example", card: "ABC-1" },
    // Google knows her home address on a card of its own — same person.
    { source: "google", account: me, email: "merle@home.example", card: "people/9" },
    { source: "google", account: me, email: "merle@third.example", card: "people/9" },
    // History is a suggestion, not a card: it never joins anybody.
    { source: "history", account: me, email: "frida@a.example", card: null },
  ]);

  check(
    "two addresses on one card are one person",
    identity("merle@college.example") === identity("merle@home.example"),
    identity("merle@college.example")
  );
  check(
    "a card in another book that shares an address joins it",
    identity("merle@third.example") === identity("MERLE@college.example"),
    identity("merle@third.example")
  );
  check(
    "an address on no card stands for itself",
    identity("frida@a.example") === "person:frida@a.example",
    identity("frida@a.example")
  );

  const rows = groupThreadsByPerson(
    [
      thread("t3", { name: "Merle Mikkelsen", email: "merle@third.example" }, "2026-09-03T10:00:00Z"),
      thread("t2", { name: "Merle Mikkelsen", email: "merle@college.example" }, "2026-09-02T10:00:00Z"),
      thread("t1", { name: "Frida Fisker", email: "frida@a.example" }, "2026-09-01T10:00:00Z"),
      thread("t0", { name: "Frida Fisker", email: "frida@b.example" }, "2026-08-31T10:00:00Z"),
    ],
    identity
  );
  check(
    "Merle is one row and the Fridas, on no card, stay two",
    rows.length === 3,
    rows.map((r) => r.key).join(" | ")
  );
  const merle = rows.find((r) => r.name === "Merle Mikkelsen");
  check(
    "her row keeps the newest address as its own",
    merle?.email === "merle@third.example",
    merle?.email
  );
  check(
    "and names every address she wrote from",
    merle?.people.map((p) => p.email).sort().join(",") ===
      "merle@college.example,merle@third.example",
    merle?.people.map((p) => p.email).join(",")
  );
  check(
    "one face, not a pile: the merged row is not a group",
    merle?.isGroup === false && merle?.threads.length === 2,
    `${merle?.isGroup} ${merle?.threads.length}`
  );
});
