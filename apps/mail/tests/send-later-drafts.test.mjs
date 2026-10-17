/**
 * Send later from a draft (docs/mail-send-later.md): what a failed send
 * means, and how a scheduled draft is shown in the list.
 *
 * A failure is read three ways. "gone": the draft is not there, so nothing
 * is sent and nothing is tried again — the guard against a second message.
 * "retry": the network, a sign-in, a busy server. "refused": the server
 * will not send this message, and the person must see it.
 */

import {
  exchangeFailure,
  gmailFailure,
  isScheduledDraftId,
  toScheduledMessage,
} from "@/lib/mail/scheduled-drafts";

import { check, suite } from "./harness.mjs";

const gmailError = (status, message = "") => Object.assign(new Error(message), { status });

const row = (over = {}) => ({
  id: 7,
  account: "vera@example.com",
  provider: "gmail",
  draftId: "r-123",
  threadId: "t1",
  subject: "The plan",
  to: ["ann@example.com"],
  cc: [],
  bodyText: "See you then.",
  bodyHtml: "<p>See you then.</p>",
  sendAt: Date.UTC(2026, 9, 20, 7, 0),
  status: "waiting",
  ...over,
});

suite(async () => {
  check("a Gmail draft that is not there is gone", gmailFailure(gmailError(404)) === "gone");
  check("a bad address is refused", gmailFailure(gmailError(400)) === "refused");
  check("a signed-out mailbox tries again", gmailFailure(gmailError(401)) === "retry");
  check("a rate limit tries again", gmailFailure(gmailError(429)) === "retry");
  check("Google's own trouble tries again", gmailFailure(gmailError(503)) === "retry");
  check("no network tries again", gmailFailure(new TypeError("Load failed")) === "retry");
  check(
    "a 403 for the quota tries again, any other 403 is refused",
    gmailFailure(gmailError(403, "Gmail API failed (403, rateLimitExceeded)")) === "retry" &&
      gmailFailure(gmailError(403, "Gmail API failed (403, insufficientPermissions)")) === "refused"
  );

  check("an Exchange answer that says no is refused", exchangeFailure(new Error("ews:fault ErrorInvalidRecipients")) === "refused");
  check("an Exchange network failure tries again", exchangeFailure(new Error("ews:network timed out")) === "retry");
  check("a busy Exchange server tries again", exchangeFailure(new Error("ews:busy")) === "retry");
  check("a refused password tries again after the sign-in", exchangeFailure(new Error("ews:refused")) === "retry");

  const waiting = toScheduledMessage(row());
  check("a scheduled draft's id says what it is", isScheduledDraftId(waiting.id) && !isScheduledDraftId("AAMkAD1"));
  check(
    "it waits, with its time and its words for Edit",
    waiting.status === "waiting" && waiting.sendAt === "2026-10-20T07:00:00.000Z" && waiting.bodyHtml === "<p>See you then.</p>"
  );

  const late = toScheduledMessage(row({ status: "late" }));
  check(
    "a late one is Not sent, and says when it was due",
    late.status === "failed" && /^It was due .+, when Mail was not open$/.test(late.error ?? ""),
    late.error
  );
  const refused = toScheduledMessage(row({ status: "refused", lastError: "ews:fault ErrorInvalidRecipients" }));
  check(
    "a refused one is Not sent, with the server's words",
    refused.status === "failed" && refused.error === "ews:fault ErrorInvalidRecipients"
  );
});
