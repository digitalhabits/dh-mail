/**
 * Dragging in the folder rail, mounted alone against happy-dom.
 *
 * - A mailbox's heading dragged above another mailbox moves it there.
 * - A folder inside another, dropped on its mailbox's heading, comes out
 *   to the top.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-rail-drags.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
