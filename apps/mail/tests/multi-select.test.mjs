/**
 * The rules of selecting more than one row in the mail list.
 *
 * Shift-click takes a range from the open row. Cmd-click adds a row or
 * takes it out. After the selected rows go, the list lands on the row after
 * them, else the one before.
 */

import {
  nextMultiSelection,
  rowAfterSelection,
  selectedInOrder,
} from "@/lib/mail/multi-select";

import { check, suite } from "./harness.mjs";

const ORDER = ["a", "b", "c", "d", "e"];
const order = () => ORDER;
const list = (set) => [...set].sort().join(",");

suite(async () => {
  const none = new Set();

  check(
    "shift-click takes the range from the anchor",
    list(nextMultiSelection(none, "d", "b", true, order)) === "b,c,d"
  );
  check(
    "and upwards too",
    list(nextMultiSelection(none, "a", "c", true, order)) === "a,b,c"
  );
  check(
    "a shift-click replaces an earlier selection",
    list(nextMultiSelection(new Set(["e"]), "b", "a", true, order)) === "a,b"
  );
  check(
    "shift-click with nothing open is a click",
    list(nextMultiSelection(none, "c", null, true, order)) === "c"
  );
  check(
    "a row not in the painted order takes the two rows",
    list(nextMultiSelection(none, "zz", "b", true, order)) === "b,zz"
  );

  const first = nextMultiSelection(none, "d", "b", false, order);
  check("the first Cmd-click takes the anchor with it", list(first) === "b,d");
  const second = nextMultiSelection(first, "e", "b", false, order);
  check("the next Cmd-click adds one", list(second) === "b,d,e");
  const third = nextMultiSelection(second, "d", "b", false, order);
  check("a Cmd-click on a selected row takes it out", list(third) === "b,e");
  check("and the set given is left as it was", list(second) === "b,d,e");
  check(
    "Cmd-click with nothing open takes the row alone",
    list(nextMultiSelection(none, "c", null, false, order)) === "c"
  );

  const rows = [{ k: "a" }, { k: "b" }, { k: "a" }, { k: "c" }];
  check(
    "the selected rows come in painted order, each once",
    selectedInOrder(rows, new Set(["c", "a"]), (r) => r.k)
      .map((r) => r.k)
      .join(",") === "a,c"
  );

  const picked = (keys) => (row) => keys.includes(row);
  check(
    "after the selection, the first row below it",
    rowAfterSelection(ORDER, picked(["b", "c"])) === "d"
  );
  check(
    "a gap inside the selection is not the answer",
    rowAfterSelection(ORDER, picked(["a", "c", "d"])) === "e"
  );
  check(
    "at the bottom, the last row above",
    rowAfterSelection(ORDER, picked(["d", "e"])) === "c"
  );
  check(
    "everything selected leaves nowhere to land",
    rowAfterSelection(ORDER, picked(ORDER)) === null
  );
});
