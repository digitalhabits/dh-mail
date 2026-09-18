/**
 * The one suite that mounts the real page.
 *
 * Everything else in this directory checks tokens, paths and bytes; this
 * one renders MailPage with React against a light DOM (happy-dom), feeds
 * it invented fixtures through the transport seam the standalone app
 * already uses, and walks the few gestures a refactor is most likely to
 * break: the list paints, a thread opens, the reader's focus sweep hides
 * and returns the list, the list's own expand toggles. It proves wiring,
 * not pixels — there is no layout in this DOM, so anything about sizes and
 * scroll positions still belongs to a person with a browser.
 *
 * The DOM globals must stand before any component module runs, which is
 * why the page itself is imported dynamically from the impl file.
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

void import("./mounted-smoke.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
