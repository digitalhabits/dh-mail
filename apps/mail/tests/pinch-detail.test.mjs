/**
 * A pinch arrives in two shapes, and both have to be read.
 *
 * An email frame sends `{ value, y }`, because it knows where the fingers
 * are. The Mac app's native bridge sends the ratio on its own: AppKit hands
 * it over a Tauri event, which knows nothing of the page's pixels.
 *
 * This suite exists because a reader that took only the first shape shipped.
 * Pinch stopped working in the Mac app and nowhere else, and it stopped
 * silently: an unreadable ratio is not a number, and every listener drops a
 * ratio that is not a number rather than complaining about it.
 */

import { readMailPinch } from "@/lib/mail/pinch";
import { check, suite } from "./harness.mjs";

const pinch = (detail) => readMailPinch(new CustomEvent("mail-pinch-scale", { detail }));

suite(async () => {
  // ---- The native bridge: a bare ratio ---------------------------------
  const native = pinch(1.04);
  check("the ratio is read", native.value === 1.04, native.value);
  check("and it says nothing about where", native.y === null, String(native.y));

  // ---- An email frame: the ratio and the pointer ------------------------
  const framed = pinch({ value: 0.97, y: 412 });
  check("the ratio is read", framed.value === 0.97, framed.value);
  check("and where the fingers are", framed.y === 412, framed.y);

  // ---- A frame that cannot place the pointer ---------------------------
  const placeless = pinch({ value: 1.01, y: null });
  check("keeps the ratio", placeless.value === 1.01, placeless.value);
  check("and holds no place", placeless.y === null, String(placeless.y));

  // ---- Nonsense is not a number, which every listener drops -------------
  for (const [name, detail] of [
    ["nothing at all", null],
    ["an empty object", {}],
    ["a string where the ratio goes", { value: "1.2", y: 10 }],
  ]) {
    check(`${name} reads as no ratio`, Number.isNaN(pinch(detail).value));
  }
  check("a y that is not a number is no place",
    pinch({ value: 1.1, y: "412" }).y === null);
});
