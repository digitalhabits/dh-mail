/**
 * How wide a message may be in the thread, when the reader has said.
 *
 * By default a message takes up to three quarters of the pane, at most
 * 640px (`.mail-bubble-column` in mail.css). Dragging the edge of a message
 * sets one width for every message, kept in this window's storage, and a
 * double-click on the edge goes back to the default. The width is a CSS
 * variable on the page root, so every message follows at once, the open
 * thread and the next one alike.
 */

const KEY = "dh-mail-bubble-width";
const VAR = "--mail-bubble-user-width";
/** Narrower than this, a line of mail is a few words. */
export const MIN_BUBBLE_WIDTH = 280;

export function readBubbleWidth(): number | null {
  try {
    const n = Number(window.localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= MIN_BUBBLE_WIDTH ? n : null;
  } catch {
    return null;
  }
}

/** Put the width on the page, without keeping it: for the drag as it goes. */
export function showBubbleWidth(px: number | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (px == null) root.style.removeProperty(VAR);
  else root.style.setProperty(VAR, `${Math.round(Math.max(MIN_BUBBLE_WIDTH, px))}px`);
}

/** Keep the width, and show it. Null goes back to the default. */
export function saveBubbleWidth(px: number | null): void {
  const kept = px == null ? null : Math.round(Math.max(MIN_BUBBLE_WIDTH, px));
  try {
    if (kept == null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, String(kept));
  } catch {
    /* not kept: it holds until the window closes */
  }
  showBubbleWidth(kept);
}

/** The kept width, on the page. Once, when the mail first draws. */
let applied = false;
export function applyStoredBubbleWidth(): void {
  if (applied || typeof window === "undefined") return;
  applied = true;
  showBubbleWidth(readBubbleWidth());
}
