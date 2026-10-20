/**
 * Mail HTML that is handled in the app's own page, not in a message frame.
 *
 * Three places did this with `innerHTML` on an element of the page: the
 * signature trimmed off a reply for Outlook (outlook-compose.ts), the
 * editor's paragraphs restated for a mail (client-email-html.ts), and the
 * signature preview (signature-view.tsx). A reply holds the quoted
 * original, which is somebody else's HTML. Built in the page, a picture in
 * it starts to load and its `onerror` runs before any code looks at it.
 *
 * The first two now build in an inert document (inert-html.ts). The third
 * cleans the signature first (sanitizeHtmlForPage). These checks hold them
 * to that: while each one runs, the page's document refuses to make an
 * element at all.
 *
 * Every name, address and word is invented.
 */

import { Window } from "happy-dom";

import { inertHtmlBody } from "@/lib/inert-html";
import { coalesceQuillEmailParagraphs } from "@/lib/client-email-html";
import { sanitizeHtmlForPage } from "@/lib/mail/email-allowlist";
import { withoutTrailingSignature } from "@/lib/mail/outlook-compose";

import { check, suite } from "./harness.mjs";

const win = new Window();
for (const key of ["window", "document", "DOMParser", "Node", "NodeFilter"]) {
  globalThis[key] = key === "window" ? win : win[key];
}

const HOSTILE_QUOTE =
  '<blockquote class="gmail_quote"><p>Two bits of good news.</p>' +
  '<img src="https://beacon.test/opened.png" onerror="window.dhprobeRan = 1"></blockquote>';

/** Run `work` while the page's document refuses to make elements. */
function withPageClosed(work) {
  const real = win.document.createElement;
  let asked = 0;
  win.document.createElement = () => {
    asked += 1;
    throw new Error("an element was made in the page");
  };
  try {
    return { value: work(), asked };
  } finally {
    win.document.createElement = real;
  }
}

suite(async () => {
  {
    const body = inertHtmlBody(HOSTILE_QUOTE);
    check("the inert body is not in the page's document", body.ownerDocument !== win.document);
    check("and nothing of it reached the page", win.document.querySelectorAll("img, blockquote").length === 0);
    check("but it holds the markup to read", body.querySelector("img")?.getAttribute("src") === "https://beacon.test/opened.png");
  }

  {
    const signature = "Ada Lind\nChoir secretary";
    const { value, asked } = withPageClosed(() =>
      withoutTrailingSignature(
        {
          html: `<p>Yes, Thursday works.</p>${HOSTILE_QUOTE}<p>Ada Lind</p><p>Choir secretary</p>`,
          text: `Yes, Thursday works.\n\n> Two bits of good news.\n\n${signature}`,
        },
        signature
      )
    );
    check("trimming a signature for Outlook makes no element in the page", asked === 0, `asked ${asked} times`);
    check("and the signature still comes off", !value.html.includes("Choir secretary"), value.html);
    check("and the quote stays as it was", value.html.includes("gmail_quote") && value.html.includes("Two bits of good news."), value.html);
  }

  {
    const { value, asked } = withPageClosed(() =>
      coalesceQuillEmailParagraphs(`<p>Hello all,</p><p><br></p><ul><li>Bring a lamp</li></ul>${HOSTILE_QUOTE}`)
    );
    check("restating the editor's paragraphs makes no element in the page", asked === 0, `asked ${asked} times`);
    check("and the paragraphs are still restated", /<p style="[^"]*">Hello all,<\/p>/.test(value) && value.includes("Bring a lamp"), value);
  }

  {
    const out = sanitizeHtmlForPage(
      '<p class="ql-align-center fixed inset-0 z-50" id="app">Ada Lind</p>' +
        '<p><a href="https://choir.example/">choir.example</a> · <a href="javascript:alert(1)">tap</a></p>' +
        '<style>body{display:none}</style><img src="x" onerror="alert(2)"><script>alert(3)</script>' +
        '<p><strong>Thursdays</strong> <span style="color:#666">7 pm</span></p>'
    );
    check("a signature for the page loses its scripts and handlers", !/<script|onerror|javascript:/i.test(out), out);
    check("and its style blocks, which would style the app", !/<style/i.test(out), out);
    check("and every id and class but the editor's own", !/id=|fixed|inset-0|z-50/.test(out) && out.includes('class="ql-align-center"'), out);
    check("and keeps its links, words and inline styles", out.includes('href="https://choir.example/"') && out.includes("<strong>Thursdays</strong>") && out.includes("color:#666"), out);
    check("a picture with no allowed address keeps no address", !/src="x"/.test(out), out);
  }
});
