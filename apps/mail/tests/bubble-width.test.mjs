/**
 * The width a message may take in the thread, when the reader drags it.
 *
 * Kept in the window's storage and put on the page as one CSS variable, so
 * every message follows. Never narrower than a readable line; a
 * double-click (null) goes back to the default.
 */

import { Window } from "happy-dom";

import { MIN_BUBBLE_WIDTH, readBubbleWidth, saveBubbleWidth } from "@/lib/mail/bubble-width";
import { check, suite } from "./harness.mjs";

// The module reads the window when it is called, so it can be set here.
const win = new Window();
globalThis.window = win;
globalThis.document = win.document;

const onPage = () => document.documentElement.style.getPropertyValue("--mail-bubble-user-width");

suite(async () => {
  check("no width until the reader drags one", readBubbleWidth() === null && onPage() === "");
  saveBubbleWidth(812.4);
  check("a dragged width is kept, in whole pixels", readBubbleWidth() === 812, String(readBubbleWidth()));
  check("and put on the page for every message", onPage() === "812px", onPage());
  saveBubbleWidth(40);
  check("never narrower than a readable line", readBubbleWidth() === MIN_BUBBLE_WIDTH && onPage() === `${MIN_BUBBLE_WIDTH}px`);
  saveBubbleWidth(null);
  check("a double-click goes back to the default", readBubbleWidth() === null && onPage() === "");
});
