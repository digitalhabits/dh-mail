/**
 * Disconnecting an account can be undone, and Undo loses nothing.
 *
 * The account leaves the Accounts list at once, but nothing is removed for
 * ten seconds. Undo inside that time brings it back, and no remove is ever
 * asked of the host: the sign-in, an Exchange password and the copy of the
 * mail all stay. When the time runs out, the account is removed.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-account-disconnect.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
