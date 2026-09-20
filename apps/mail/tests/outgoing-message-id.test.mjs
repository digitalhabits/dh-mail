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
    join(process.cwd(), "../../products/mail/packages/mail/lib/mail/inbox.ts"),
    "utf8"
  );
  const headers = send.slice(
    send.indexOf("  const headers = ["),
    send.indexOf('"MIME-Version: 1.0"')
  );
  check(
    "every message we build carries one",
    headers.includes("`Message-ID: ${newRfcMessageId(input.account)}`"),
    headers.includes("Message-ID") ? "in the headers" : "missing"
  );
  check(
    "written before the thread it answers, not instead of it",
    headers.indexOf("Message-ID") < headers.indexOf("In-Reply-To") &&
      headers.includes("References: ${input.references}")
  );
});
