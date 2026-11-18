/**
 * A "sending" bubble goes away when the sent copy arrives.
 *
 * The sent copy can have a signature between the words and the history. A
 * short reply then did not match, and the reply showed two times. The
 * people here are invented.
 */

import assert from "node:assert/strict";

import { mergeNewestThreadPage } from "@/components/mail/thread-messages";

const pass = (line) => console.log(`PASS  ${line}`);

const NOW = Date.UTC(2026, 10, 18, 13, 32);
const at = (ms) => new Date(ms).toISOString();
const HISTORY = "On Wed, 18 Nov 2026 at 12.15, Lone Holm <lone@home.example> wrote:\n> Will you print chapter 3?";
const SIGNATURE = "Ida Holm\nAssociate Professor\nAavang University";

const first = { id: "m1", fromName: "Lone Holm", fromEmail: "lone@home.example", toEmails: [], ccEmails: [], sentAt: at(NOW - 3_600_000), bodyText: "Will you print chapter 3?", own: false };
const bubble = (words, extra = {}) => ({
  id: "local-1", fromName: "You", fromEmail: "ida@aavang.example", toEmails: [], ccEmails: [], sentAt: at(NOW),
  bodyText: `${words}\n\n${HISTORY}`, own: true, localOwnText: words, ...extra,
});
const sent = (text, extra = {}) => ({
  id: "m2", fromName: "Ida Holm", fromEmail: "ida@aavang.example", toEmails: [], ccEmails: [], sentAt: at(NOW + 20_000), bodyText: text, own: true, ...extra,
});
const ids = (thread) => thread.messages.map((m) => m.id);
const merged = (local, real) =>
  mergeNewestThreadPage({ messages: [first, local], hasOlder: false }, { messages: real ? [first, real] : [first], hasOlder: false });

const WORDS = "Yes, I will do that tomorrow.";

assert.deepEqual(ids(merged(bubble(WORDS), null)), ["m1", "local-1"]);
pass("the bubble stays while the sent copy is not there");

assert.deepEqual(ids(merged(bubble(WORDS), sent(`${WORDS}\n\n${SIGNATURE}\n\n${HISTORY}`))), ["m1", "m2"]);
pass("a short reply with a signature shows one time");

assert.deepEqual(ids(merged(bubble("Ok"), sent(`Ok\n\n${SIGNATURE}\n\n${HISTORY}`))), ["m1", "m2"]);
pass("a reply of one word with a signature shows one time");

assert.deepEqual(ids(merged(bubble(WORDS), sent(`${WORDS}\n\n${HISTORY}`))), ["m1", "m2"]);
pass("a reply with no signature shows one time, as before");

assert.deepEqual(ids(merged(bubble(WORDS), sent(`No, not this week.\n\n${SIGNATURE}`))), ["m1", "m2", "local-1"]);
pass("another message of the reader does not take the bubble away");

assert.deepEqual(ids(merged(bubble(WORDS), sent(`${WORDS}\n\n${SIGNATURE}`, { own: false }))), ["m1", "m2", "local-1"]);
pass("a message from another person does not take the bubble away");

assert.deepEqual(ids(merged(bubble(WORDS), sent(`${WORDS}\n\n${SIGNATURE}`, { sentAt: at(NOW - 3_600_000) }))), ["m1", "m2", "local-1"]);
pass("an old message with the same words does not take the bubble away");
