/**
 * The unread switch at the end of the tabs. All mail here is invented.
 */

import { nextUnreadKeep, unreadRows } from "@/lib/mail/unread-filter";
import { check, suite } from "./harness.mjs";

const row = (threadId, unread) => ({ account: "vera@mail.test", threadId, unread });
const ids = (rows) => rows.map((r) => r.threadId).join(",");

suite(async () => {
  const first = [row("a", true), row("b", false), row("c", true)];
  const keep = nextUnreadKeep(null, "all|*", first);
  check("on, a tab lists its unread", ids(unreadRows(first, keep)) === "a,c");
  check("the same paint again changes nothing", nextUnreadKeep(keep, "all|*", first) === keep);

  // The reader opens a; it is read now.
  const read = [row("a", false), row("b", false), row("c", true)];
  const kept = nextUnreadKeep(keep, "all|*", read);
  check("a conversation read while the switch is on stays", ids(unreadRows(read, kept)) === "a,c");
  check("nothing new, the same keep", kept === keep);

  const newMail = [row("d", true), ...read];
  const grown = nextUnreadKeep(kept, "all|*", newMail);
  check("new unread mail comes in", ids(unreadRows(newMail, grown)) === "d,a,c");

  const otherTab = nextUnreadKeep(grown, "other|*", read);
  check("another tab starts afresh: read mail is not kept", ids(unreadRows(read, otherTab)) === "c");
  check("a tab with nothing unread lists nothing", unreadRows([row("x", false)], nextUnreadKeep(null, "t", [row("x", false)])).length === 0);
});
