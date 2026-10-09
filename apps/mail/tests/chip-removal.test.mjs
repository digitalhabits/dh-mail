/**
 * Where the cursor stands after deleting recipient chips.
 *
 * Deleting one in the middle used to send the selection back to the end of
 * the row, so clearing three from the middle of thirty meant finding your
 * place again after each one.
 */

import { chipSelectionAfterRemoval } from "@/lib/mail/recipient-chips";
import { check, suite } from "./harness.mjs";

suite(async () => {
  check(
    "deleting one in the middle stands on the one that took its place",
    chipSelectionAfterRemoval(3, 9) === 3,
    chipSelectionAfterRemoval(3, 9)
  );
  check(
    "deleting the first stands on the new first",
    chipSelectionAfterRemoval(0, 9) === 0
  );
  check(
    "deleting the last stands on the new last, not past the end",
    chipSelectionAfterRemoval(9, 9) === 8,
    chipSelectionAfterRemoval(9, 9)
  );
  check(
    "deleting a block stands where the block began",
    chipSelectionAfterRemoval(4, 7) === 4
  );
  check(
    "a block taken off the end stands on the new last",
    chipSelectionAfterRemoval(7, 7) === 6,
    chipSelectionAfterRemoval(7, 7)
  );
  check(
    "deleting everything leaves nothing to stand on: back to the input",
    chipSelectionAfterRemoval(0, 0) === null
  );
});

/**
 * Copying the selected chips.
 *
 * Select-all then copy is how a list of addresses leaves this app for
 * anywhere else, so what lands on the clipboard has to be what every mail
 * client reads back.
 */
import { recipientsToClipboardText } from "@/lib/mail/recipient-chips";

suite(async () => {
  const text = recipientsToClipboardText([
    { kind: "email", email: "alice.roe@example.org", name: "Alice Roe" },
    { kind: "email", email: "egon.egern@example.net" },
  ]);
  check(
    "a name is kept, and an address alone stands alone",
    text === "Alice Roe <alice.roe@example.org>, egon.egern@example.net",
    text
  );

  const list = recipientsToClipboardText([
    {
      kind: "list",
      listId: "l1",
      name: "Præsidiet",
      members: [
        { email: "a@x.dk", name: "A" },
        { email: "b@x.dk" },
      ],
    },
  ]);
  check(
    "a saved list gives up its members: nowhere else has heard of the list",
    list === "A <a@x.dk>, b@x.dk",
    list
  );

  const dupes = recipientsToClipboardText([
    { kind: "email", email: "a@x.dk", name: "A" },
    { kind: "email", email: "A@X.dk" },
  ]);
  check("the same address once, however it was written", dupes === "A <a@x.dk>", dupes);

  check(
    "a name that is just the address again is not written twice",
    recipientsToClipboardText([
      { kind: "email", email: "a@x.dk", name: "a@x.dk" },
    ]) === "a@x.dk"
  );
});
