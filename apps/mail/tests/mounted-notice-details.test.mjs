/**
 * A sync notice keeps the worker's own words folded away. "Show details"
 * opens them, and "Hide details" folds them again.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-notice-details.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
