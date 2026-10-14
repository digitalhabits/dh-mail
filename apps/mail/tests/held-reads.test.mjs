/**
 * A read not yet told to the store keeps its row read (lib/mail/held-reads).
 *
 * A list from the store in the seconds after an open still says unread.
 * It used to put the bold back, and the wait then took the bold for the
 * reader's own Mark as unread and never told the store. Rows invented.
 */

import { holdRead, releaseRead, stillHeld, withHeldReads } from "@/lib/mail/held-reads";

import { check, suite } from "./harness.mjs";

const row = (account, threadId, unread) => ({ account, threadId, unread, subject: "Roof" });

suite(async () => {
  const fromStore = [row("ana@kollektiv.example", "t1", true), row("ana@kollektiv.example", "t2", true)];
  check("nothing held: the same list back", withHeldReads(fromStore) === fromStore);

  holdRead(["ana@kollektiv.example|t1"]);
  const shown = withHeldReads(fromStore);
  check("a held row comes back read from a list that says unread", shown[0].unread === false);
  check("the others as the store says", shown[1].unread === true);
  check("the wait still sees its hold", stillHeld(["ana@kollektiv.example|t1"]));
  check("a mailbox in other case is the same row", withHeldReads([row("Ana@Kollektiv.example", "t1", true)])[0].unread === false);

  releaseRead(["ana@kollektiv.example|t1"]);
  check("Mark as unread lets go: the wait tells the store nothing", !stillHeld(["ana@kollektiv.example|t1"]));
  check("and the row is bold again", withHeldReads(fromStore)[0].unread === true);
  check("no keys is never held", !stillHeld([]));
});
