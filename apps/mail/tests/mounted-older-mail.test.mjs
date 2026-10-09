/**
 * "Older mail" on the page: the provider's older matches stand below the
 * local results, under their own heading, mounted against happy-dom.
 *
 * - The local results show first. The older search starts once they are in.
 * - The older rows stand under "Older mail", with no thread twice.
 * - While the server searches, the list says so in one quiet line.
 * - Offline, or with a server search that fails, the local results stand
 *   alone, with one quiet line and no toast.
 *
 * older-mail.test.mjs checks the search and the merge under the page.
 * Invented example data only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-older-mail.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
