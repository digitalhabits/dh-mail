/**
 * A dialog never stands taller than the window it is in.
 *
 * The card is held in the middle of the screen, so one taller than the
 * screen hangs off both ends of it. The end out of reach is the top, and
 * the top is the heading, and the heading is what the card is carried by.
 * A reader then has a card whose top they cannot read and which they
 * cannot move — which is how the CRM proposals arrived at 138%.
 *
 * The height is bounded by `--mail-viewport-h`, the window in the pixels
 * the app lays out in. Two ways that can be wrong, and each is wrong in
 * the same direction:
 *
 * - On the `zoom` path, `dvh` is too big: `zoom` scales lengths and does
 *   not scale `vh`.
 * - The variable is measured, and the measurement can be out of date: the
 *   shell's zoom is set over an async call, so the pass that writes the
 *   variable can run before the zoom it is writing it for.
 *
 * Neither is ever too small, so the smaller of the two is the window.
 * Measured against the real dialog in a browser: with a value from one
 * zoom step ago, the heading sat 25px above the top of the window; with
 * `min()` it sits where it does when the value is honest.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { check, suite } from "./harness.mjs";

const MAIL = join(process.cwd(), "../../products/mail/packages/mail");
const src = (path) => readFileSync(join(MAIL, path), "utf8");

suite(async () => {
  const shell = src("components/mail/settings-ui.tsx");
  const height = shell.match(/max-h-\[[^\]]+\]/)?.[0] ?? "";

  check(
    "the dialog is bounded by the window",
    height.includes("--mail-viewport-h"),
    height
  );
  check(
    "and by the window's own units as well, so a stale value cannot win",
    height.includes("min(var(--mail-viewport-h,100dvh),100dvh)"),
    height
  );
  check(
    "and is a share of it, not the whole",
    height.includes("*0.88"),
    height
  );

  /*
    The heading carries the card, so it is the part that must never be off
    the screen. It is the first row of the card, above the body.
  */
  check(
    "the heading is what carries the card",
    shell.includes("onPointerDown={startDrag}") &&
      shell.includes('draggable && "cursor-grab touch-none select-none active:cursor-grabbing"')
  );
  check(
    "and the body is what scrolls, so the heading stays put",
    shell.includes('<div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">')
  );

  /* The other end: the variable is written again when the page is laid out. */
  const scale = src("lib/mail/use-ui-scale.ts");
  check(
    "the window's height is measured again on every layout, not only on resize",
    scale.includes("new ResizeObserver(apply)") &&
      scale.includes("observer?.observe(root)"),
    scale.includes("ResizeObserver") ? "observed" : "resize only"
  );
  check(
    "and the observer is taken down with the listener",
    scale.includes("observer?.disconnect();")
  );
  check(
    "a shell without ResizeObserver still measures once and on resize",
    scale.includes('typeof ResizeObserver === "undefined" ? null')
  );
});
