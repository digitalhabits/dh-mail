/**
 * The names beside a thread's subject: short names, two of them, then a
 * count. Every name and address is invented.
 */

import { headingName, headingPeople, headingPeopleLine } from "@/lib/mail/thread-heading-people";
import { check, suite } from "./harness.mjs";

const words = { and: "and", more: (n) => `${n} more` };
const person = (name, email) => ({ kind: "person", label: name, email, name });

suite(async () => {
  check("a middle name is left out", headingName("Mikkel Gabriel Tester") === "Mikkel Tester");
  check("two names stay as they are", headingName("Vera Vinter") === "Vera Vinter");
  check("Last, First reads First Last", headingName("Roe, Jane") === "Jane Roe");
  check("a job after the name goes", headingName("Claire Cockcroft (Programme Director)") === "Claire Cockcroft");
  check("quotes go", headingName('"Bo Berg"') === "Bo Berg");

  const people = [
    { kind: "you", emails: ["me@mail.example"] },
    person("Mikkel Gabriel Tester", "mikkel@uni.example"),
    { kind: "person", label: "x@y.example", email: "x@y.example" },
    person("Asta Holm", "asta@uni.example"),
  ];
  const names = headingPeople(people, "mikkel@uni.example", "You");
  check("who started it comes first, then the rest", names.join("|") === "Mikkel Tester|You|x@y.example|Asta Holm", names.join("|"));
  check("one name alone", headingPeopleLine(["Mikkel Tester"], words) === "Mikkel Tester");
  check("two are both named", headingPeopleLine(["Mikkel Tester", "You"], words) === "Mikkel Tester and You");
  check("more than two: two names and a count", headingPeopleLine(names, words) === "Mikkel Tester, You and 2 more");
  check("three: and 1 more", headingPeopleLine(names.slice(0, 3), words) === "Mikkel Tester, You and 1 more");
});
