/**
 * Finding links in the plain text of a message.
 *
 * Both readers use this: the plain-text bubble renders the matches as React
 * anchors, and the HTML reader wraps the same ranges in <a> inside the frame.
 * So a range that is off by one shows up as a broken address in both.
 */

import { findEmailsInText, findLinksInText } from "@/lib/linkify-urls";

import { check, suite } from "./harness.mjs";

/** The matched slice of the text, which is what becomes the link's label. */
function slices(text) {
  return findLinksInText(text).map((m) => text.slice(m.start, m.end));
}

function hrefs(text) {
  return findLinksInText(text).map((m) => m.href);
}

suite(async () => {
  check(
    "a bare address is found",
    slices("write to dana@example.ac.uk today").join("|") === "dana@example.ac.uk",
    slices("write to dana@example.ac.uk today").join("|")
  );

  // The form in the message that prompted this: a display name, then the
  // address in angle brackets.
  const angled = "Dana Fisher <Dana.Fisher@example.org>  Shall I forward it?";
  check(
    "the angle brackets stay outside the link",
    slices(angled).join("|") === "Dana.Fisher@example.org",
    slices(angled).join("|")
  );

  check(
    "the link is a mailto",
    hrefs(angled).join("|") === "mailto:Dana.Fisher@example.org",
    hrefs(angled).join("|")
  );

  check(
    "a multi-part domain keeps its last label",
    slices("a@b.co.uk").join("|") === "a@b.co.uk",
    slices("a@b.co.uk").join("|")
  );

  check(
    "a sentence-ending full stop is not part of the address",
    slices("ask dana@example.org.").join("|") === "dana@example.org",
    slices("ask dana@example.org.").join("|")
  );

  check(
    "plus addressing survives",
    slices("dana+news@example.org").join("|") === "dana+news@example.org"
  );

  check(
    "an explicit mailto: prefix is consumed, not shown twice",
    slices("mailto:dana@example.org").join("|") === "dana@example.org",
    slices("mailto:dana@example.org").join("|")
  );

  // --- Where the two kinds of link meet -----------------------------------

  const inUrl = "see https://example.org/contact/dana@example.org for details";
  check(
    "an address inside a URL path does not split the URL",
    slices(inUrl).join("|") === "https://example.org/contact/dana@example.org",
    slices(inUrl).join("|")
  );

  const both = "https://example.org and dana@example.org";
  check(
    "a URL and an address in one line are both found, in order",
    slices(both).join("|") === "https://example.org|dana@example.org",
    slices(both).join("|")
  );

  check(
    "each kind is labelled",
    findLinksInText(both).map((m) => m.kind).join("|") === "url|email"
  );

  // --- Not addresses ------------------------------------------------------

  check("a bare word with @ is not an address", slices("@ulyngs").length === 0);
  check(
    "a domain with no user part is not an address",
    slices("@example.org").length === 0
  );
  check(
    "an address needs a dotted domain",
    findEmailsInText("dana@localhost").length === 0
  );

  check(
    "text with nothing in it yields nothing",
    findLinksInText("just some words").length === 0
  );
});
