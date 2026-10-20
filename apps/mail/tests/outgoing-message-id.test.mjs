/**
 * The name a message goes out under.
 *
 * A send with no Message-ID is named by the server as it leaves, so one
 * message sent twice — which two outbox workers over one store managed on
 * 20 Sept — arrived under two names, and nothing at either end could tell
 * it was one message. Ours is written into the header block instead, so a
 * duplicate folds wherever messages are folded by it, `dedupeMessagesByRfcId`
 * in this app included.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { newRfcMessageId } from "@/lib/mail/inbox";
import { outgoingHeaderLines } from "@/lib/mail/mime-header";

import { check, suite } from "./harness.mjs";

suite(async () => {
  const one = newRfcMessageId("vera.vinter@vaerksted.example");

  check(
    "it is an address in angle brackets, as the header wants",
    /^<[^<>@\s]+@[^<>@\s]+>$/.test(one),
    one
  );
  check(
    "under the sender's own domain",
    one.endsWith("@vaerksted.example>"),
    one
  );
  check(
    "an account with no domain still makes a usable name",
    /^<[^<>@\s]+@mail\.invalid>$/.test(newRfcMessageId("nonsense")),
    newRfcMessageId("nonsense")
  );

  const many = new Set(
    Array.from({ length: 200 }, () => newRfcMessageId("vera@example.test"))
  );
  check("and no two are the same", many.size === 200, `${many.size} of 200`);

  const send = readFileSync(
    // The send lives in inbox-send.ts since the inbox core was split by concern.
    join(process.cwd(), "../../products/mail/packages/mail/lib/mail/inbox-send.ts"),
    "utf8"
  );
  // The header lines are made by outgoingHeaderLines (mime-header.ts),
  // which strips line breaks from every value. The send must hand it a
  // fresh id, and the thread ids it answers.
  check(
    "every message we build carries one",
    send.includes("messageId: newRfcMessageId(input.account)") &&
      send.includes("outgoingHeaderLines({"),
    send.includes("messageId: newRfcMessageId") ? "in the headers" : "missing"
  );
  const lines = outgoingHeaderLines({
    from: "vera@vaerksted.example",
    to: ["bo@vaerksted.example"],
    subject: "Re: Boats",
    messageId: one,
    inReplyTo: "<a@vaerksted.example>",
    references: "<a@vaerksted.example>",
  });
  const at = (name) => lines.findIndex((line) => line.startsWith(`${name}:`));
  check(
    "written before the thread it answers, not instead of it",
    at("Message-ID") >= 0 &&
      at("Message-ID") < at("In-Reply-To") &&
      at("References") > 0 &&
      send.includes("references: input.references"),
    lines.join(" | ")
  );
});
