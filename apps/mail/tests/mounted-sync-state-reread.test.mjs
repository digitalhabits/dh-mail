/**
 * A "sync paused" state goes when the mailbox is well again.
 *
 * A reconnect writes the new state with no state event. The window reads
 * every state again when it gets the focus back, as it does on the way back
 * from the provider's sign-in page. Invented example data only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-sync-state-reread.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
