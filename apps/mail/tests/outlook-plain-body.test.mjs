/**
 * The words handed to Outlook in a mailto: body.
 *
 * The composer writes "&" as "&amp;", and a short plain reply rides to
 * Outlook in the URL as text. The text is read out of the HTML, and once
 * it kept the entity: Outlook opened on "colleges &amp; departments". Both
 * readings of the HTML — through the DOM in the app, by string outside it —
 * must give the words back.
 */

import { Window } from "happy-dom";

import { htmlToPlainText } from "@/lib/client-email-html";
import { outlookComposeUrl } from "@/lib/mail/outlook-compose";

import { check, suite } from "./harness.mjs";

const html =
  '<p style="margin:0">Hi Hattie,</p><p style="margin:0"><br></p>' +
  '<p style="margin:0">colleges &amp; departments 29-30 Sept &lt;Linacre&gt;<br>see you</p>';
const words = "Hi Hattie,\n\ncolleges & departments 29-30 Sept <Linacre>\nsee you";

suite(async () => {
  const outside = htmlToPlainText(html);
  check("without a DOM, an entity in a paragraph is a character", outside === words, outside);

  const window = new Window();
  globalThis.document = window.document;
  globalThis.DOMParser = window.DOMParser;
  globalThis.Node = window.Node;
  const inside = htmlToPlainText(html);
  check("with a DOM, an entity in a paragraph is a character", inside === words, inside);

  const url = outlookComposeUrl({ to: ["h@example.com"], subject: "Re: x", body: inside });
  check(
    "the mailto: body carries the ampersand percent-encoded, not as an entity",
    url.includes("colleges%20%26%20departments") && !url.includes("%26amp%3B"),
    url
  );
});
