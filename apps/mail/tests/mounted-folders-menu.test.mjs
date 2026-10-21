/**
 * The folders menu (FoldersTabMenu), mounted alone against happy-dom.
 *
 * - The button opens the menu, and typing narrows its folders.
 * - The arrow keys move the mark, and Enter opens the folder marked.
 * - Escape closes the menu.
 * - A conversation dropped on a folder in the menu is filed there.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-folders-menu.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
