/**
 * "A pane is sliding — do not measure anything until it stops."
 *
 * The list leaves and arrives over about a third of a second, and the
 * reader beside it changes width on every frame of that. Everything in the
 * reader watches its own width: the pane measures itself to decide how much
 * room the actions have, each bubble measures itself, and each email frame
 * re-measures by collapsing to nothing and reading its content back. At
 * sixty frames a second, with twenty messages open, that is thousands of
 * measurements and two React renders per frame — for an animation whose
 * whole job is to move one edge.
 *
 * Measured, it showed as exactly what it is: a one-message thread slid at a
 * median 8ms per frame and never missed one, while a twenty-two message
 * thread ran a median of 14ms with frames of 53. The animation is not the
 * cost. What watches it is.
 *
 * So the watchers stand still while it moves, and take one reading at the
 * end. A width that is on its way somewhere is not worth measuring: only
 * where it stops is.
 */

/**
 * How long any pane slide takes — the list leaving, the folders and the
 * toolbar with it, the list expanding over the reader, the reply box
 * growing over the thread. One tempo for all of them: the same gesture at
 * two speeds would read as two different gestures.
 *
 * Longer than the folder rail's own toggle. The rail is a strip of names
 * and 200ms reads as it stepping aside; these move most of the window,
 * which is a change of view, and a change of view is worth watching
 * happen.
 *
 * Carried inline rather than as a duration utility with the number in
 * square brackets. Tailwind builds its classes by reading the source, so
 * an arbitrary one assembled from a constant is never generated — the
 * first go at this asked for 340ms and got Tailwind's own 150ms default,
 * which is faster than what it replaced. The property stays a class, so
 * `motion-reduce:transition-none` still turns the whole thing off for a
 * reader who has asked for that.
 *
 * Nor is that class written out here as an example. Tailwind reads
 * comments too — it has no idea this is prose — so naming it warned that
 * it was ambiguous on every dev start and every build, for a class
 * nothing uses.
 */
export const PANE_SLIDE_MS = 340;
/**
 * Eased at both ends, so the distance is spread over the time.
 *
 * The first curve here was the one sheets use — very fast away, very long
 * to settle. Measured, it put the list 90% of the way across in the first
 * 50ms and spent the remaining 290ms moving the last two pixels: a slide
 * long on paper that read as a snap, because what the eye gets is the
 * distance, not the duration. This one starts gently and arrives gently,
 * and the middle of the movement is where most of the travel is.
 */
export const PANE_SLIDE_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
/**
 * How much longer than the slide a departing pane stays mounted.
 *
 * The clock starts when the close is asked for; the slide starts at the
 * next paint, a frame or two later. Timed to the millisecond, the rail
 * was unmounted with the last frames of its exit still to draw — which is
 * exactly what "it slides open but snaps shut" looks like.
 */
export const PANE_SLIDE_GRACE_MS = 80;

let sliding = false;
/** What to run once it stops. A Set, so a watcher asking every frame runs once. */
const settle = new Set<() => void>();

/** True while a pane is in the middle of opening or closing. */
export function mailPaneSliding(): boolean {
  return sliding;
}

/**
 * Defer work until the slide ends.
 *
 * Returns true when it has been deferred and the caller must do nothing
 * now. Pass a stable function — the same one on every frame — or each
 * frame's copy is kept and they all run at the end, which is the storm
 * this exists to stop.
 */
export function afterMailPaneSlide(work: () => void): boolean {
  if (!sliding) return false;
  settle.add(work);
  return true;
}

/** Called by the pane that slides, on either side of the movement. */
export function setMailPaneSliding(next: boolean): void {
  if (sliding === next) return;
  sliding = next;
  if (sliding) return;
  const due = [...settle];
  settle.clear();
  for (const work of due) work();
}
