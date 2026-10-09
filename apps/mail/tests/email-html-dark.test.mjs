/**
 * A message in dark mode (lib/mail/email-html-dark.ts).
 *
 * A white card with dark words becomes a dark card with light words; a
 * border that is drawn is turned with them; a picture keeps its own
 * colours; and a mail that says it knows about the dark keeps its own
 * styles. The mail is invented.
 */

import { Window } from "happy-dom";

import { recolorEmailForDark } from "@/lib/mail/email-html-dark";

import { check, suite } from "./harness.mjs";

const lightness = (css) => {
  const m = /hsla?\(\s*[\d.]+(?:deg)?[ ,]+[\d.]+%[ ,]+([\d.]+)%/.exec(css || "");
  return m ? Number(m[1]) : null;
};

// A browser hands back a computed colour as rgb(), which is what this
// reads; happy-dom hands back what was written, so the fixtures write rgb().
function frame(html) {
  const win = new Window();
  win.document.write(html);
  // happy-dom's document.images cannot be walked with for…of; a browser's can.
  Object.defineProperty(win.document, "images", { get: () => win.document.querySelectorAll("img") });
  return win.document;
}

suite(async () => {
  const doc = frame(
    '<body><div id="card" style="background-color:rgb(255, 255, 255);color:rgb(17, 17, 17);border:1px solid rgb(221, 221, 221)">' +
      '<p id="words">Choir moves to Thursday.</p>' +
      '<img id="pic" src="data:image/png;base64,AAAA" style="color:rgb(17, 17, 17)">' +
      "</div></body>"
  );
  recolorEmailForDark(doc);
  const card = doc.getElementById("card");
  const bg = lightness(card.style.getPropertyValue("background-color"));
  const fg = lightness(card.style.getPropertyValue("color"));
  check("a white card turns dark", bg !== null && bg < 30, card.getAttribute("style"));
  check("its dark words turn light", fg !== null && fg > 70, card.getAttribute("style"));
  check("a drawn border is turned with them", /hsl/.test(card.style.getPropertyValue("border-color")), card.getAttribute("style"));
  check("a picture keeps its own colours", !/hsl/.test(doc.getElementById("pic").getAttribute("style")), doc.getElementById("pic").getAttribute("style"));

  const own = frame(
    '<head><meta name="color-scheme" content="light dark"></head>' +
      '<body><div id="card" style="background-color:rgb(255, 255, 255);color:rgb(17, 17, 17)">Hej</div></body>'
  );
  recolorEmailForDark(own);
  check(
    "a mail that declares its own dark styles is left to them",
    !/hsl/.test(own.getElementById("card").getAttribute("style")) &&
      own.documentElement.style.getPropertyValue("color-scheme") === "dark",
    own.getElementById("card").getAttribute("style")
  );
});
