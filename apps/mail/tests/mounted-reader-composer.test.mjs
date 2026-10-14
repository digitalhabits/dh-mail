/**
 * Reply and Forward inside the Reader, mounted against happy-dom with
 * invented mail.
 *
 * - Reply in the Reader opens the thread's composer inside the Reader. The
 *   Reader stays open.
 * - Words and Send send a reply to the sender, and the Reader stays open.
 * - Esc with the composer open puts the composer away and keeps the draft.
 *   A second Esc closes the Reader.
 * - Forward in the Reader opens a forward composer in it.
 * - Closing the Reader with a draft open shows the composer in the thread
 *   with the words kept.
 * - The control that moves the reply to the floating card works from inside
 *   the Reader.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * page is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-reader-composer.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
