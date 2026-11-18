/**
 * An Exchange forward names the mail it was made from.
 *
 * With no such header lines, an Exchange server files a forward by its
 * subject. When the same mail went to three organisations, a forward of
 * the first showed in the conversation with the third. The people and ids
 * here are invented.
 */

import assert from "node:assert/strict";

import { forwardLinkHeaders } from "@/lib/mail/forwarded-message";
import { withForwardLink } from "@/lib/mail/inbox-send";

const pass = (line) => console.log(`PASS  ${line}`);

const forward = (extra = {}) => ({
  fromName: "Ida Holm",
  fromEmail: "ida@aavang.example",
  date: "16 Nov, 14.48",
  subject: "Course at Aavang",
  to: ["sven@north.example"],
  text: "Dear Sven",
  ...extra,
});

assert.deepEqual(forwardLinkHeaders(forward({ rfcMessageId: "<a1@aavang.example>" })), {
  inReplyTo: "<a1@aavang.example>",
  references: "<a1@aavang.example>",
});
pass("a forward names the mail it was made from");

assert.deepEqual(
  forwardLinkHeaders(forward({ rfcMessageId: " <a3@aavang.example> ", references: "<a1@aavang.example>\r\n <a2@north.example> <a3@aavang.example>" })),
  { inReplyTo: "<a3@aavang.example>", references: "<a1@aavang.example> <a2@north.example> <a3@aavang.example>" }
);
pass("the earlier mails go first, each one time, on one line");

assert.equal(forwardLinkHeaders(forward()), null);
assert.equal(forwardLinkHeaders(forward({ rfcMessageId: "a1@aavang.example" })), null);
assert.equal(forwardLinkHeaders(forward({ rfcMessageId: "<a1@aavang.example>\r\nBcc: eve@else.example" })), null);
pass("no id, or something that is not an id, gives no header lines");

const sent = withForwardLink({ forward: forward({ rfcMessageId: "<a1@aavang.example>" }), subject: "Fwd: Course at Aavang" });
assert.equal(sent.inReplyTo, "<a1@aavang.example>");
assert.equal(sent.references, "<a1@aavang.example>");
assert.equal(sent.subject, "Fwd: Course at Aavang");
pass("a forward that is sent carries the lines");

const reply = { inReplyTo: "<b1@north.example>", references: "<b1@north.example>", subject: "Re: Course" };
assert.equal(withForwardLink(reply), reply);
const named = { forward: forward({ rfcMessageId: "<a1@aavang.example>" }), inReplyTo: "<b1@north.example>" };
assert.equal(withForwardLink(named), named);
const plain = { forward: forward() };
assert.equal(withForwardLink(plain), plain);
pass("a reply, a message that names a mail already, and a forward with no id are left as they are");
