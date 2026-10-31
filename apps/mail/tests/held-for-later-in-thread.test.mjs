import { heldForLaterIn } from "@/lib/mail/inbox-send";
import { check, suite } from "./harness.mjs";

// Which outbox messages stand at the end of their thread as scheduled: the
// ones held for a later time, and the missed ones waiting for the person.
// A send in its Undo seconds is already in the thread as a bubble.
const now = Date.parse("2026-10-31T00:40:00Z");
const row = (over) => ({
  id: "1",
  sendAt: "2026-10-31T01:40:00Z",
  account: "ada@example.com",
  threadId: "t1",
  toName: "bo@example.com",
  subject: "Re: test",
  bodyText: "Hi",
  to: ["bo@example.com"],
  cc: [],
  status: "waiting",
  ...over,
});

suite(async () => {
  check("a reply held for later shows in its thread", heldForLaterIn([row()], "t1", now).length === 1);
  check("not in another thread", heldForLaterIn([row()], "t2", now).length === 0);
  check(
    "a send in its Undo seconds does not",
    heldForLaterIn([row({ sendAt: "2026-10-31T00:40:05Z" })], "t1", now).length === 0
  );
  check("one being sent does not", heldForLaterIn([row({ status: "sending" })], "t1", now).length === 0);
  check(
    "a missed one waiting for the person does",
    heldForLaterIn([row({ status: "failed", missed: true, sendAt: "2026-10-30T20:00:00Z" })], "t1", now).length === 1
  );
  check(
    "a refused one does not (the thread has its own Not sent)",
    heldForLaterIn([row({ status: "failed" })], "t1", now).length === 0
  );
});
