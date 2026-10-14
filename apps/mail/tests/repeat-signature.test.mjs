/**
 * A sender's repeated signature folds; their sign-off does not.
 *
 * "Best, Ulrik" ends every message the same way, so it was in the tail two
 * messages share and went behind the "…" fold with the title and address.
 * How the writer closed is part of what they wrote, so it stays in view.
 */

import { Window } from "happy-dom";

import {
  htmlSegments,
  stripRepeatedSignatureHtml,
  stripRepeatedSignatureText,
  textSegments,
} from "@/lib/mail/repeat-signature";

import { check, suite } from "./harness.mjs";

const win = new Window();
for (const key of ["window", "document", "DOMParser", "Node", "NodeFilter"]) {
  globalThis[key] = key === "window" ? win : win[key];
}

const signature = "Vera Holm\nDirector, Example Institute\nvera@example.org";

suite(async () => {
  const earlier = textSegments(`Hi Ana,\n\nFirst note.\n\nBest,\nVera\n\n${signature}`);
  const later = stripRepeatedSignatureText(`Second note.\n\nBest,\nVera\n\n${signature}`, earlier);
  check("the text sign-off stays", later.includes("Best,") && later.includes("Vera"));
  check("the text signature folds", !later.includes("Example Institute"));

  const plain = stripRepeatedSignatureText(`Second note.\n\n${signature}`, textSegments(`First note.\n\n${signature}`));
  check("a signature with no sign-off still folds", plain === "Second note.");

  const block = (lines) => lines.map((l) => `<div>${l}</div>`).join("");
  const sig = signature.split("\n");
  const earlierHtml = htmlSegments(block(["First note.", "<br>", "Best,", "Vera", "<br>", ...sig]));
  const out = stripRepeatedSignatureHtml(block(["Second note.", "<br>", "Best,", "Vera", "<br>", ...sig]), earlierHtml);
  check("the HTML signature folds", out.changed && !out.html.includes("Example Institute"));
  check("the HTML sign-off stays", out.html.includes("Best,") && out.html.includes("Vera"));

  const onlyClosing = stripRepeatedSignatureText("Second note.\n\nThanks!\nVera", textSegments("First note.\n\nThanks!\nVera"));
  check("a sign-off alone is not a signature", onlyClosing.includes("Thanks!") && onlyClosing.includes("Vera"));
});
