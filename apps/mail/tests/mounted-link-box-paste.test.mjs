/**
 * Cmd+V in the link box pastes the address.
 *
 * In the Mac app, Cmd+V put nothing in the box that Cmd+K opens (a KU
 * tester, 2026-11-05). The box now pastes from the app's own clipboard
 * reader (packages/shared/components/ui/link-box-paste.ts). Here the shell
 * is a stand-in that answers one invented address.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-link-box-paste.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
