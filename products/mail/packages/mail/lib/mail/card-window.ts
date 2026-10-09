/**
 * The three sizes a floating card can be shown at.
 *
 * Two cards float over the mail: the reply handed out of a thread, and a new
 * message handed out of the composer. Both stand in the bottom right corner,
 * both can be carried and sized by hand — and both are sometimes in the way
 * of the very thing they are being written about, or too small for a message
 * that turned out to be long.
 *
 * So: out of the way, ordinary, or the whole window. The same three Gmail
 * offers, and the same three buttons, because a card that behaves like the
 * one every reader already knows needs no explaining.
 *
 * Only where the card stands is here. What is in it belongs to each card.
 */

export type CardWindowView = "normal" | "minimised" | "full";

/**
 * Where the card stands, and how big.
 *
 * Minimised keeps the corner but sits on the bottom edge, as a heading and
 * nothing else — each card empties itself, since only that card knows what
 * its body is. Full screen is a dialog in the middle of the window, over
 * everything, with the dimmed rest of the page put into the page itself:
 * inside a card that `transform` has moved, anything `fixed` is measured
 * from the card rather than from the window.
 */
export function cardWindowClass(view: CardWindowView): string {
  if (view === "full") {
    /*
      The ceilings are the window, not the card's own idea of itself.

      A size the reader dragged is an inline width and height, and it
      outlives the window it was chosen in: a smaller window later, an
      external display unplugged, and the card was drawn at the old size
      from its middle — its heading above the top of the screen, its right
      edge past the right of it, and no buttons to press to get out.
      `max-` puts that right on every frame, and for free.
    */
    return "fixed left-1/2 top-1/2 z-50 h-[calc(100vh-6rem)] max-h-[calc(100vh-2rem)] w-[min(52rem,calc(100vw-4rem))] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2";
  }
  if (view === "minimised") {
    return "fixed bottom-0 right-6 z-40 h-auto max-h-none w-[22rem] max-w-[calc(100vw-3rem)] rounded-b-none";
  }
  return "fixed bottom-4 right-6 z-40 max-h-[calc(100vh-2rem)] w-[34rem] max-w-[calc(100vw-3rem)]";
}
