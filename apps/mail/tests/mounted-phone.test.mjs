/**
 * The mounted walk on a phone.
 *
 * The same page as mounted-smoke, with the document marked as a phone
 * before it runs, which is what the phone builds do. It proves the phone
 * frame is wired: the rows paint in one list, a tap opens the thread over
 * it with the way back at the top, the way back works, a long press opens
 * the row's menu, and the folders come out of the drawer. No pixels.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();
// The shell says this is a phone before the page runs, the way main.tsx
// does — see lib/mail/host-form.ts.
document.documentElement.dataset.dhForm = "phone";

void import("./mounted-phone.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
