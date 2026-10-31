/**
 * Delete on a scheduled message waits for its Undo.
 *
 * A deleted scheduled message cannot be brought back from the server. So
 * Delete hides it at once and asks the server only when the Undo time is
 * over. Undo shows it again, and the server is never asked. A message due
 * within the Undo time could be sent while it waits, so it is deleted at
 * once. A missed one is never sent by itself, so it always waits.
 *
 * Every address and word is invented.
 */

import { toastSink } from "sonner";

import { setMailApiTransport } from "@/lib/mail/api";
import { canWaitForUndo, deleteHeldWithUndo } from "@/components/mail/scheduled-undo";
import { isLeavingScheduled } from "@/lib/mail/scheduled-events";

import { check, suite } from "./harness.mjs";

// The timers the delete waits on, run by hand here.
const waiting = [];
globalThis.setTimeout = (run, ms) => {
  const handle = { run, ms, cleared: false };
  waiting.push(handle);
  return handle;
};
globalThis.clearTimeout = (handle) => {
  if (handle) handle.cleared = true;
};
const runTimers = () => {
  for (const handle of waiting.splice(0)) if (!handle.cleared) handle.run();
};
const settle = () => new Promise((resolve) => setImmediate(resolve));

const toasts = [];
toastSink.push = (t) => toasts.push(t);

const posted = [];
setMailApiTransport(async (_path, init) => {
  posted.push(JSON.parse(init?.body ?? "{}"));
  return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
});

const now = Date.parse("2026-10-31T10:00:00Z");
const held = (over) => ({
  id: "9",
  sendAt: "2026-10-31T12:00:00Z",
  account: "vera@example.org",
  threadId: "",
  toName: "bo@example.org",
  subject: "Plan",
  bodyText: "See the plan.",
  to: ["bo@example.org"],
  cc: [],
  status: "waiting",
  ...over,
});

suite(async () => {
  check("a message hours away can wait for Undo", canWaitForUndo(held(), now));
  check("one due in 20 seconds cannot", !canWaitForUndo(held({ sendAt: "2026-10-31T10:00:20Z" }), now));
  check("one being sent cannot", !canWaitForUndo(held({ status: "sending" }), now));
  check(
    "a missed one always can",
    canWaitForUndo(held({ missed: true, status: "failed", sendAt: "2026-10-31T01:40:00Z" }), now)
  );

  // Delete, then Undo: hidden at once, shown again, never asked of the server.
  deleteHeldWithUndo(held({ id: "1", sendAt: "2099-01-01T09:00:00Z" }));
  check("Delete hides it at once", isLeavingScheduled({ account: "vera@example.org", id: "1" }));
  check("and asks nothing yet", posted.length === 0);
  const offer = toasts.at(-1);
  check("Delete says so, with Undo", Boolean(offer?.data?.action?.onClick), JSON.stringify(offer?.message));
  offer.data.action.onClick();
  runTimers();
  await settle();
  check("Undo shows it again", !isLeavingScheduled({ account: "vera@example.org", id: "1" }));
  check("and the server is never asked", posted.length === 0, JSON.stringify(posted));

  // Delete, and the time runs out: deleted then.
  deleteHeldWithUndo(held({ id: "2", sendAt: "2099-01-01T09:00:00Z" }));
  runTimers();
  await settle();
  check(
    "when the Undo time is over, it is deleted",
    posted.length === 1 && posted[0].action === "delete" && posted[0].id === "2",
    JSON.stringify(posted)
  );

  // Due within the Undo time: deleted at once.
  posted.length = 0;
  deleteHeldWithUndo(held({ id: "3", sendAt: new Date(Date.now() + 5_000).toISOString() }));
  await settle();
  check("one due now is deleted at once", posted.length === 1 && posted[0].id === "3", JSON.stringify(posted));
});
