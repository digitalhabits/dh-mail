/**
 * The one suite that mounts the real page.
 *
 * Everything else in this directory checks tokens, paths and bytes; this
 * one renders MailPage with React against a light DOM (happy-dom), feeds
 * it invented fixtures through the transport seam the standalone app
 * already uses, and walks the few gestures a refactor is most likely to
 * break: the list paints, a thread opens, the reader's focus sweep hides
 * and returns the list, the list's own expand toggles, and the text size
 * keys (Command+Plus and Minus size the app with nothing open and zoom an
 * open thread; Option+Command+Plus, Minus and 0 are always the app). It proves wiring,
 * not pixels — there is no layout in this DOM, so anything about sizes and
 * scroll positions still belongs to a person with a browser.
 *
 * The DOM globals must stand before any component module runs, which is
 * why the page itself is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-smoke.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
