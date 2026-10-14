/**
 * The Reader shows the whole thread: its button is in a long message's
 * hover controls, under Reply; it lists every loaded message in order; and
 * the thread's toolbar opens it too. Invented fixtures only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-reader-thread.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
