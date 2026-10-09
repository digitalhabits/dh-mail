/**
 * How big the whole app is drawn.
 *
 * The reader could already make a message bigger — that is the zoom in the
 * thread's toolbar — but the message is the one part of this app that was
 * ever adjustable. The folder names, the list, the buttons and every menu
 * stayed at whatever size they were built at, which is no help at all to a
 * reader who wanted them bigger in the first place.
 *
 * So: one number for everything, kept next to the theme and the language as
 * another way a reader has their own copy of the app. It is applied as
 * `zoom` on the document, which is what the thread's own zoom uses and what
 * a browser's Cmd-+ does — every length scales, not only the ones written in
 * rem, which matters here because this interface is full of exact pixels.
 *
 * The thread's zoom sits inside this one and multiplies with it, which is
 * the right way round: it says "bigger than the rest", and it still does.
 *
 * No React in here, so a test can read it.
 */

export const MAIL_UI_SCALE_KEY = "redd-plan-mail-ui-scale";
export const MAIL_UI_SCALE_EVENT = "redd-plan-mail-ui-scale-changed";

/**
 * Below 80% the chrome stops being small and starts being cramped — the
 * rows are already tight. Above 160% a two-pane window has no second pane
 * left. Neither is a limit of the drawing; both are where it stops helping.
 */
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.6;
const UI_SCALE_STEP = 0.1;

export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, value));
}

/**
 * The next round size up or down.
 *
 * Same reasoning as the thread's zoom: a size typed in lands anywhere, and
 * a tenth added to 93% gives another number nobody asked for. This steps to
 * the tenth instead, so there is always a way back to a round number.
 */
export function nextUiScaleStop(current: number, direction: 1 | -1): number {
  const steps = current / UI_SCALE_STEP;
  // The nudge keeps a value already on a stop from being held there by its
  // own floating-point dust.
  const next =
    direction > 0
      ? Math.floor(steps + 1e-6) + 1
      : Math.ceil(steps - 1e-6) - 1;
  return clampUiScale(Math.round(next * UI_SCALE_STEP * 1000) / 1000);
}

export function readUiScale(): number {
  if (typeof window === "undefined") return 1;
  try {
    const stored = Number.parseFloat(
      localStorage.getItem(MAIL_UI_SCALE_KEY) ?? ""
    );
    if (!Number.isFinite(stored)) return 1;
    return clampUiScale(stored);
  } catch {
    return 1;
  }
}

export function writeUiScale(value: number): void {
  if (typeof window === "undefined") return;
  const next = clampUiScale(value);
  try {
    // 100% is the absence of a setting, not a setting of its own.
    if (next === 1) localStorage.removeItem(MAIL_UI_SCALE_KEY);
    else localStorage.setItem(MAIL_UI_SCALE_KEY, String(next));
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(MAIL_UI_SCALE_EVENT));
}
