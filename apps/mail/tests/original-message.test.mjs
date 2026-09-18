/**
 * "Show original" reads three things off a raw message: who sent it, when
 * it got here, and whether the checks passed. Each is read from headers
 * that fold, repeat, and carry comments, so each is checked here.
 */

import {
  decodeEncodedWords,
  parseMessageHeaders,
  summarizeOriginalMessage,
} from "@/lib/mail/original-message";

import { check, suite } from "./harness.mjs";

const source = [
  "Delivered-To: vera@example.com",
  "Received: by mx.example.com with SMTP id abc;",
  "        Tue, 1 Sep 2026 10:00:07 +0000 (UTC)",
  "Received: from relay.sender.test (relay.sender.test. [203.0.113.5])",
  "        by mx.example.com; Tue, 1 Sep 2026 10:00:05 +0000",
  "Authentication-Results: mx.example.com;",
  "       dkim=pass header.i=@sender.test header.s=s1;",
  "       spf=pass (example.com: domain of ann@sender.test designates 203.0.113.5 as permitted sender) smtp.mailfrom=ann@sender.test;",
  "       dmarc=fail (p=REJECT sp=REJECT dis=NONE) header.from=sender.test",
  "Authentication-Results: relay.sender.test; spf=none",
  "From: =?utf-8?Q?Ann_S=C3=B8rensen?= <ann@sender.test>",
  "Subject: =?UTF-8?B?SGVsbG8gd29ybGQ=?=",
  "Message-ID: <one@sender.test>",
  "Date: Tue, 1 Sep 2026 10:00:04 +0000",
  "",
  "Hello",
  "",
  "Date: not a header, this is the body",
].join("\r\n");

suite(async () => {
  const headers = parseMessageHeaders(source);
  check(
    "folded lines join their header, and the body is not read as headers",
    headers.filter((h) => h.name === "date").length === 1 &&
      headers.find((h) => h.name === "received").value.includes("10:00:07"),
    JSON.stringify(headers.map((h) => h.name))
  );

  const summary = summarizeOriginalMessage(source);
  check(
    "the From line is shown with its encoded words decoded",
    summary.from === "Ann Sørensen <ann@sender.test>",
    summary.from
  );
  check(
    "the subject decodes the base64 form too",
    summary.subject === "Hello world",
    summary.subject
  );
  check(
    "delivery is the top Received stamp, comments dropped",
    summary.deliveredAt?.toISOString() === "2026-09-01T10:00:07.000Z",
    summary.deliveredAt
  );
  check(
    "'delivered after' is the gap between Date and delivery, in seconds",
    summary.deliveredAfterSeconds === 3,
    summary.deliveredAfterSeconds
  );
  check(
    "the verdicts come from the mailbox's own results, not the relay's",
    summary.auth.spf === "pass" &&
      summary.auth.dkim === "pass" &&
      summary.auth.dmarc === "fail",
    JSON.stringify(summary.auth)
  );

  const bare = summarizeOriginalMessage("From: x@y.test\r\n\r\nhi");
  check(
    "a message without the headers says so with nulls rather than guesses",
    bare.deliveredAt === null &&
      bare.deliveredAfterSeconds === null &&
      bare.auth.spf === null,
    JSON.stringify(bare)
  );

  check(
    "two encoded words in a row lose the space between them",
    decodeEncodedWords("=?utf-8?Q?a?= =?utf-8?Q?b?=") === "ab",
    decodeEncodedWords("=?utf-8?Q?a?= =?utf-8?Q?b?=")
  );
  check(
    "a word in a charset the platform lacks stays as written",
    decodeEncodedWords("=?x-nope?Q?a?=") === "=?x-nope?Q?a?=",
    decodeEncodedWords("=?x-nope?Q?a?=")
  );
});
