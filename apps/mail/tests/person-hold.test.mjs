/**
 * The open person keeps their place in the list until the reader leaves.
 *
 * Deleting the newest conversation in an open stack made the stack older,
 * and it dropped down the list under the pointer. All rows here are invented.
 */

import { nextPersonHold, placedAt, placeHeldRow } from "@/lib/mail/person-hold";
import { check, suite } from "./harness.mjs";

const row = (key, lastAt) => ({ key, lastAt: `2026-10-${lastAt}:00:00Z` });
const keys = (rows) => rows.map((r) => r.key).join(",");
const none = () => false;

suite(async () => {
  const before = [row("a", "23T10"), row("s", "22T12"), row("b", "21T09"), row("c", "19T09")];
  const hold = nextPersonHold(null, "s", before);
  check("opening a person holds their time", hold?.key === "s" && hold.at === before[1].lastAt);
  check("the same paint again changes nothing", nextPersonHold(hold, "s", before) === hold);

  // The newest thread in the stack is deleted: the stack is now from the 20th.
  const after = [row("a", "23T10"), row("b", "21T09"), row("s", "20T08"), row("c", "19T09")];
  check("the hold stays while the person is open", nextPersonHold(hold, "s", after) === hold);
  check("the held row stays where it was", keys(placeHeldRow(after, hold, none)) === "a,s,b,c");
  check(
    "and under the day heading it had",
    placedAt(after[2], hold) === before[1].lastAt && placedAt(after[1], hold) === after[1].lastAt
  );

  check("leaving the person ends the hold", nextPersonHold(hold, "b", after)?.key === "b");
  check("no one open, no hold", nextPersonHold(hold, null, after) === null);
  check("with no hold the rows are their own order", keys(placeHeldRow(after, null, none)) === "a,b,s,c");

  // New mail from the open person still lifts them.
  const lifted = [row("s", "24T08"), row("a", "23T10"), row("b", "21T09"), row("c", "19T09")];
  const up = nextPersonHold(hold, "s", lifted);
  check("new mail moves the hold up", up?.at === lifted[0].lastAt);
  check("and the row goes to the top", keys(placeHeldRow(lifted, up, none)) === "s,a,b,c");

  check(
    "a list read again without the row keeps the hold",
    nextPersonHold(hold, "s", [row("a", "23T10")]) === hold
  );

  const pinned = (r) => r.key === "p";
  const withPin = [row("p", "01T09"), row("a", "23T10"), row("b", "21T09"), row("s", "20T08")];
  check(
    "pinned rows stay above the held one",
    keys(placeHeldRow(withPin, hold, pinned)) === "p,a,s,b"
  );
  check("a pinned person is not moved", placeHeldRow(withPin, { key: "p", at: "2026-10-30T00:00:00Z" }, pinned) === withPin);
  check("a row already in place is the same list", placeHeldRow(before, hold, none) === before);
});
