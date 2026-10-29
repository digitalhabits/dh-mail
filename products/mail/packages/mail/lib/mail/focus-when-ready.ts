/*
 * Put the caret in a box that is not on screen yet.
 *
 * A composer opens over a few frames: its parts are a lazy chunk, and the
 * box is drawn after that. One try a frame after asking misses it when it
 * comes late, so Forward sometimes opened with the caret nowhere instead of
 * in To (reported 2026-10-28). This keeps trying, a frame at a time, and
 * keeps watching for that time after it lands, since the editor can take
 * the caret for itself once it has loaded.
 *
 * It stops the moment the reader puts the caret somewhere else themselves.
 * Where the focus was when it was asked is not such a place (a row that was
 * clicked, the button that was pressed), and nor is the page itself. The
 * same rule as focusReply in use-thread-pane-flow.
 */

/** About two thirds of a second: long enough for the composer to open. */
const TRIES = 40;

export function focusWhenReady(get: () => HTMLElement | null): void {
  if (typeof window === "undefined") return;
  const asked = document.activeElement;
  let tries = 0;
  const attempt = () => {
    const box = get();
    const active = document.activeElement;
    // The composer's editor is not a choice either: it can take the caret
    // for itself as it opens.
    const chosen =
      active &&
      active !== box &&
      active !== document.body &&
      active !== asked &&
      !(active as HTMLElement).closest?.(".ql-editor");
    if (chosen) return;
    if (box && active !== box) box.focus();
    if (tries++ < TRIES) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}
