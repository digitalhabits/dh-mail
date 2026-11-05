/**
 * ⌘P in the file preview prints the file, not the message under it
 * (Mikkel, 2026-11-05). Every fixture is invented.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-print-preview.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
