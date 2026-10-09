/**
 * A sender's signature, shown once a thread: what counts as the signature of
 * a later message from the same person, in text and in HTML.
 *
 * Every name, address and sentence here is invented. See AGENTS.md.
 */

import { Window } from "happy-dom";

import {
  earlierFromSameSender,
  htmlSegments,
  stripRepeatedSignatureHtml,
  stripRepeatedSignatureText,
  textSegments,
} from "@/lib/mail/repeat-signature";

import { check, suite } from "./harness.mjs";

// The functions read the DOM when called, not when imported.
const win = new Window();
globalThis.DOMParser = win.DOMParser;
globalThis.Node = win.Node;

const SIG = "Best,\nAlma Aagaard\nGardens Officer, Rooftop Trust\n+45 11 22 33 44";

suite(async () => {
  // ---- Text ------------------------------------------------------------------
  const first = `Here is the plan.\n\n${SIG}`;
  const second = `Thanks, that works.\n\n${SIG}`;
  check(
    "a later message loses the tail it shares with the earlier one",
    stripRepeatedSignatureText(second, textSegments(first)) === "Thanks, that works.",
    JSON.stringify(stripRepeatedSignatureText(second, textSegments(first)))
  );
  check(
    "one repeated closing line is not a signature",
    stripRepeatedSignatureText("See you then.\nThanks!", textSegments("Great.\nThanks!")) === "See you then.\nThanks!"
  );
  check(
    "a message that is all signature is left whole",
    stripRepeatedSignatureText(SIG, textSegments(first)) === SIG
  );
  check(
    "a \"-- \" line starts the signature even when nothing repeats",
    stripRepeatedSignatureText("Short answer: yes.\n-- \nAlma\nRooftop Trust", textSegments("Something else")) === "Short answer: yes."
  );
  check(
    "different tails are left alone",
    stripRepeatedSignatureText("Yes.\nAlma\nPhone A", textSegments("No.\nBo\nPhone B")) === "Yes.\nAlma\nPhone A"
  );

  // ---- HTML ------------------------------------------------------------------
  const sigHtml = "<div>Best,</div><div>Alma Aagaard</div><div>Gardens Officer, Rooftop Trust</div><div><img src='logo.png'></div>";
  const earlierHtml = `<div>Here is the plan.</div><div><br></div>${sigHtml}`;
  const laterHtml = `<div>Thanks, that works.</div><div><br></div>${sigHtml}`;
  const html = stripRepeatedSignatureHtml(laterHtml, htmlSegments(earlierHtml));
  check("an HTML message loses the repeated blocks", html.changed && html.html.includes("Thanks, that works."), html.html);
  check("and the logo under them", !html.html.includes("logo.png") && !html.html.includes("Gardens Officer"), html.html);
  check("and the blank line before it", html.html === "<div>Thanks, that works.</div>", html.html);

  const gmail = stripRepeatedSignatureHtml(
    "<div>Yes, Thursday.</div><div class=\"gmail_signature\"><div>Alma</div></div>",
    htmlSegments("<div>Unrelated</div>")
  );
  check("a Gmail signature box goes", gmail.changed && !gmail.html.includes("gmail_signature") && gmail.html.includes("Thursday"), gmail.html);

  const outlook = stripRepeatedSignatureHtml("<p>Noted.</p><div id=\"Signature\"><p>Alma</p></div>", []);
  check("an Outlook signature box goes", outlook.changed && outlook.html.includes("Noted.") && !outlook.html.includes("Signature"), outlook.html);

  const none = stripRepeatedSignatureHtml("<p>A</p><p>B</p>", htmlSegments("<p>C</p><p>D</p>"));
  check("nothing shared, nothing cut", !none.changed && none.html === "<p>A</p><p>B</p>");

  const onlySig = stripRepeatedSignatureHtml(sigHtml, htmlSegments(earlierHtml));
  check("an HTML message that is all signature is left whole", !onlySig.changed);

  // ---- Which earlier message ---------------------------------------------------
  const msgs = [
    { id: "1", fromEmail: "alma@example.org" },
    { id: "2", fromEmail: "bo@example.org" },
    { id: "3", fromEmail: "Alma@Example.org" },
    { id: "4", fromEmail: "alma@example.org" },
  ];
  const earlier = earlierFromSameSender(msgs);
  check("a sender's first message has none", !earlier.has("1") && !earlier.has("2"));
  check("a later one has their previous, whatever the case", earlier.get("3")?.id === "1" && earlier.get("4")?.id === "3");
});
