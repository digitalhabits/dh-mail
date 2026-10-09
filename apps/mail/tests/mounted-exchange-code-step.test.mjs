/**
 * The access code comes first, and gates the Exchange connect form.
 *
 * A new connect shows only the access code. A wrong code keeps the mailbox
 * fields hidden and asks the shell nothing. The right code shows them. A
 * mailbox connected already goes straight to its fields. Built as the
 * public app. Invented example.com data only.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-exchange-code-step.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
