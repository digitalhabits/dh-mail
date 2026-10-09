/**
 * A mailbox connected while the window is open gets its own provider's
 * mark at once.
 *
 * The lists of Outlook and Exchange mailboxes were read once, when the
 * window opened. A mailbox connected later was taken for Gmail, with the
 * Gmail mark, until the app was started again (2026-09-29). Now
 * `forgetMailProviderLists`, which a connect calls, has every hook read the
 * lists again. Invented example.com data only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-provider-lists.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
