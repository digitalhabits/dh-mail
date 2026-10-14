/**
 * A draft from the drafts folder, checked and made into one of ours
 * (lib/mail/drafts-inbox.ts). Addresses and words are invented.
 */

import { cleanDraftHtml, draftFromInbox, textToDraftHtml } from "@/lib/mail/drafts-inbox";

import { check, suite } from "./harness.mjs";

const ACCOUNTS = ["ulla@aavang.example", "Ulla.Work@kollektiv.example"];

suite(async () => {
  const made = draftFromInbox(
    { from: "ULLA@aavang.example", to: ["bo@havn.example"], subject: "Beans", body: "Hi Bo,\n\nThe beans go in May.\nThanks" },
    ACCOUNTS
  );
  check("a new message is made from a connected mailbox, case aside", made.ok && made.draft.kind === "compose" && made.draft.from === "ulla@aavang.example");
  check("a line for each line, and a blank line kept as the editor's gap",
    made.ok && made.draft.body === "<p>Hi Bo,</p><p><br></p><p>The beans go in May.</p><p>Thanks</p>", made.ok ? made.draft.body : "");
  check("with its recipient and subject", made.ok && made.draft.kind === "compose" && made.draft.toList[0].email === "bo@havn.example" && made.draft.subject === "Beans");

  const reply = draftFromInbox(
    { from: "ulla.work@kollektiv.example", to: ["bo@havn.example"], body: "Yes.", replyTo: { threadId: "18f2c4a1b", mode: "replyAll" } },
    ACCOUNTS
  );
  check("a reply names its thread and mode, under the mailbox's own spelling",
    reply.ok && reply.draft.kind === "thread" && reply.draft.threadId === "18f2c4a1b" && reply.draft.mode === "replyAll" && reply.draft.account === "Ulla.Work@kollektiv.example");

  const notConnected = draftFromInbox({ from: "someone@else.example", to: ["bo@havn.example"], body: "x" }, ACCOUNTS);
  check("a mailbox not connected here is refused, and the connected ones named",
    !notConnected.ok && notConnected.reason.includes("not connected") && notConnected.reason.includes("ulla@aavang.example"));
  const badAddress = draftFromInbox({ from: "ulla@aavang.example", to: ["not an address"], body: "x" }, ACCOUNTS);
  check("an address that is not one is refused", !badAddress.ok && badAddress.reason.includes("not one"));
  const noBody = draftFromInbox({ from: "ulla@aavang.example", to: ["bo@havn.example"] }, ACCOUNTS);
  check("a draft with no words is refused", !noBody.ok && noBody.reason.includes("body"));
  const replyNoTo = draftFromInbox({ from: "ulla@aavang.example", body: "x", replyTo: { threadId: "1a" } }, ACCOUNTS);
  check("a reply with nobody to go to is refused", !replyNoTo.ok);
  check("a list that is not a list is refused", !draftFromInbox({ from: "ulla@aavang.example", to: 5, body: "x" }, ACCOUNTS).ok);
  check("an array is not a draft", !draftFromInbox([], ACCOUNTS).ok);

  const html = cleanDraftHtml('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">l</a><style>p{}</style>');
  check("HTML loses what could run", !/script|onclick|javascript:|<style/i.test(html) && html.includes("<p>Hi</p>"), html);
  check("text is escaped, not read as HTML", textToDraftHtml("a < b & c") === "<p>a &lt; b &amp; c</p>", textToDraftHtml("a < b & c"));
});
