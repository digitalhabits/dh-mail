/**
 * The scheduled mail of an Exchange mailbox, from its two sources
 * (lib/mail/scheduled-lists.ts): the server's held list may fail or be
 * slow, and the drafts this computer sends later are still listed.
 */

import { serverAndLocalLists } from "@/lib/mail/scheduled-lists";

import { check, suite } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

suite(async () => {
  const failures = [];
  const note = (err) => failures.push(String(err?.message ?? err));

  const both = await serverAndLocalLists(Promise.resolve(["held"]), Promise.resolve(["draft"]), 200, note);
  check("both lists answer: the server's first, then this computer's", both.join() === "held,draft");
  check("and nothing is reported", failures.length === 0);

  const down = await serverAndLocalLists(
    Promise.reject(new Error("the server did not answer")),
    Promise.resolve(["missed draft"]),
    200,
    note
  );
  check("the server fails: this computer's scheduled draft is still listed", down.join() === "missed draft");
  check("and the failure is reported once", failures.length === 1 && failures[0].includes("did not answer"));

  const started = Date.now();
  const slow = await serverAndLocalLists(
    sleep(2000).then(() => ["late answer"]),
    Promise.resolve(["missed draft"]),
    50,
    note
  );
  check("a slow server is not waited for past its time", slow.join() === "missed draft" && Date.now() - started < 1000);
  check("and that is reported too", failures.length === 2);

  let threw = false;
  try {
    await serverAndLocalLists(Promise.resolve([]), Promise.reject(new Error("the store is shut")), 200, note);
  } catch {
    threw = true;
  }
  check("a failure of this computer's own list is not hidden", threw);
});
