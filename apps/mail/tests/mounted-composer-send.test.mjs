/**
 * The composer sends what the writer sees.
 *
 * Mounted as mounted-smoke is, against happy-dom and the transport seam.
 * Each walk changes one field last and then sends. The send must carry the
 * new value, not the value from an earlier render.
 *
 * One walk presses Undo after Send. The composer must come back with the
 * same words, recipients and subject, and the second Send must carry them.
 *
 * A second Undo walk has a file on the message, and a last walk plays the
 * pop-out: it stores a draft with a file and sends the focus event. In both,
 * the file must come back to the strip.
 *
 * The last walk has a slow store. The composer opens and closes before the
 * store answers the read of the draft. The draft that then opens must be
 * saved again.
 *
 * Two more walks hold the draft. Each writes a message, opens a different
 * conversation, and comes back. The pane is made again for each thread, so
 * the words, the recipients and the subject must come back from the stored
 * draft. These walks must pass before and after the composer moves out of
 * ThreadPane.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
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

void import("./mounted-composer-send.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
