/**
 * Save diagnostics, rendered: the dialog builds its report from the page's
 * state and the app's log, shows it, and saves exactly what it showed. No
 * address, host or home folder of the invented people below gets through,
 * and the app's start and a crash the last run left are noted.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-diagnostics.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
