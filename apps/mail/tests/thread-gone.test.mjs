/**
 * A reply draft whose conversation the provider no longer has.
 *
 * Opening it showed the provider's raw error. The Drafts view now says the
 * conversation is gone and offers to discard the draft. These checks give
 * the test the errors Gmail and Outlook return, and some that are not this.
 */

import { draftThreadProblem, isMailboxNotConnectedError, isThreadGoneError } from "@/lib/mail/thread-gone";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check(
    "Gmail's not-found is gone",
    isThreadGoneError('Gmail API /threads/abc failed (404, notFound): { "error": { "code": 404 } }')
  );
  check("Outlook's not-found is gone", isThreadGoneError("Graph 404: ErrorItemNotFound"));
  check("no error is not gone", !isThreadGoneError(null));
  check("a refused sign-in is not gone", !isThreadGoneError("Gmail API /threads/abc failed (401, unauthenticated)"));
  check("a timeout is not gone", !isThreadGoneError("the server did not answer in time"));

  // A draft from a mailbox that was removed from Mail.
  const noMailbox = "No connected mailbox for someone@example.com";
  check("a missing mailbox is named as such", isMailboxNotConnectedError(noMailbox));
  check("a missing mailbox is not a gone thread", draftThreadProblem(noMailbox) === "mailbox");
  check("a gone thread stays a gone thread", draftThreadProblem("Graph 404: ErrorItemNotFound") === "gone");
  check("a timeout is neither", draftThreadProblem("the server did not answer in time") === null);
});
