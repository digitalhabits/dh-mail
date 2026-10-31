/**
 * Delete with the key on a scheduled message's page: the next scheduled
 * message opens, or the one before it after the last. When none is left,
 * nothing opens and the reader is empty.
 *
 * Every address is invented.
 */

import { nextHeldAfterDelete } from "@/lib/mail/scheduled-held";

import { check, suite } from "./harness.mjs";

const held = (id, account = "vera@example.org") => ({
  id,
  sendAt: "2026-10-31T12:00:00Z",
  account,
  threadId: "",
  toName: "bo@example.org",
  subject: "Plan",
  bodyText: "",
  to: ["bo@example.org"],
  cc: [],
});

suite(async () => {
  const [a, b, c, pending] = [held("a"), held("b"), held("c"), held("pending:1")];
  const isPending = (id) => id.startsWith("pending:");
  check("the next one opens", nextHeldAfterDelete([a, b, c], a, isPending)?.id === "b");
  check("one in the middle: the next", nextHeldAfterDelete([a, b, c], b, isPending)?.id === "c");
  check("after the last, the one before it", nextHeldAfterDelete([a, b, c], c, isPending)?.id === "b");
  check("none left: nothing opens", nextHeldAfterDelete([a], a, isPending) === null);
  check("a row in its Undo seconds is passed over", nextHeldAfterDelete([a, pending, b], a, isPending)?.id === "b");
  check(
    "the same id in another mailbox is not the one deleted",
    nextHeldAfterDelete([held("a", "bo@example.org")], a, isPending) === null
  );
});
