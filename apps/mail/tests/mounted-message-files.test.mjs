/**
 * The files on a message, mounted against happy-dom with invented files.
 *
 * It guards the split of MailAttachments.tsx into it (the chips under a
 * message), attachment-files.tsx (size, type, bytes) and
 * attachment-preview.tsx (the preview):
 *
 * - Each file has its tile, with its name and its size in words.
 * - Several files offer Download all.
 * - A click on a tile opens its preview, which names the file and says
 *   where it stands among the message's files.
 * - Next and the arrow keys step through the files; Escape closes.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-message-files.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
