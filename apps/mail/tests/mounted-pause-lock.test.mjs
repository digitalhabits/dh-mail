/**
 * While a pause runs, the schedule and the words can only get stricter
 * without typing: a looser change waits in the panel for the words, and
 * goes through once they are typed. A tester's case first: paused on a
 * Monday, Monday taken off the schedule. Renders the real panels.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-pause-lock.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
