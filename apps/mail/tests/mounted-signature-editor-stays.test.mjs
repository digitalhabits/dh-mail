/**
 * The signature editor, rendered: it stays open while a signature is
 * written. A sync gives the dialog a new list with the same addresses, and
 * that must not put the editor away. A dialog that opens again starts at
 * the list.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-signature-editor-stays.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
