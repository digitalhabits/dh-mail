/**
 * A letter typed into To, Cc or the subject of a reply is kept.
 *
 * The reply card listens for `input` on its letter, for the shadow above
 * Send (useComposerMoreBelow). That listener runs before React reads
 * the same event. In the Mac app, a state change there drew the composer
 * again first. The box got its old text back, React saw no change, and the
 * letter was lost: the second letter of a name (the suggestions opened and
 * the shadow above Send came on), or the first letter of the next name after
 * a pick (the suggestions closed and the shadow went off).
 *
 * happy-dom has no layout, so the heights are set by hand here. The check is
 * the rule that stops the loss: an `input` event changes no state before
 * the next frame.
 *
 * The DOM globals must be in place before a component module runs. Thus the
 * walk is imported dynamically from the impl file.
 */

import { installDom } from "./mounted-dom.mjs";

installDom();

void import("./mounted-composer-foot-typing.impl.mjs").catch((err) => {
  console.error("the mounted suite could not start:", err);
  process.exit(1);
});
