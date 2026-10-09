/**
 * The printed document.
 *
 * `printMailMessages` itself needs a browser — it makes an iframe and calls
 * `print()` on it — so what is checked here is the document it builds. That is
 * where the decisions live: which messages are in it, in which order, what the
 * headers say, and whether a remote image is allowed to load.
 *
 * Messages here carry text bodies. The HTML path hands off to the sanitizer
 * the caller passes in, which in the app is the one the reading pane uses.
 */

import { buildPrintDocument } from "@/components/mail/print-document";
import { MAIL_IMAGE_CSP_SOURCE } from "@/lib/mail/image-proxy";

import { check, suite } from "./harness.mjs";

const ORIGIN = "https://plan.example.org";

/** No message here has an HTML body, so this must never be reached. */
const noSanitize = () => {
  throw new Error("a text body must not go through the sanitizer");
};

function message(overrides = {}) {
  return {
    id: "m1",
    fromName: "Ada Lovelace",
    fromEmail: "ada@example.org",
    toEmails: ["you@example.org"],
    ccEmails: [],
    sentAt: "2026-08-12T09:30:00.000Z",
    bodyText: "The analytical engine.",
    allowRemoteImages: false,
    ...overrides,
  };
}

suite(async () => {
  const one = buildPrintDocument(
    { subject: "Engines", messages: [message()] },
    ORIGIN,
    noSanitize
  );

  check("the subject is the title and the heading", one.includes("<title>Engines</title>") && one.includes("<h1>Engines</h1>"));

  check(
    "a message with no subject still has a title",
    buildPrintDocument({ subject: "  ", messages: [message()] }, ORIGIN, noSanitize).includes(
      "<title>(no subject)</title>"
    )
  );

  check(
    "the sender prints as name and address",
    one.includes("Ada Lovelace &lt;ada@example.org&gt;")
  );

  check("the recipient prints", one.includes("you@example.org"));

  check(
    "an empty Cc is left out rather than printed blank",
    !one.includes(">Cc<")
  );

  check(
    "the date carries the year, which the on-screen stamp drops",
    /2026/.test(one)
  );

  // --- What is allowed to load -------------------------------------------

  check(
    "nothing may run: the policy names no script source",
    one.includes("default-src 'none'") && !one.includes("script-src")
  );

  check(
    "with images off, only data: URIs may load",
    one.includes("img-src data:;")
  );

  const withImages = buildPrintDocument(
    { subject: "Engines", messages: [message({ allowRemoteImages: true })] },
    ORIGIN,
    noSanitize
  );
  // Not a literal: a web host proxies images from its own origin, and the
  // standalone app from its shell's scheme. The document must name whichever
  // one this build uses.
  check(
    "with images on, this build's image proxy may load too",
    withImages.includes(`img-src ${MAIL_IMAGE_CSP_SOURCE} data:;`),
    MAIL_IMAGE_CSP_SOURCE
  );

  const mixed = buildPrintDocument(
    {
      subject: "Engines",
      messages: [
        message({ id: "a", allowRemoteImages: false }),
        message({ id: "b", allowRemoteImages: true }),
      ],
    },
    ORIGIN,
    noSanitize
  );
  check(
    "one sender with images on opens the policy for the document",
    mixed.includes(`img-src ${MAIL_IMAGE_CSP_SOURCE} data:;`)
  );

  // --- Bodies -------------------------------------------------------------

  check(
    "a text body keeps its line breaks",
    one.includes('<pre class="text">The analytical engine.</pre>')
  );

  check(
    "a text body cannot inject markup",
    buildPrintDocument(
      { subject: "x", messages: [message({ bodyText: "<script>bad()</script>" })] },
      ORIGIN,
      noSanitize
    ).includes("&lt;script&gt;bad()&lt;/script&gt;")
  );

  check(
    "a subject cannot inject markup",
    buildPrintDocument(
      { subject: '"><script>bad()</script>', messages: [message()] },
      ORIGIN,
      noSanitize
    ).includes("&quot;&gt;&lt;script&gt;")
  );

  // --- Order --------------------------------------------------------------

  const thread = buildPrintDocument(
    {
      subject: "Engines",
      messages: [
        message({ id: "old", bodyText: "FIRST" }),
        message({ id: "new", bodyText: "SECOND" }),
      ],
    },
    ORIGIN,
    noSanitize
  );
  check(
    "messages print in the order they are given, oldest first",
    thread.indexOf("FIRST") < thread.indexOf("SECOND"),
    `${thread.indexOf("FIRST")} < ${thread.indexOf("SECOND")}`
  );

  check(
    "each message is its own article, so the rule between them prints",
    (thread.match(/<article class="msg">/g) ?? []).length === 2
  );
});
