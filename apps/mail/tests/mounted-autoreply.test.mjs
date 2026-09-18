/**
 * The auto-reply dialog saves itself, and this proves the saving.
 *
 * Mounted like mounted-smoke, against happy-dom and the transport seam:
 * flipping the switch must post on its own after its short pause; flipping
 * it back must post again; a responder switched on with nothing written
 * must post nothing and say what it is waiting for; and edits that leave
 * everything as the provider already holds it must not post at all.
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
  "HTMLIFrameElement",
  "SVGElement",
  "Element",
  "Node",
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

void import("./mounted-autoreply.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
