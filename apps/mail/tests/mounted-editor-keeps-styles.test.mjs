/**
 * Saved text keeps its size and colour when it opens in the editor.
 *
 * A signature saved in 8pt grey came back at the default size, in black:
 * the rule that strips a paste's size and colour also ran on the text the
 * editor was opened with. Only a paste is stripped now. Invented text only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-editor-keeps-styles.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
