/**
 * The CRM proposal reads a thread's files only when asked, and a file it
 * cannot read does not stop the proposal.
 *
 * Mounted like the other mounted- suites, so React is bundled in; nothing
 * is drawn. It watches what is asked of the planner and what the reader is
 * told:
 *
 * - With the files included, each is downloaded; one that fails is named
 *   in an error, and the proposal is still asked for, without it.
 * - Without them, no file is downloaded and none is sent.
 * - Closed while a file is being read, no proposal is asked for.
 *
 * (The file's text itself comes from pdf.js, which is not run here.)
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-crm-files.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
