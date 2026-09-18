/**
 * Which links the reader is allowed to paint.
 *
 * Every link in an email becomes a span before the parser runs, so that an
 * `<a>` wrapping a table survives (HTML5 forbids it, and the parser would
 * hoist the table out and leave the button dead). The cost is that a span
 * inherits: a link the sender never styled came out with no colour and no
 * underline, and read as ordinary words — which is how a Zoom link pasted
 * into a message ended up looking like text.
 *
 * So a link the sender dressed keeps what it was given, and one they left
 * alone is marked here and painted by the frame's own stylesheet. Getting
 * that the wrong way round turns a "View message" button into teal
 * underlined text on its own background.
 */

import assert from "node:assert/strict";

import { softenAnchorsForParse } from "@/lib/mail/soften-anchors";
import { check, suite } from "./harness.mjs";

const PLAIN = "data-dh-plain";

suite(async () => {
  // ---- Undressed links: ours to paint --------------------------------------
  {
    const out = softenAnchorsForParse('<a href="https://example.org">read</a>');
    check("a link becomes a span, keeping its address", out.includes('data-dh-href="https://example.org"'), out);
    check("and is marked as one nobody styled", out.includes(PLAIN), out);
    check("the closing tag closes the span", out.includes("</span>"), out);
  }

  // A target or rel says nothing about how it looks.
  check(
    "attributes that are not styling still leave it plain",
    softenAnchorsForParse(
      '<a href="https://example.org" target="_blank" rel="noopener">read</a>'
    ).includes(PLAIN)
  );

  // ---- Dressed links: the sender's, left alone ------------------------------
  check(
    "a link with its own colour is left alone",
    softenAnchorsForParse(
      '<a href="https://x.example" style="color:#fff">View message</a>'
    ).includes(PLAIN) === false
  );
  check(
    "a link with a class the sender styles is left alone",
    softenAnchorsForParse(
      '<style>.btn{color:#fff;background:#0a0}</style><a href="https://x.example" class="btn">Go</a>'
    ).includes(PLAIN) === false
  );
  // Ryanair names every link with a class and styles none of them; the
  // class is a name, not a dress, and the link must still look like one.
  check(
    "a link with a class nothing styles is painted",
    softenAnchorsForParse(
      '<style>.other{color:red}</style><a href="https://x.example" class="ry-link-49">here</a>'
    ).includes(PLAIN)
  );
  check(
    "and so is one with a class and no stylesheet at all",
    softenAnchorsForParse('<a href="https://x.example" class="btn">Go</a>').includes(
      PLAIN
    )
  );

  // `data-style` is not `style` — a stray prefix must not count as dressing.
  check(
    "an attribute that merely ends in style does not count as styling",
    softenAnchorsForParse(
      '<a href="https://x.example" data-style="x">Go</a>'
    ).includes(PLAIN)
  );

  // ---- The sender does not get to choose ------------------------------------
  // Painting is the reader's call: a button that asked to be drawn as plain
  // text would be reaching into the interface around it.
  {
    const out = softenAnchorsForParse(
      `<a href="https://x.example" ${PLAIN}="" style="color:#fff">Go</a>`
    );
    check(
      "a sender's own plain marker is dropped from a dressed link",
      out.includes(PLAIN) === false,
      out
    );
  }
  {
    const out = softenAnchorsForParse(
      '<a href="https://x.example" data-dh-href="javascript:alert(1)">Go</a>'
    );
    check(
      "and a sender's own href attribute cannot ride along",
      !out.includes("javascript:alert(1)"),
      out
    );
  }

  // ---- Text is untouched ----------------------------------------------------
  assert.equal(
    softenAnchorsForParse("<p>No links at all</p>"),
    "<p>No links at all</p>"
  );
});
