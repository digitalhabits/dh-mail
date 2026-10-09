/**
 * A computed color as the desktop shell reads one. It has no React in it, so
 * a test can load it alone. See window-backdrop.ts.
 */

/**
 * `rgb(26, 39, 53)` to `#1a2735`. Null for a colour that is see-through or
 * in a form this does not read: the window must get a solid colour.
 */
export function solidHex(computed: string): string | null {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(
    computed.trim()
  );
  if (!m) return null;
  if (m[4] != null) {
    const alpha = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    if (!(alpha >= 1)) return null;
  }
  const hex = [m[1], m[2], m[3]].map((part) => {
    const n = Math.min(255, parseInt(part, 10));
    return n.toString(16).padStart(2, "0");
  });
  return `#${hex.join("")}`;
}
