import {
  successorAfterRemoving,
  successorInEitherOrder,
} from "@/lib/mail/successor";
import { check, suite } from "./harness.mjs";

const at = (list, target) =>
  successorAfterRemoving(list, (x) => x === target);

suite(async () => {
  check("the row below is the one that opens", at(["a", "b", "c"], "b") === "c");
  check("from the top, still the one below", at(["a", "b", "c"], "a") === "b");

  // Nothing below the last row. Falling back up beats an empty pane.
  check("the last row falls back to the one above", at(["a", "b", "c"], "c") === "b");

  check("the only row leaves nothing", at(["a"], "a") === undefined);
  check("an empty list leaves nothing", at([], "a") === undefined);
  check(
    "a row that is not in the list leaves the choice alone",
    at(["a", "b"], "z") === undefined
  );

  // The first match wins: a list can hold the same thread twice while a
  // refresh is in flight, and picking the later one would skip a row.
  const rows = [{ k: 1 }, { k: 2 }, { k: 2 }, { k: 3 }];
  check(
    "the first match is the one removed",
    successorAfterRemoving(rows, (r) => r.k === 2) === rows[2],
    JSON.stringify(successorAfterRemoving(rows, (r) => r.k === 2))
  );

  // --- When the two orders disagree ---------------------------------------
  //
  // The row to open next is taken from the order on screen — the pins band,
  // then the visible flow. That order is put into a ref while the component
  // renders, and a delete happens from an event, so the two can disagree
  // about what is on screen. When they do, opening nothing is the worst of
  // the three answers: it looks as though the delete went wrong.

  const painted = [{ k: 1 }, { k: 2 }, { k: 3 }];
  const plain = [{ k: 1 }, { k: 2 }, { k: 3 }, { k: 4 }];
  const is = (n) => (row) => row.k === n;

  check(
    "the painted order is the one followed",
    successorInEitherOrder(painted, plain, is(1))?.k === 2
  );
  check(
    "a row the painted order has never heard of falls back to the plain one",
    successorInEitherOrder(painted, plain, is(4))?.k === 3
  );
  check(
    "an empty painted order is not an answer, it is a reason to fall back",
    successorInEitherOrder([], plain, is(2))?.k === 3
  );
  check(
    "the last row still falls back to the one above it",
    successorInEitherOrder(painted, plain, is(3))?.k === 2
  );
  check(
    "a row in neither leaves nothing to open",
    successorInEitherOrder(painted, plain, is(9)) === undefined
  );
  check(
    "the only row in both leaves nothing to open",
    successorInEitherOrder([{ k: 1 }], [{ k: 1 }], is(1)) === undefined
  );
});
