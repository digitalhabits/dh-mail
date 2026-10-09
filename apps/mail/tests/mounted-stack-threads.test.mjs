/**
 * Stacking the threads of one sender is a setting in Settings > Reading,
 * on by default (2026-09-29). It was a pair of buttons in the title bar.
 *
 * With nothing saved, the toggle is on and the list stacks. Flipping it
 * turns stacking off for the list at once, and is kept.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-stack-threads.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
