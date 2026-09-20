/**
 * The line for a mailbox's first read stays up until the read is complete.
 *
 * On a computer with a mailbox of fifty thousand messages the line showed and
 * then went away, with the read far from done. The list drew it for one phase
 * only. These checks give the rule the rows a store holds in each state a
 * read can be in, and the row is always a whole row: the store replaces every
 * column, so a state is only what the last write carried.
 */

import { firstReadLines, pausedAfterFirstRead } from "@/lib/mail/first-read";

import { check, suite } from "./harness.mjs";

const me = "vera@outlook.example";

/** A store that replaces rows, as the real one does. */
function store() {
  const rows = [];
  return {
    rows,
    set(state) {
      const next = { ...state, folder: state.folder ?? "" };
      const i = rows.findIndex((s) => s.account === next.account && s.folder === next.folder);
      if (i >= 0) rows[i] = next;
      else rows.push(next);
    },
  };
}

suite(async () => {
  const s = store();
  check("no state, no line", firstReadLines(s.rows).length === 0);

  s.set({ account: me, folder: "", phase: "full", fullSyncTotal: 50_000, fullSyncDone: 0 });
  let [line] = firstReadLines(s.rows);
  check("a read that starts has a line at nought", line?.state === "reading" && line.done === 0 && line.total === 50_000, line);

  // A page lands: the count, and the folder's place under its own phase.
  s.set({ account: me, folder: "", phase: "full", fullSyncTotal: 50_000, fullSyncDone: 100 });
  s.set({ account: me, folder: "inbox-id", phase: "reading", deltaLink: "https://graph.example/next" });
  check("the folder's place adds no second line", firstReadLines(s.rows).length === 1, firstReadLines(s.rows));
  [line] = firstReadLines(s.rows);
  check("the line counts on", line.state === "reading" && line.done === 100, line);

  // Graph throttles: the pass ends paused, with the row carried.
  s.set({ ...s.rows[0], phase: "paused", lastError: "The mailbox is busy. Wait a moment." });
  [line] = firstReadLines(s.rows);
  check("a pause keeps the line, and says that Mail tries again", line?.state === "waiting" && line.done === 100 && line.total === 50_000, line);
  check("a pause partway is not the notice of a complete mailbox", pausedAfterFirstRead(s.rows).length === 0);

  s.set({ ...s.rows[0], phase: "paused", lastError: "Failed to fetch: connection reset" });
  check("no answer from the server is said as that", firstReadLines(s.rows)[0]?.state === "offline", firstReadLines(s.rows));

  s.set({ ...s.rows[0], phase: "paused", lastError: "needs reconnect: invalid_grant" });
  check("a refused sign-in is said as that", firstReadLines(s.rows)[0]?.state === "signIn", firstReadLines(s.rows));

  /*
    The case that lost the line: a state that names the phase and nothing
    else. The count is gone from the row, because the store replaced it. The
    folder's place is still there, and that alone keeps the line up.
  */
  s.set({ account: me, folder: "", phase: "paused", lastError: "broke" });
  [line] = firstReadLines(s.rows);
  check("a pause that wiped the count still has a line", line?.state === "waiting" && line.done === 0, line);
  s.set({ account: me, folder: "", phase: "none" });
  [line] = firstReadLines(s.rows);
  check("a stop that wiped the count still has a line, and says stopped", line?.state === "stopped", line);

  // A stop that carries the row, as the worker's stop does now.
  s.set({ account: me, folder: "", phase: "none", fullSyncTotal: 50_000, fullSyncDone: 100 });
  [line] = firstReadLines(s.rows);
  check("a stop keeps the count", line?.state === "stopped" && line.done === 100 && line.total === 50_000, line);

  // The count can pass the total: folder counts move while a read runs.
  s.set({ account: me, folder: "", phase: "full", fullSyncTotal: 50_000, fullSyncDone: 50_040 });
  [line] = firstReadLines(s.rows);
  check("a count over the total does not overfill the bar", line.total === 50_040 && line.done === 50_040 && line.state === "reading", line);

  // The end: the folder is finished, then the mailbox.
  s.set({ account: me, folder: "inbox-id", phase: "live", deltaLink: "https://graph.example/delta" });
  s.set({ account: me, folder: "", phase: "live", fullSyncTotal: 50_040, fullSyncDone: 50_040 });
  check("a complete read has no line", firstReadLines(s.rows).length === 0, firstReadLines(s.rows));

  // A pause after that is the old notice, not a first read.
  s.set({ ...s.rows[0], phase: "paused", lastError: "broke" });
  check("a pause on a complete mailbox has no first-read line", firstReadLines(s.rows).length === 0, firstReadLines(s.rows));
  check("and has the notice", pausedAfterFirstRead(s.rows).length === 1);

  // Gmail's side folders keep rows of their own, with a count each.
  const g = store();
  const gmail = "vera@example.com";
  g.set({ account: gmail, folder: "", phase: "live", fullSyncTotal: 900, fullSyncDone: 900 });
  g.set({ account: gmail, folder: "trash", phase: "paused", fullSyncTotal: 40, fullSyncDone: 10, lastError: "read timed out" });
  const side = firstReadLines(g.rows);
  check("a side folder cut short has its own line", side.length === 1 && side[0].folder === "trash" && side[0].state === "offline", side);

  // Two mailboxes, one reading and one complete.
  g.set({ account: me, folder: "", phase: "full", fullSyncTotal: 10, fullSyncDone: 4 });
  g.set({ account: gmail, folder: "trash", phase: "live", fullSyncTotal: 40, fullSyncDone: 40 });
  const two = firstReadLines(g.rows);
  check("one mailbox's complete read does not hide another's line", two.length === 1 && two[0].account === me, two);
});
