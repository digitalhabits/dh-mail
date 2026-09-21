/**
 * The new-mail card has the three views, and keeps the draft across them.
 *
 * The card is the composer in the bottom right corner. It stands in the
 * same frame as the reply card — see `floating-card.tsx` — so it can be
 * put away, opened again, given the whole window, and brought back.
 *
 * The walk writes a message, then moves the card through every view. The
 * words, the recipients and the file in the strip must survive each move:
 * the card is never unmounted, only shown at another size, and a draft
 * that went missing on a change of view would be the reader's own writing.
 *
 * Mounted as the other `mounted-` suites are, against happy-dom. Every
 * name and every line is invented. No part of it was in a real mailbox.
 *
 * The DOM globals must be in place before a component module runs. Thus
 * the page is imported dynamically from the impl file.
 */

import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost:3473/" });
globalThis.window = win;
for (const key of [
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLIFrameElement",
  "SVGElement",
  "Element",
  "Node",
  "NodeFilter",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "DragEvent",
  "StorageEvent",
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "FileReader",
  "CSSStyleDeclaration",
  "DOMParser",
  "XMLSerializer",
  "Range",
  "Selection",
  "Text",
  "Comment",
  "DocumentFragment",
]) {
  if (win[key] !== undefined && globalThis[key] === undefined) {
    globalThis[key] = win[key];
  }
}
// happy-dom leaves these out; the app only needs them to exist.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

void import("./mounted-new-mail-card.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
