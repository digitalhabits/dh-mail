/**
 * How the Reader shows an HTML message.
 *
 * The Reader shows the message as the bubble does, with a forward and its
 * "Forwarded message" line in place. Only the type changes: a message
 * without a layout of its own takes the Reader's size and line height.
 */

/**
 * True when an HTML message has a layout of its own: tables, a style sheet,
 * or a fixed width. The Reader keeps that layout and centers it. Other HTML
 * takes the Reader's type.
 */
export function htmlHasOwnLayout(html: string): boolean {
  return /<(table|style)\b|\bwidth\s*=\s*["']?\d{3,}|\bwidth\s*:\s*\d{3,}px/i.test(html);
}
