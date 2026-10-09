/**
 * A server that will not delete a draft says why.
 *
 * Discarding a server draft from the Drafts view waits out its Undo and
 * then asks the provider. When an Exchange server refused, the refusal
 * went to the console and nowhere else, and the draft came back at the
 * next refresh with no word. Now the reader is told the server's reason.
 * The drafts are invented.
 *
 * Mounted, so that React (which the toast needs) is in the bundle. The
 * DOM globals must be in place before a component module runs. Thus the
 * walk is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-draft-not-discarded.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
