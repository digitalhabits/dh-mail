/**
 * The organization's directory keeps places in the To menu.
 *
 * The menu has 8 people. Ranked with the rest, the directory's people came
 * after every local match, so a reader with many contacts never saw the
 * colleague the directory had found. Invented example.com data only.
 */

import { filterMenu } from "@/components/mail/recipient-suggestions";

import { check, suite } from "./harness.mjs";

const person = (name, email, source) => ({ name, email, source });

suite(async () => {
  const local = Array.from({ length: 10 }, (_, i) => person(`Stella Local ${i}`, `stella${i}@example.com`, "contacts"));
  const directory = [
    person("Stefan Colleague", "stefan@uni.example.com", "directory"),
    person("Stine Colleague", "stine@uni.example.com", "directory"),
  ];
  const menu = filterMenu("ste", [...local, ...directory], [], []);
  const people = menu.filter((m) => m.kind === "contact").map((m) => m.contact);

  check("the menu keeps 8 people", people.length === 8, people.length);
  check("the directory's people are in it", people.filter((p) => p.source === "directory").length === 2, people.map((p) => p.source));
  check("after the local contacts", people.at(-1).source === "directory" && people[0].source === "contacts");

  const few = filterMenu("ste", [local[0], ...directory], [], []);
  check("with few contacts, no place is kept empty", few.filter((m) => m.kind === "contact").length === 3);

  const many = Array.from({ length: 6 }, (_, i) => person(`Stefan ${i}`, `s${i}@uni.example.com`, "directory"));
  const capped = filterMenu("ste", [...local, ...many], [], []).filter((m) => m.kind === "contact").map((m) => m.contact);
  check("at most 3 directory places when contacts fill the rest", capped.filter((p) => p.source === "directory").length === 3, capped.length);
});
