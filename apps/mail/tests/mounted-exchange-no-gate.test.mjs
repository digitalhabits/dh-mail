/**
 * A new Exchange connect opens straight on the mailbox fields.
 *
 * There was an access code first, checked with the Digital Habits server,
 * until 2026-10-09. KU IT said it is not needed. Now the form shows the
 * mailbox fields at once, and nothing goes to any server but the Exchange
 * server. Built as the public app. Invented example.com data only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-exchange-no-gate.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
