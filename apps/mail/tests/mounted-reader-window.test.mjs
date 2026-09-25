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

import { installDom } from "./mounted-dom.mjs";

installDom("http://localhost:3473/?reader=1");

void import("./mounted-reader-window.impl.mjs").catch((err) => {
  console.error("the reader window suite could not start:", err);
  process.exit(1);
});
