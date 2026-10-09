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
