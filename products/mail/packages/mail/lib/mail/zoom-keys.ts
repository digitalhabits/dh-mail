/**
 * Which way a key steps the text size of a popped-out window
 * (use-zoom-keys.ts). Apart from the hook so a test can read it without
 * React.
 */

/** 1 for Cmd/Ctrl+Plus, -1 for Cmd/Ctrl+Minus, null for any other key. */
export function zoomKeyDirection(e: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "altKey" | "key">): 1 | -1 | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  // `key`, not `code`: a US keyboard makes "+" with Shift, and a Danish one
  // has a key of its own for it.
  if (e.key === "+" || e.key === "=") return 1;
  if (e.key === "-" || e.key === "_") return -1;
  return null;
}
