/**
 * The pin that holds a thread at its newest message while it opens.
 *
 * It places the message again on every heartbeat for up to ten seconds.
 * At a zoom the browser rounds each placing afresh, a pixel or two one way
 * and then the other, so the open message wiggled up and down. The pin
 * must leave a message alone that is still where it put it, and must
 * still follow a message that something above pushed down.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-open-pin.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
