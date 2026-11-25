/**
 * Hours that pause new mail have a way round: the words, then new mail for
 * 15 minutes, then the hours again. A KU tester's case: paused by his
 * schedule, 100 words set, and every row in the menu only paused more.
 * Renders the real menu, with the real pause hook and the real challenge.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-pause-early.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
