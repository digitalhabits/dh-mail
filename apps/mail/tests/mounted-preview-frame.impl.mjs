/**
 * The walk itself — see mounted-preview-frame.test.mjs.
 *
 * Two claims, in this order.
 *
 * First, what `sanitizeEmailHtml` lets through. It is a blocklist, and it
 * names neither `style` nor `svg` nor `math`. The reader can carry that,
 * because its frame answers to `default-src 'none'`. These checks record
 * the gap rather than close it: a sender's `style` block is part of how
 * mail looks, and the reader must go on showing it. If one of them fails
 * because the sanitizer became stricter, that is good news. Read the new
 * output and write the line again.
 *
 * Second, where that output is allowed to land. The send preview showed it
 * in the app's own document. A stylesheet there is not decoration: it reads
 * the page with attribute selectors and it fetches what it likes. Measured
 * in WebKit on 2026-09-20, a mail with
 * `input[value^="a"]{border-image:url(...)}` in a `style` block made the
 * page fetch that address, one letter at a time, and `body *{visibility:
 * hidden}` emptied the window. The same document holds the Tauri bridge.
 *
 * Every fixture is invented.
 */

import * as React from "react";
import { createRoot } from "react-dom/client";

import { setMailApiTransport } from "@/lib/mail/api";
import { sanitizeEmailHtml } from "@/lib/mail/email-html";
import { SentPreview } from "@/components/mail/composer-preview";

import { check, suite } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A word that belongs to no fixture but this suite.
 *
 * Every check below asks whether markup carrying it reached the page, so it
 * must not be a word the app itself writes.
 */
const MARK = "dhprobe";

/**
 * Four messages nobody sent.
 *
 * Each one opens with a line of text, so that the trimmer which takes blank
 * rows off the two edges of a message has something to stop at and leaves
 * the payload where the sender put it.
 */
const HOSTILE = {
  svg:
    "<p>Two bits of good news.</p>" +
    `<svg data-${MARK}="svg" width="12" height="12">` +
    `<circle cx="6" cy="6" r="5" onload="window.dhprobeRan = 'svg'"></circle>` +
    "</svg>",
  style:
    "<p>Two bits of good news.</p>" +
    `<style data-${MARK}="style">p{background:url("//beacon.test/opened.png")}` +
    `body *{visibility:hidden}</style>`,
  math:
    "<p>Two bits of good news.</p>" +
    `<math data-${MARK}="math"><mtext><mglyph><style><!--</style>` +
    `<img title="--><img src=x onerror='window.dhprobeRan = 1'>"></mglyph>` +
    "</mtext></math>",
  // The shape the 2.0.0 bypass of a well-known sanitizer used: markup that
  // parses one way, serializes, and parses a second way as something else.
  mutation:
    "<p>Two bits of good news.</p>" +
    "<form><math><mtext></form><form><mglyph><style></math>" +
    `<img src onerror="window.dhprobeRan = 1">`,
};

/** The app document only. An iframe keeps its own, and that is the point. */
const inThePage = (selector) => [...document.querySelectorAll(selector)];

const SIGNATURE = {
  signature: "",
  includeOnNew: false,
  onReplies: "never",
};

setMailApiTransport(async (path) => {
  const json = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (path.startsWith("/api/mail/signature")) return json(SIGNATURE);
  return json({});
});

suite(async () => {
  // --- What the sanitizer lets through ------------------------------------

  const svg = sanitizeEmailHtml(HOSTILE.svg);
  check(
    "an event handler is taken off every element, in SVG as in HTML",
    !/\son[a-z]+\s*=/i.test(svg),
    svg
  );
  check(
    "but the SVG element itself comes through: the list does not name it",
    svg.includes("<svg"),
    svg
  );

  const style = sanitizeEmailHtml(HOSTILE.style);
  check(
    "a sender's style block comes through whole",
    style.includes("<style") && style.includes("visibility:hidden"),
    style
  );

  const math = sanitizeEmailHtml(HOSTILE.math);
  check(
    "a MathML payload comes through, style block and all",
    math.includes("<math") && math.includes("<style"),
    math
  );

  // Parse, serialize, parse. The sanitizer does the first two, and whoever
  // shows the result does the third. What it hands on still holds the words
  // of an event handler, inside an attribute, where only the parser decides
  // whether they are text or markup. Two engines decide differently: WebKit
  // grows a tag on the second parse, happy-dom does not. That is the whole
  // of how a mutation attack works, and it is why the answer here is a
  // frame rather than a cleverer string.
  check(
    "and the handler it carries is still there, for the next parser to read",
    /onerror/i.test(math),
    math
  );

  const mutation = sanitizeEmailHtml(HOSTILE.mutation);
  check(
    "the known mutation string leaves no event handler behind",
    !/onerror/i.test(mutation),
    mutation
  );

  // --- Where that output is allowed to land -------------------------------

  document.body.innerHTML = '<div id="r"></div>';
  const root = createRoot(document.getElementById("r"));
  root.render(
    React.createElement(SentPreview, {
      from: "ulla@aavang.example",
      to: ["dana@example.org"],
      subject: "Two bits of good news",
      // A message written from an earlier one carries that one's markup —
      // see the copy-to-a-new-message path in MailPage.
      bodyHtml: sanitizeEmailHtml(HOSTILE.svg),
      hasBody: true,
      includeSignature: false,
      quote: {
        intro: "On 25 Jul 2026, Dana Fisher <dana@example.org> wrote:",
        text: "Two bits of good news.",
        // The reader sanitizes the quote before the preview sees it.
        html: sanitizeEmailHtml(HOSTILE.style),
      },
      recipientName: "Dana Fisher",
      sending: false,
      canSend: true,
      onSend: () => {},
      onBack: () => {},
    })
  );
  await sleep(200);

  const more = [...document.querySelectorAll("button")].find(
    (b) => (b.textContent || "").trim() === "Show more"
  );
  check("the quote offers to show itself", Boolean(more));
  more?.click();
  await sleep(200);

  check(
    "the sender's markup is no element of the app's own page",
    inThePage(`[data-${MARK}]`).length === 0,
    inThePage(`[data-${MARK}]`)
      .map((el) => el.tagName)
      .join(",")
  );

  check(
    "no stylesheet of the sender's is live in the app's own page",
    !inThePage("style").some((el) => (el.textContent || "").includes("visibility:hidden")),
    inThePage("style").length
  );

  const frames = inThePage("iframe");
  check(
    "the quote is shown in a frame, as the reader shows a message",
    frames.some((f) => (f.getAttribute("srcdoc") || "").includes("visibility:hidden")),
    frames.length
  );
  check(
    "and that frame carries a policy that lets nothing run",
    frames.every((f) => {
      const doc = f.getAttribute("srcdoc") || "";
      return !doc || doc.includes("Content-Security-Policy") && doc.includes("default-src 'none'");
    }),
    frames.map((f) => (f.getAttribute("srcdoc") || "").slice(0, 80)).join(" | ")
  );

  check(
    "nothing the fixtures asked for ran",
    window.dhprobeRan === undefined,
    String(window.dhprobeRan)
  );

  root.unmount();
});
