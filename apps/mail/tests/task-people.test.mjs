/**
 * A person proposed on a task is drawn as the to-do board draws them: the
 * same initials, the same short name, the same colour.
 */

import {
  colourForPerson,
  firstName,
  initialsOf,
  shortPersonName,
} from "@/lib/mail/task-people";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check("a title is not an initial", initialsOf("Dr Vera Vinter") === "VV", initialsOf("Dr Vera Vinter"));
  check("one name gives its first two letters", initialsOf("Frida") === "FR", initialsOf("Frida"));
  check("no name is a question mark", initialsOf("  ") === "?");

  check("the menu shows the first name and an initial", shortPersonName("Benny Björg") === "Benny B.", shortPersonName("Benny Björg"));
  check("and drops a title", shortPersonName("Prof Jens Jordbær") === "Jens J.", shortPersonName("Prof Jens Jordbær"));
  check("the chip shows the first name", firstName("Dr Kanin Kunsthal") === "Kanin", firstName("Dr Kanin Kunsthal"));

  check("the board's own colour is kept", colourForPerson("Gustav Gulerod", "#7c3aed") === "#7c3aed");
  check("a colour that is not a hex is not", colourForPerson("Gustav Gulerod", "purple") !== "purple");
  check(
    "without one, a name always gets the same colour",
    colourForPerson("Anton Asmund") === colourForPerson("Anton Asmund") && /^#[0-9a-f]{6}$/.test(colourForPerson("Anton Asmund")),
    colourForPerson("Anton Asmund")
  );
});
