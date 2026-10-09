/**
 * The heading of a thread that has only a held message so far: the held
 * message's subject, its count, and the day it goes, not "(no subject) ·
 * 0 messages" (17.1 of docs/mail-exchange-ews.md).
 */

import { headingWithHeld } from "@/lib/mail/held-thread-header";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const empty = { subject: "(no subject)", count: 0, dateRange: "" };
  const held = [{ subject: "DH test: the plan", sendAt: "2026-10-01T08:00:00Z" }];
  const got = headingWithHeld(empty, held);
  check("the held message gives the subject", got.subject === "DH test: the plan", got.subject);
  check("and the count", got.count === 1);
  check("and a day", got.dateRange.length > 0, got.dateRange);

  const real = { subject: "Budget", count: 3, dateRange: "1 Oct" };
  check("a thread with messages keeps its own heading", headingWithHeld(real, held) === real);
  check("no held message changes nothing", headingWithHeld(empty, []) === empty);
  check("a thread's own subject stays when it has one", headingWithHeld({ ...empty, subject: "Kept" }, held).subject === "Kept");
  check("a held message with no subject leaves the heading as it was", headingWithHeld(empty, [{ subject: " ", sendAt: held[0].sendAt }]).subject === "(no subject)");
});
