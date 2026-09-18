/**
 * The reader window, mounted.
 *
 * ThreadReaderWindow is the window a double-clicked thread opens in — the
 * whole reader wired to the endpoints directly, with no list behind it.
 * The walk proves the wiring the main window cannot prove for it: the pane
 * paints from the transport, the focus toggle stays off a toolbar that has
 * no list to hide, and Archive acts on every copy the opener handed over
 * before closing the window — the invariant that keeps a cc'd conversation
 * from surviving its own archive.
 *
 * The DOM globals must stand before any component module runs, which is
 * why the window itself is imported dynamically from the impl file.
 */

import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost:3473/?reader=1" });
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

void import("./mounted-reader-window.impl.mjs").catch((err) => {
  console.error("the reader window suite could not start:", err);
  process.exit(1);
});
