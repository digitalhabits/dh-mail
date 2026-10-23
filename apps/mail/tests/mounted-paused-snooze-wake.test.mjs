/**
 * Snoozed mail comes back into a paused inbox when its time comes.
 *
 * The hook is run in happy-dom with a fake transport for the snoozed list,
 * and the rows it adds are read back. All mail here is invented.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * walk is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-paused-snooze-wake.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
