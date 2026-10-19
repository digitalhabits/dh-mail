/**
 * A failed or undone action puts back only its own rows.
 *
 * It put back the whole list as it was when the action began. Archive a
 * few quickly, and one that failed brought back every row archived after
 * it, too: they had left and came back (2026-10-19). Invented threads.
 */

import { threadKey, withRowsBack } from "@/lib/mail/thread-copies";
import { check, suite } from "./harness.mjs";

const row = (id, lastAt, extra = {}) => ({ account: "me@mail.example", threadId: id, lastAt, subject: id, ...extra });
const ids = (list) => list.map((t) => t.threadId).join(",");

suite(async () => {
  const a = row("A", "2026-10-19T10:00:00Z");
  const b = row("B", "2026-10-19T09:00:00Z");
  const c = row("C", "2026-10-19T08:00:00Z");
  // Archive A: the list it began with. Then B goes too, before A fails.
  const beforeA = [a, b, c];
  const afterBoth = [c];
  const back = withRowsBack(afterBoth, beforeA, [threadKey(a)]);
  check("the failed archive's row comes back", ids(back) === "A,C", ids(back));
  check("and the row archived after it stays gone", !back.some((t) => t.threadId === "B"));

  // A row that is still there but changed (marked unread) is put back as it was.
  const read = { ...a, unread: false };
  const changed = withRowsBack([{ ...a, unread: true }, c], [read, c], [threadKey(a)]);
  check("a changed row is put back as it was", changed[0].unread === false && changed.length === 2, JSON.stringify(changed));

  // A row standing for two mailboxes is named by either copy.
  const both = row("D", "2026-10-19T11:00:00Z", { alsoIn: [{ account: "other@mail.example", threadId: "D2" }] });
  const byCopy = withRowsBack([c], [both, c], [threadKey({ account: "other@mail.example", threadId: "D2" })]);
  check("a row is found by a copy folded into it", ids(byCopy) === "D,C", ids(byCopy));

  check("nothing named, nothing changed", withRowsBack([c], [a, c], []).length === 1);
  check("a row that arrived since is kept", ids(withRowsBack([row("N", "2026-10-19T12:00:00Z"), c], beforeA, [threadKey(a)])) === "N,A,C");
});
