/**
 * A draft that was only opened keeps its place in the Drafts list.
 *
 * Opening a draft writes it back, because the composer filling its fields
 * counts as a change. Every save stamped the draft with the time, so the
 * list, newest first, moved a draft to the top when it was only looked at.
 * A save now happens only when the draft says something different.
 */

import { sameDraftContent } from "@/lib/mail/local-drafts";

import { check, suite } from "./harness.mjs";

/** An invented new-message draft. */
function draft(over = {}) {
  return {
    key: "compose:1",
    kind: "compose",
    from: "vera@example.com",
    subject: "Hello",
    body: "<p>Hi Otto,</p>",
    toList: [{ kind: "email", email: "otto@example.org", name: "Otto" }],
    ccList: [],
    bccList: [],
    showCc: false,
    showBcc: false,
    includeSignature: true,
    attachments: [],
    updatedAt: 1000,
    ...over,
  };
}

suite(async () => {
  check("the time alone is no change", sameDraftContent(draft(), draft({ updatedAt: 99999 })));

  // The same fields written in another order are the same draft.
  const reordered = Object.fromEntries(Object.entries(draft()).reverse());
  check("key order is no change", sameDraftContent(draft(), reordered));

  check("a word in the body is a change", !sameDraftContent(draft(), draft({ body: "<p>Hi Otto!</p>" })));
  check("a new recipient is a change", !sameDraftContent(draft(), draft({ ccList: [{ kind: "email", email: "ada@example.org", name: "" }] })));
  check("a new subject is a change", !sameDraftContent(draft(), draft({ subject: "Hello again" })));
  // What only the composer or the markup changes is no change.
  check("markup alone is no change", sameDraftContent(draft(), draft({ body: "<div>Hi   Otto,</div>" })));
  check("the Cc row showing is no change", sameDraftContent(draft(), draft({ showCc: true })));
  check("a field an older version wrote is no change", sameDraftContent(draft(), draft({ chatStyle: false })));
  check("the case of an address is no change", sameDraftContent(draft(), draft({ toList: [{ kind: "email", email: "OTTO@example.org" }] })));
  const reply = {
    key: "thread:vera@example.com:t1", kind: "thread", account: "vera@example.com", threadId: "t1",
    mode: "reply", body: "<p>Thanks!</p>", toList: [], ccList: [], showCc: false, editRecipients: false,
    includeSignature: true, fromAccount: "vera@example.com", replyFocus: false, attachments: [], updatedAt: 1,
  };
  check("a reply's caret is no change", sameDraftContent(reply, { ...reply, caret: 7, replyFocus: true }));
  check("a reply's words are a change", !sameDraftContent(reply, { ...reply, body: "<p>Thanks a lot!</p>" }));
  check("a new file is a change", !sameDraftContent(draft(), draft({ attachments: [{ id: "a", filename: "plan.pdf", mimeType: "application/pdf", size: 10, progress: null, contentBase64: "" }] })));
  // The handover to Outlook is written through the same save, so it must count.
  check("a handover is a change", !sameDraftContent(draft(), draft({ handedOver: { at: 5, account: "vera@example.com" } })));
});
