/**
 * What the reply editor keeps when it is handed a received message.
 *
 * Two places give the editor the markup of a message somebody else sent:
 * `editScheduled` in ThreadPane, which takes a queued message back, and the
 * copy-to-a-new-message path in MailPage. The editor stands in the app's
 * own document, so what it keeps is the question the frame around the
 * preview does not answer.
 *
 * Mounted like mounted-smoke, against happy-dom. Every fixture is invented.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-editor-keeps.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
