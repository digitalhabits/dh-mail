/**
 * The name on the mail we send.
 *
 * Gmail sends the `From` header we write, and we wrote the bare address — so
 * mail from this app arrived headed `ulrik@example.org` while the same
 * person's mail from Gmail's own page arrived headed with their name. The
 * name comes from their provider, where they already set it.
 */

import {
  SENDER_NAME_TTL_MS,
  cleanDisplayName,
  formatFromHeader,
  pickNameFromSentMail,
  pickSendAsName,
  senderNameIsStale,
} from "@/lib/mail/sender-name";

import { check, suite } from "./harness.mjs";

const me = "ulrik@example.org";

suite(async () => {
  // --- The header ----------------------------------------------------------

  check(
    "a name is quoted beside the address",
    formatFromHeader(me, "Vera Holm") === `"Vera Holm" <${me}>`
  );
  check(
    "no name leaves the bare address, the way it sent before",
    formatFromHeader(me, "") === me
  );
  check("and so does a missing one", formatFromHeader(me) === me);
  // Gmail hands back the address as the display name for addresses whose
  // name was never set. Writing it twice says nothing twice.
  check(
    "a name that is only the address again is dropped",
    formatFromHeader(me, me) === me
  );
  check(
    "whatever its capitals",
    formatFromHeader(me, me.toUpperCase()) === me
  );

  // The quotes are what a comma needs: unquoted, it would end the address and
  // start a second recipient.
  check(
    "a comma in a name is safely inside the quotes",
    formatFromHeader(me, "Holm, Vera") === `"Holm, Vera" <${me}>`
  );
  check(
    "a quotation mark in a name is escaped",
    formatFromHeader(me, 'Vera "Vee" Holm') ===
      `"Vera \\"Vee\\" Holm" <${me}>`
  );

  // --- Names that are not ASCII --------------------------------------------
  //
  // An encoded word may not be quoted: a client reading `"=?UTF-8?B?...?="`
  // shows the raw letters instead of the name.

  const danish = formatFromHeader(me, "Vera Holmø");
  check(
    "a non-ASCII name travels as an encoded word",
    danish.startsWith("=?UTF-8?B?") && danish.endsWith(`?= <${me}>`)
  );
  check("and is not quoted", danish.includes('"') === false);

  // --- Nothing that would break the header ---------------------------------
  //
  // A newline ends the header and starts whatever comes next — the oldest way
  // there is of adding a Bcc to somebody else's mail.

  const injected = formatFromHeader(me, "Vera\r\nBcc: thief@example.com");
  check("a newline in a name cannot end the header", !/[\r\n]/.test(injected));
  check(
    "and what followed it stays inside the name",
    injected === `"Vera Bcc: thief@example.com" <${me}>`
  );
  check(
    "a tab is folded away too",
    cleanDisplayName("Vera\tHolm") === "Vera Holm"
  );
  check(
    "runs of space become one",
    cleanDisplayName("  Vera   Holm  ") === "Vera Holm"
  );

  // --- Which of their addresses ---------------------------------------------

  const sendAs = [
    { sendAsEmail: "work@example.com", displayName: "V. Holm", isDefault: true },
    { sendAsEmail: me, displayName: "Vera Holm" },
  ];
  check(
    "the name for the address we send from",
    pickSendAsName(sendAs, me) === "Vera Holm"
  );
  check(
    "matched whatever its capitals",
    pickSendAsName(sendAs, me.toUpperCase()) === "Vera Holm"
  );
  // Gmail itself falls back to the default, so we do too.
  check(
    "an address that is not listed falls back to the default",
    pickSendAsName(sendAs, "other@example.com") === "V. Holm"
  );
  check("nothing listed is no name", pickSendAsName([], me) === "");
  check("and neither is no answer at all", pickSendAsName(undefined, me) === "");

  // --- The name Gmail wrote on their own sent mail ---------------------------
  //
  // An address set to "use the account name" has no name in the send-as list:
  // Gmail adds it only to mail Gmail builds. That mail is in their Sent folder.

  check(
    "a quoted name on their own sent mail is the name",
    pickNameFromSentMail([`"Vera Holm" <${me}>`], me) === "Vera Holm"
  );
  check(
    "so is an unquoted one",
    pickNameFromSentMail([`Vera Holm <${me}>`], me) === "Vera Holm"
  );
  check(
    "mail this app sent with the bare address says nothing",
    pickNameFromSentMail([me, me, `Vera Holm <${me}>`], me) === "Vera Holm"
  );
  check(
    "only bare addresses is no name, the way it sent before",
    pickNameFromSentMail([me, `<${me}>`], me) === ""
  );
  check(
    "a name that is only the address again is no name",
    pickNameFromSentMail([`"${me}" <${me}>`], me) === ""
  );
  check(
    "mail sent as another of their addresses does not count",
    pickNameFromSentMail([`"V. Holm" <work@example.com>`], me) === ""
  );
  check(
    "the address is matched whatever its capitals",
    pickNameFromSentMail([`Vera Holm <${me.toUpperCase()}>`], me) === "Vera Holm"
  );
  check(
    "one odd client cannot rename them",
    pickNameFromSentMail(
      [`vera <${me}>`, `Vera Holm <${me}>`, `Vera Holm <${me}>`],
      me
    ) === "Vera Holm"
  );
  check(
    "on a tie the newest wins",
    pickNameFromSentMail([`V. Holm <${me}>`, `Vera Holm <${me}>`], me) === "V. Holm"
  );
  check(
    "a non-ASCII name arrives decoded",
    pickNameFromSentMail([`=?UTF-8?B?VmVyYSBIb2xtw7g=?= <${me}>`], me) === "Vera Holmø"
  );
  check(
    "a newline in a sent name cannot reach our header",
    pickNameFromSentMail([`"Vera\r\nBcc: thief@example.com" <${me}>`], me) ===
      "Vera Bcc: thief@example.com"
  );
  check("nothing sent is no name", pickNameFromSentMail([], me) === "");

  // --- Asking again ---------------------------------------------------------

  const now = 1_700_000_000_000;
  check("never asked is stale", senderNameIsStale(undefined, now) === true);
  check("just asked is not", senderNameIsStale(now - 1000, now) === false);
  check(
    "a day later is",
    senderNameIsStale(now - SENDER_NAME_TTL_MS, now) === true
  );
  // A clock that has gone backwards must not freeze the name forever.
  check(
    "a time in the future is treated as stale",
    senderNameIsStale(now + 60_000, now) === true
  );
});
