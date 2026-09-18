/**
 * The pinch, between the three places it comes from and the two that read it.
 *
 * A trackpad pinch reaches the mail interface three ways: as ctrl and the
 * wheel, as WebKit's gesture events, and — in the Mac app, where WKWebView
 * swallows both, especially over a nested frame — from AppKit through a
 * Tauri event.
 *
 * Two of those carry the pointer and one cannot, so the payload has two
 * shapes and every reader must take both. This file is the whole agreement
 * between them, in one place, because when it lived in two the two came
 * apart: a reader that took only the richer shape shipped, and pinch
 * stopped working in the Mac app and nowhere else. It stopped silently,
 * because an unreadable ratio is not a number and a listener drops a ratio
 * that is not a number rather than complaining about one.
 */

/** Window events that re-emit pinch gestures happening inside email iframes. */
export const MAIL_PINCH_WHEEL_EVENT = "mail-pinch-wheel";
export const MAIL_PINCH_SCALE_EVENT = "mail-pinch-scale";

/**
 * `value` is the wheel delta or the scale ratio. `y` is the pointer in the
 * page's own pixels, for the zoom to hold that place still, and null when
 * the sender cannot say where the gesture is.
 */
export type MailPinchDetail = { value: number; y: number | null };

/** Read a pinch event, whichever of the two shapes it carries. */
export function readMailPinch(event: Event): MailPinchDetail {
  const detail = (event as CustomEvent<unknown>).detail;
  // The native bridge: a ratio and nothing else.
  if (typeof detail === "number") return { value: detail, y: null };
  const shaped = detail as Partial<MailPinchDetail> | null;
  return {
    value: typeof shaped?.value === "number" ? shaped.value : Number.NaN,
    y: typeof shaped?.y === "number" ? shaped.y : null,
  };
}
