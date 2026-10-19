/**
 * Conversations of the same second keep one order.
 *
 * Mail sent in a batch shares a second, and the list had no order for it:
 * each refresh put those rows in the order the mailboxes happened to
 * answer, so after every archive the rows below swapped places, and the
 * next one to open was not the one below (2026-10-19). Invented threads.
 */

import { dedupeThreadsByTip, newestFirst, withRowsBack } from "@/lib/mail/thread-copies";
import { check, suite } from "./harness.mjs";

const row = (account, id, lastAt) => ({ account, threadId: id, lastAt, subject: id });
const ids = (list) => list.map((t) => `${t.account[0]}${t.threadId}`).join(",");

suite(async () => {
  const same = "2026-10-19T16:12:57Z";
  const rows = [
    row("me@a.example", "t3", same),
    row("me@a.example", "t1", same),
    row("me@b.example", "t2", same),
    row("me@a.example", "t9", "2026-10-19T16:13:00Z"),
  ];
  const once = ids([...rows].sort(newestFirst));
  const reversed = ids([...rows].reverse().sort(newestFirst));
  check("the newest comes first", once.startsWith("mt9"), once);
  check("rows of the same second come out in one order, whatever order they came in", once === reversed, `${once} / ${reversed}`);

  // The list's own step: copies folded, then sorted. The same rows in a
  // different arrival order give the same list.
  const a = ids(dedupeThreadsByTip(rows));
  const b = ids(dedupeThreadsByTip([rows[2], rows[0], rows[3], rows[1]]));
  check("folding copies keeps that order", a === b, `${a} / ${b}`);

  const back = ids(withRowsBack([rows[0], rows[3]], rows, ["me@a.example|t1"]));
  check("a row put back takes its fixed place", back === "mt9,mt1,mt3", back);
});
