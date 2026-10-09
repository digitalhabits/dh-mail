/**
 * How many invitations a meeting mail is.
 *
 * One, however many times the event travels with it. A meeting mail carries
 * its event twice — as the `text/calendar` part the message is, and as the
 * `invite.ics` file hung off it — and the reader draws one card from the
 * first and ignores the rest. The count in the header has to agree with the
 * card, or a single acceptance says "2 invites" over a message showing one.
 */

import assert from "node:assert/strict";

import { oneInvitePerMessage } from "@/lib/mail/ics";

const ICS_PART = { mimeType: "text/calendar; method=REPLY", filename: "" };
const ICS_FILE = { mimeType: "application/ics", filename: "invite.ics" };
const PDF = { mimeType: "application/pdf", filename: "programme.pdf" };
const PHOTO = { mimeType: "image/jpeg", filename: "room-three.jpg" };

/** The same event twice is one invitation. */
assert.deepEqual(oneInvitePerMessage([ICS_PART, ICS_FILE]), [ICS_PART]);

/** The first one is the one kept — the same one the card draws. */
assert.deepEqual(oneInvitePerMessage([ICS_FILE, ICS_PART]), [ICS_FILE]);

/** Everything that is not a calendar part is left alone. */
assert.deepEqual(oneInvitePerMessage([PDF, ICS_PART, PHOTO, ICS_FILE]), [
  PDF,
  ICS_PART,
  PHOTO,
]);

/** A mail with no meeting in it is untouched. */
assert.deepEqual(oneInvitePerMessage([PDF, PHOTO]), [PDF, PHOTO]);

/** Nothing at all is nothing at all, however it is said. */
assert.deepEqual(oneInvitePerMessage([]), []);
assert.deepEqual(oneInvitePerMessage(undefined), []);
