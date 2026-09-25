/**
 * The send preview must not put a sender's HTML in the app's own page.
 *
 * The reader shows HTML mail in an iframe with a policy that lets nothing
 * run. The preview showed the same HTML with `dangerouslySetInnerHTML`, in
 * the document that holds the Tauri bridge. This mounts the preview and
 * looks for the sender's markup in that document.
 *
 * Mounted like mounted-smoke, against happy-dom. Every fixture is invented.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-preview-frame.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
