/**
 * A press, a move, and a release — including the release nobody saw.
 *
 * Every resize handle in the app is the same three lines: put a
 * `pointermove` on the window, put a `pointerup` beside it, and let the up
 * take both away again. It works until the pointer is somewhere the window
 * is not — over a message, which is an iframe with a document of its own,
 * or off the edge of the window entirely. The up is delivered there instead,
 * the move listener outlives it, and the next twitch of the mouse resizes
 * something nobody is holding. Let go, move the mouse, watch the reply box
 * follow the cursor.
 *
 * Two answers, and both are cheap:
 *
 * 1. The pointer is captured by the handle, so every event comes here
 *    whatever it is over — an iframe included, which is the case a window
 *    listener cannot win on its own.
 * 2. A move that arrives with no button held ends the drag. Whatever was
 *    missed and however, the hand is off it, and that is the whole test.
 *
 * The cursor and the text selection are held for the length of the drag and
 * put back at the end of it, once, here — rather than in each of the ends a
 * drag can come to.
 */

export type PointerDragHandle = {
  /** The element pressed. It takes the capture. */
  handle: HTMLElement | null;
  pointerId: number;
};

export function startPointerDrag(
  start: PointerDragHandle,
  handlers: {
    onMove: (event: PointerEvent) => void;
    /** The drag is over. The event is where the pointer was when it ended. */
    onEnd?: (event: PointerEvent) => void;
    /** Shown on the body while the drag runs: "ns-resize", "grabbing". */
    cursor?: string;
  }
): void {
  let over = false;

  const end = (event: PointerEvent) => {
    if (over) return;
    over = true;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onEndEvent);
    window.removeEventListener("pointercancel", onEndEvent);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      start.handle?.releasePointerCapture(start.pointerId);
    } catch {
      // Already released, or a pointer that is long gone. Either is fine.
    }
    handlers.onEnd?.(event);
  };

  const onMove = (event: PointerEvent) => {
    if (event.buttons === 0) {
      end(event);
      return;
    }
    handlers.onMove(event);
  };
  const onEndEvent = (event: PointerEvent) => end(event);

  try {
    start.handle?.setPointerCapture(start.pointerId);
  } catch {
    // No capture to be had — a pointer that ended between the press and
    // here. The button test below still closes the drag on the first move.
  }
  if (handlers.cursor) document.body.style.cursor = handlers.cursor;
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onEndEvent);
  window.addEventListener("pointercancel", onEndEvent);
}
