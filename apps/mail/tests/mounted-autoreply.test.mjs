/**
 * The auto-reply dialog saves itself, and this proves the saving.
 *
 * Mounted like mounted-smoke, against happy-dom and the transport seam:
 * flipping the switch must post on its own after its short pause; flipping
 * it back must post again; a responder switched on with nothing written
 * must post nothing and say what it is waiting for; and edits that leave
 * everything as the provider already holds it must not post at all.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-autoreply.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
