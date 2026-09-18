/**
 * A picture written into a message, on its way out.
 *
 * The composer can only hold one as a `data:` URI — it has no server to put
 * bytes on. That is not what may be sent: Gmail's web client and Outlook both
 * refuse to draw a `data:` image, so a message sent that way arrives with a
 * hole in it, and the sender reading their own copy here sees it perfectly.
 *
 * So each one is lifted out and sent as its own part, referred to by `cid:`.
 * Getting that wrong is invisible from this side — the send succeeds, and
 * only the recipient sees the broken image — which is what this suite is for.
 */

import assert from "node:assert/strict";

import { extractInlineImages } from "@/lib/mail/inline-images";
import { bodyToEmailHtml } from "@/lib/client-email-html";
import { check, suite } from "./harness.mjs";

// A one-pixel PNG. Invented, like everything else in these suites.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

suite(async () => {
  // ---- Nothing to lift ------------------------------------------------------
  {
    const html = "<p>No pictures here at all.</p>";
    const out = extractInlineImages(html);
    check("a body with no picture comes back as it went in", out.html === html);
    check("and carries none", out.images.length === 0);
  }

  // ---- One picture ----------------------------------------------------------
  {
    const html = `<p>Look:</p><p><img src="data:image/png;base64,${PNG}"></p>`;
    const { html: out, images } = extractInlineImages(html);

    check("the picture is lifted out", images.length === 1, images.length);
    check("as its own bytes, with the data: prefix gone",
      images[0].contentBase64 === PNG, images[0].contentBase64.slice(0, 24));
    check("keeping what kind of picture it is", images[0].mimeType === "image/png");
    check("named by what it is", images[0].filename.endsWith(".png"), images[0].filename);

    // The half that actually makes it render: the body has to point at it.
    check("the body refers to it by cid",
      out.includes(`src="cid:${images[0].contentId}"`), out);
    check("and no data: URI is left in the body", !out.includes("data:image"), out);
  }

  // ---- Two pictures ---------------------------------------------------------
  {
    const html =
      `<p><img src="data:image/png;base64,${PNG}"></p>` +
      `<p><img src="data:image/gif;base64,${PNG}"></p>`;
    const { html: out, images } = extractInlineImages(html);
    check("both are lifted", images.length === 2);
    check(
      "and given ids of their own — one id for two pictures shows the same one twice",
      images[0].contentId !== images[1].contentId,
      `${images[0].contentId} / ${images[1].contentId}`
    );
    check("each is referred to", images.every((i) => out.includes(`cid:${i.contentId}`)));
    check("the second keeps its own kind", images[1].mimeType === "image/gif");
  }

  // ---- An id nothing about the sender travels in ----------------------------
  {
    const { images } = extractInlineImages(
      `<img src="data:image/png;base64,${PNG}">`
    );
    check(
      "the content id carries no address and no name",
      !/@/.test(images[0].contentId) && /^dh-inline-/.test(images[0].contentId),
      images[0].contentId
    );
  }

  // ---- A src that is not a picture -----------------------------------------
  {
    const html = '<img src="data:image/png;base64,">';
    const { html: out, images } = extractInlineImages(html);
    check("an empty src is not lifted", images.length === 0);
    check("and is left exactly as it was", out === html);
  }

  // ---- Held to the width of a message --------------------------------------
  {
    const sized = bodyToEmailHtml(
      `<p><img src="data:image/png;base64,${PNG}"></p>`
    );
    check(
      "a pasted picture is held to the body width",
      sized.includes('width="600"'),
      sized
    );
    check(
      "and to the window, for a client that reads CSS",
      sized.includes("max-width:100%"),
      sized
    );
    check("without being squashed", sized.includes("height:auto"));
  }

  /*
   * The two together, in the order they actually run.
   *
   * The composer sizes the picture on the way out of the editor; the server
   * lifts it out on the way into the message. The sizing leaves a `style`
   * and a `width` on the tag, and the lifting has to still find the `src`
   * among them — a regex that assumed `src` came last would pass every test
   * above and fail on every real message.
   */
  {
    const composed = bodyToEmailHtml(
      `<p>Here it is:</p><p><img src="data:image/png;base64,${PNG}"></p>`
    );
    const { html, images } = extractInlineImages(composed);
    check("the sized picture is still found", images.length === 1, composed);
    check("it goes out as cid", html.includes(`cid:${images[0].contentId}`), html);
    check("and keeps the width it was given", html.includes('width="600"'), html);
    check("with nothing left to download twice", !html.includes("data:image"), html);
  }

  // A picture that already says how wide it is — a signature's logo — keeps
  // what whoever wrote it gave it.
  {
    const sized = bodyToEmailHtml('<p><img src="https://x.example/logo.png" width="80"></p>');
    check(
      "a picture that already has a width is left alone",
      sized.includes('width="80"') && !sized.includes('width="600"'),
      sized
    );
  }
});
