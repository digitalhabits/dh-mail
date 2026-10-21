/**
 * What Mail says about a draft another program made (lib/mail/agent-drafts):
 * every connected mailbox may have one, hidden or not, and the fingerprint
 * changes with what would go out and with nothing else. Addresses and
 * words are invented.
 */

import { connectedAccountEmails, draftFingerprint, draftPreview, sendRecipients } from "@/lib/mail/agent-drafts";
import { draftFromInbox } from "@/lib/mail/drafts-inbox";

import { check, suite } from "./harness.mjs";

const draft = (over = {}) => ({
  key: "compose:1",
  kind: "compose",
  from: "ulla@aavang.example",
  subject: "Beans",
  body: "<p>Hi Bo,</p><p><br></p><p>The beans go in May.</p>",
  toList: [{ kind: "email", email: "Bo@havn.example" }],
  ccList: [],
  bccList: [],
  showCc: false,
  showBcc: false,
  includeSignature: true,
  attachments: [],
  updatedAt: 1,
  ...over,
});

suite(async () => {
  // The store's rows, a hidden mailbox among them.
  const rows = [
    { email: "ulla@aavang.example", inMailTab: true },
    { email: "Ulla@Hidden.example", inMailTab: false },
    { email: "ulla@aavang.example", inMailTab: true },
  ];
  const accounts = connectedAccountEmails(rows);
  check("every connected mailbox, the hidden one too, once each", accounts.join() === "ulla@aavang.example,ulla@hidden.example", accounts.join());
  const fromHidden = draftFromInbox({ from: "ulla@hidden.example", to: ["bo@havn.example"], body: "Hi" }, accounts);
  check("so a draft from a hidden mailbox is made", fromHidden.ok);
  check("and nothing is accepted from a list that has not loaded", !draftFromInbox({ from: "ulla@hidden.example", to: ["bo@havn.example"], body: "Hi" }, []).ok);

  const base = draftFingerprint(draft());
  check("the fingerprint is the same for the same draft", base === draftFingerprint(draft({ updatedAt: 99 })));
  check("an editor that only rewrites the HTML does not change it",
    base === draftFingerprint(draft({ body: '<p style="margin:0">Hi Bo,</p><p><br></p><p>The beans go in May.</p>' })));
  check("other words change it", base !== draftFingerprint(draft({ body: "<p>Hi Bo,</p><p>The peas go in May.</p>" })));
  check("another recipient changes it", base !== draftFingerprint(draft({ ccList: [{ kind: "email", email: "kim@havn.example" }] })));
  check("another subject changes it", base !== draftFingerprint(draft({ subject: "Peas" })));
  check("a file changes it", base !== draftFingerprint(draft({ attachments: [{ id: "a", filename: "plan.pdf", mimeType: "application/pdf", size: 10, progress: null, contentBase64: "AA" }] })));

  const list = { kind: "list", listId: "l1", name: "Gardeners", sendAsBcc: true, members: [{ email: "ida@have.example" }, { email: "bo@havn.example" }] };
  const sent = sendRecipients(draft({ toList: [{ kind: "email", email: "Bo@havn.example" }, list] }));
  check("a list sent as Bcc goes in Bcc, an address once only", sent.to.join() === "bo@havn.example" && sent.bcc.join() === "ida@have.example", JSON.stringify(sent));

  const reply = draftPreview(
    { ...draft(), kind: "thread", account: "ulla@aavang.example", fromAccount: "ulla@aavang.example", threadId: "t1", mode: "reply", subject: undefined, editRecipients: false, replyFocus: false },
    "Beans"
  );
  check("a reply's preview says Re: and the thread's subject", reply.subject === "Re: Beans" && reply.threadId === "t1", reply.subject);
  check("the body is shown as text, a blank line between paragraphs", draftPreview(draft()).body === "Hi Bo,\n\nThe beans go in May.", JSON.stringify(draftPreview(draft()).body));
});
