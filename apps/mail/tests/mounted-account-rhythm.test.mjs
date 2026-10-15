/**
 * A mailbox connected for the first time asks how it should fit the week,
 * and Done keeps the chosen rhythm as its hiding schedule and its own
 * quiet hours. Invented addresses only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-account-rhythm.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
