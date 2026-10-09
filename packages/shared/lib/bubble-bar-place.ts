/**
 * Where the formatting bar goes when text is selected.
 *
 * Under the words when the box has room under them, and over the words
 * when it does not — which is what every editor does. The third case is
 * the one that had no answer: a box one line tall, at the foot of a small
 * window, with room neither under the selection nor over it. The bar was
 * held inside the box and clamped to its top, so it sat on the very words
 * it was formatting. That is every selection made in the chat popout.
 *
 * So the bar may leave the box upwards. What is above a chat composer is
 * the conversation, and covering a line of that for as long as a selection
 * lasts is the lesser fault. Nothing holds it but the window itself: off
 * the top of the screen is no better than over the words.
 */

/** The gap kept between the bar and the words, and from the window edge. */
export const BUBBLE_BAR_GAP = 10;

export function placeBubbleBar(input: {
  /** The selection and the box, in screen pixels. */
  selTop: number;
  selBottom: number;
  parentTop: number;
  parentBottom: number;
  barHeight: number;
  /** CSS zoom on the card, which screen pixels have to be divided by. */
  scaleY: number;
}): { top: number; flipped: boolean } {
  const { selTop, selBottom, parentTop, parentBottom, barHeight } = input;
  const scaleY = input.scaleY || 1;
  const gap = BUBBLE_BAR_GAP;

  const roomBelow = (parentBottom - selBottom) / scaleY;
  if (roomBelow >= barHeight + gap) {
    return { top: (selBottom - parentTop) / scaleY, flipped: false };
  }
  const above = (selTop - parentTop) / scaleY - barHeight - gap;
  // The top of the window, said in the box's own coordinates.
  const windowTop = (gap - parentTop) / scaleY;
  return { top: Math.max(above, windowTop), flipped: true };
}
