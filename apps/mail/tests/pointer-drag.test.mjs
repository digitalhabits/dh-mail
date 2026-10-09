/**
 * A drag ends when the hand comes off it.
 *
 * The bug this is for: let go of a resize handle, move the mouse, and the
 * thing keeps resizing. The release went somewhere the window could not see
 * it — over a message, which is an iframe with a document of its own — so
 * the up never arrived and the move listener outlived the press.
 *
 * What is checked is the part that does not need a pointer: the capture is
 * taken and given back, an up ends the drag, and a move with no button held
 * ends it too, whatever was missed and however.
 */

import { startPointerDrag } from "@/lib/pointer-drag";

import { check, suite } from "./harness.mjs";

/** Just enough window and document for a drag to run in. */
function stage() {
  const listeners = new Map();
  globalThis.window = {
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn));
    },
  };
  globalThis.document = { body: { style: {} } };
  const captured = [];
  const released = [];
  const handle = {
    setPointerCapture: (id) => captured.push(id),
    releasePointerCapture: (id) => released.push(id),
  };
  return {
    handle,
    captured,
    released,
    count: (type) => (listeners.get(type) ?? []).length,
    fire: (type, event) => {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    },
  };
}

/** A move with the button still down, and one with it up. */
const holding = (x, y) => ({ buttons: 1, clientX: x, clientY: y });
const letGo = (x, y) => ({ buttons: 0, clientX: x, clientY: y });

suite(async () => {
  let s = stage();
  const moves = [];
  const ends = [];
  startPointerDrag(
    { handle: s.handle, pointerId: 7 },
    { cursor: "ns-resize", onMove: (e) => moves.push(e.clientY), onEnd: (e) => ends.push(e.clientY) }
  );
  check("the handle takes the pointer, so events keep coming over an iframe", s.captured[0] === 7);
  check("and the cursor says what is happening", document.body.style.cursor === "ns-resize");

  s.fire("pointermove", holding(10, 100));
  check("a move with the button down resizes", moves.join() === "100");

  s.fire("pointermove", letGo(10, 160));
  check(
    "a move with no button held is the release that was missed: it ends the drag",
    ends.join() === "160",
    JSON.stringify({ moves, ends })
  );
  check("and does not resize on the way out", moves.join() === "100");
  check("the cursor is put back", document.body.style.cursor === "");
  check("the pointer is handed back", s.released[0] === 7);
  check(
    "and nothing is left listening for the next twitch of the mouse",
    s.count("pointermove") === 0 && s.count("pointerup") === 0
  );

  s.fire("pointermove", holding(10, 900));
  check("so a later move does nothing at all", moves.join() === "100");

  // The ordinary ending, and only once however many ways it arrives.
  s = stage();
  const seen = [];
  startPointerDrag({ handle: s.handle, pointerId: 1 }, { onMove: () => {}, onEnd: () => seen.push("end") });
  s.fire("pointerup", letGo(5, 5));
  s.fire("pointercancel", letGo(5, 5));
  check("an up ends the drag", seen.length === 1, seen.join());

  // A press whose pointer is already gone: no capture to take, and the
  // first move closes it rather than leaving a listener behind.
  s = stage();
  s.handle.setPointerCapture = () => {
    throw new Error("no such pointer");
  };
  const late = [];
  startPointerDrag({ handle: s.handle, pointerId: 2 }, { onMove: () => late.push("move") });
  check("a capture that cannot be taken does not stop the drag being set up", s.count("pointermove") === 1);
  s.fire("pointermove", letGo(0, 0));
  check("and the drag still ends on the first move with nothing held", s.count("pointermove") === 0);
  check("with nothing moved", late.length === 0);
});
