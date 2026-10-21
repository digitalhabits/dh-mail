/**
 * The time box keeps what is being typed in it.
 *
 * Taking the 9 out of "09:00" leaves "0:00", which already reads as a time.
 * The box sent it up, the menu sent "00:00" back down, and the box took
 * that as a value from outside: the words were replaced and the caret went
 * to the end, so the 8 could not go where the 9 had been.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-time-field.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
