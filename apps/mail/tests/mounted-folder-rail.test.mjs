/**
 * The folder rail, mounted against happy-dom with invented mailboxes.
 *
 * It guards the rail's split into MailFolderRail.tsx (what it draws),
 * use-folder-rail.tsx (its state) and the folder-rail-*.tsx parts:
 *
 * - The views stand at the top, and each opens its view.
 * - Each mailbox has its section, with its folders as a tree; a click on a
 *   folder opens it, and the open folder is marked.
 * - A folder with children folds and opens again; a mailbox heading folds
 *   its whole section.
 * - The filter keeps only the folders it finds.
 * - The right-click menu renames a folder, moves it into another, and
 *   deletes it after it asks.
 *
 * Drags are not walked: happy-dom has no drag data to carry.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-folder-rail.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
