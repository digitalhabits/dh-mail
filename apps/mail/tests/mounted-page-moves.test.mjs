/**
 * Moving rows on the page, mounted against happy-dom with invented mail.
 *
 * - A row dragged onto a folder in the rail moves there and leaves the list.
 * - A pinned row glides from its old place to its new one, inside the
 *   list's own scroller.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-page-moves.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
