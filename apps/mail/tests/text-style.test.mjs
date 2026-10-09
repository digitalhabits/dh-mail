/**
 * The font and size a message is written in (lib/mail/text-style).
 *
 * An account's default goes out as the style round the body, and the Aa
 * menu reads back the inline styles it wrote, from this version and the one
 * before. The reader shows our own messages at its own size, whatever font
 * and size they were sent in.
 */

import { Window } from "happy-dom";

import {
  TEXT_STYLE_FALLBACK,
  bodyWrapperStyle,
  fontFromStyle,
  fontLabel,
  fontStack,
  quickFonts,
  sizeFromStyle,
} from "@/lib/mail/text-style";
import { sanitizeEmailHtml } from "@/lib/mail/email-html";

import { check, suite } from "./harness.mjs";

const win = new Window();
for (const key of ["window", "document", "DOMParser", "Node", "NodeFilter"]) {
  globalThis[key] = key === "window" ? win : win[key];
}

suite(async () => {
  // --- The default ---------------------------------------------------------
  check("out of the box it is Outlook's: Aptos at 12 pt", TEXT_STYLE_FALLBACK.font === "aptos" && TEXT_STYLE_FALLBACK.size === 12);
  check(
    "the wrapper names the whole stack and the size in points",
    bodyWrapperStyle({ font: "georgia", size: 11 }) ===
      "font-family:Georgia, Times New Roman, serif;font-size:11pt;line-height:1.6;color:#222"
  );
  check("another font goes out by its name, with a fallback", fontStack("Gill Sans") === "Gill Sans, sans-serif");
  check("a name CSS cannot take bare is quoted", fontStack("3Dumb") === '"3Dumb", sans-serif');

  // --- The row of three ----------------------------------------------------
  check("the default comes first", JSON.stringify(quickFonts("aptos")) === JSON.stringify(["aptos", "georgia", "courier"]));
  check(
    "a new default takes the first place, and Aptos the next",
    JSON.stringify(quickFonts("georgia")) === JSON.stringify(["georgia", "aptos", "courier"])
  );
  check("a font from outside the list leads too", quickFonts("Gill Sans")[0] === "Gill Sans" && quickFonts("Gill Sans").length === 3);

  // --- Reading the styles back ---------------------------------------------
  check("no style is the default", fontFromStyle(undefined) === null && fontFromStyle("") === null);
  check("our stack is ours", fontFromStyle("Georgia, Times New Roman, serif") === "georgia");
  check("the browser's quotes and spaces do not matter", fontFromStyle('"Times New Roman", Times, serif') === "times");
  check("any other font is its first family", fontFromStyle("Menlo, Consolas, monospace") === "Menlo");
  check("and is named as it is", fontLabel("Menlo") === "Menlo" && fontLabel("aptos") === "Aptos");
  check("a size in points", sizeFromStyle("11pt") === 11);
  check("the older menu's pixels are turned to points", sizeFromStyle("24px") === 18 && sizeFromStyle("12px") === 9);
  check("no size, no answer", sizeFromStyle(undefined) === null && sizeFromStyle("large") === null);

  // --- Our own messages in the reader --------------------------------------
  const own = (style) => sanitizeEmailHtml(`<div style="${style}"><p>Hej</p></div>`);
  check(
    "the old Helvetica wrapper still shows at 14px",
    own("font-family:Helvetica,Arial,sans-serif;font-size:12pt;line-height:1.6;color:#222").includes("font-size:14px")
  );
  const georgia = own(bodyWrapperStyle({ font: "georgia", size: 11 }));
  check("a wrapper in another font and size shows at 14px too", georgia.includes("font-size:14px") && !georgia.includes("11pt"));
  check("and keeps its font", georgia.includes("Georgia"));
  check(
    "a sender's own 11pt text is left alone",
    sanitizeEmailHtml('<div style="font-size:11pt">Hi</div>').includes("font-size:11pt")
  );
});
