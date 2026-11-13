/**
 * A sync notice can be closed with its ×. It stays closed for that fault,
 * shows again when the mailbox came back and stopped again, and a sign-in
 * fault cannot be closed.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-notice-dismiss.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
