/**
 * HTML parsed into a document of its own, where nothing in it can act.
 *
 * Assigning to `innerHTML` on an element of the app's page builds the nodes
 * in that page. A picture starts to load at once, and its `onerror` runs at
 * once, before any code gets to look at what was built. Mail HTML holds the
 * words of other people, a quoted original for example, so that is the
 * wrong place to build it.
 *
 * A document from DOMParser has no window. Its scripts do not run, its
 * handlers do not fire, and its pictures do not load. Read it and change
 * it there, and hand on only the string.
 */

/** The body of an inert document that holds `html`. */
export function inertHtmlBody(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(
    "<!doctype html><html><head></head><body></body></html>",
    "text/html"
  );
  // innerHTML on an element of the inert document builds inert nodes.
  doc.body.innerHTML = html;
  return doc.body;
}
