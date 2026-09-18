import { withoutTrailingSignature } from "@/lib/mail/outlook-compose";
import { check, suite } from "./harness.mjs";

const SIG = "Dr Vera Holm\nDirector of the Centre for Paper Boats\nResearch Fellow, University of Example";

suite(async () => {
  // ---- The whole point -----------------------------------------------------
  // Outlook signs what it opens. Ours going over too is the same sign-off
  // twice, in two faces.
  let out = withoutTrailingSignature(
    { html: "<p>Hi Justin,</p><p>Best wishes,</p>", text: `Hi Justin,\n\nBest wishes,\n\n${SIG}` },
    SIG
  );
  check("the signature comes off the words", !out.text.includes("Research Fellow"), out.text);
  check("and what was written stays", out.text.includes("Hi Justin,"), out.text);
  check("down to the sign-off above it", out.text.trimEnd().endsWith("Best wishes,"), out.text);

  // ---- A body that does not end in it is untouched --------------------------
  const plain = { html: "<p>Short one.</p>", text: "Short one." };
  out = withoutTrailingSignature(plain, SIG);
  check("a message with no signature is left alone", out.text === plain.text, out.text);
  check("and its html with it", out.html === plain.html, out.html);

  // ---- Only at the end -----------------------------------------------------
  // A signature quoted mid-message is part of what is being said.
  const quoted = {
    html: "<p>They wrote:</p>",
    text: `They wrote:\n${SIG}\nand I disagree.`,
  };
  out = withoutTrailingSignature(quoted, SIG);
  check(
    "a signature quoted in the middle is not cut out",
    out.text === quoted.text,
    out.text
  );

  // ---- Whitespace is not the test ------------------------------------------
  out = withoutTrailingSignature(
    { html: "<p>Hi</p>", text: "Hi\n\n\nDr Vera   Holm\n Director of the Centre for Paper Boats\nResearch Fellow, University of Example  " },
    SIG
  );
  check(
    "a gap spelled differently still matches",
    !out.text.includes("Research Fellow"),
    out.text
  );

  // ---- Nothing to strip ----------------------------------------------------
  out = withoutTrailingSignature({ html: "<p>Hi</p>", text: "Hi" }, "");
  check("no signature configured changes nothing", out.text === "Hi", out.text);
  out = withoutTrailingSignature({ html: "<p>Hi</p>", text: "Hi" }, "   \n  ");
  check("a blank signature changes nothing", out.text === "Hi", out.text);
});
