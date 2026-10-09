"use client";

import * as React from "react";
import {
  PANE_SLIDE_MS,
  PANE_SLIDE_GRACE_MS,
  setMailPaneSliding,
} from "@/lib/mail/pane-slide";

/** Where a sweep stands, and whether it is moving — see usePaneSweep. */
export type PaneSweep = {
  /** Where the pane is asked to stand: in its place, or away past its edge. */
  at: boolean;
  /**
   * Whether the sweep is running — while true the caller renders its pane
   * out of the flow with a transition on it; at rest it renders nothing of
   * the kind, so dragging never animates.
   */
  sliding: boolean;
  /**
   * In the document at all: through the whole of a sweep out, gone once it
   * lands. Callers whose pane stays mounted at rest ignore this.
   */
  mounted: boolean;
};

/**
 * One machine for every pane sweep.
 *
 * The list leaving the reader, the list expanding over it, the reply box
 * growing over the thread: each is the same movement — paint the starting
 * position, ask for the far one so the transition carries it there, stand
 * down a grace after the tempo runs out — and each used to carry its own
 * copy of the machinery, which is three places for the next timing bug to
 * be fixed in one of.
 *
 * `target` is where the pane belongs: true for in its place, false for
 * away. The first run never sweeps — the states are born agreeing with
 * the target, and a page arriving at rest has nothing to animate.
 *
 * The two-frame wait, kept from the originals: the starting position has
 * to be painted before the far one is asked for, or the browser computes
 * a single position and there is nothing to move between. A single
 * `requestAnimationFrame` runs *before* the paint it was scheduled
 * against, so the second frame is the one that comes after it. The grace
 * on the timer answers those two frames, so the transition is not cut
 * short by the time they took.
 *
 * A sweep asked for when the pane already stands at its target — a toggle
 * and back within the first two frames — skips the dance instead of
 * painting the pane at the far end first, which is the flash every copy
 * of this machine used to have.
 *
 * `flag`: raise the mail-wide "a pane is sliding" flag (pane-slide) as the
 * sweep begins — here, inside the effect, a commit before anything moves,
 * so the ResizeObservers that fire inside the first moving frame find it
 * already up. Lowering is the caller's, because two sweeps can share the
 * flag and it must not come down while either is running.
 *
 * `snapWhen`: called with the new target when it flips; return true to
 * take the position without a sweep — for a change that belongs to some
 * other machine's animation. Read fresh through a ref, so it may close
 * over the caller's current render.
 */
export function usePaneSweep(
  target: boolean,
  opts?: {
    flag?: boolean;
    snapWhen?: (target: boolean) => boolean;
  }
): PaneSweep {
  const [at, setAt] = React.useState(target);
  const [sliding, setSliding] = React.useState(false);
  const [mounted, setMounted] = React.useState(target);
  const booted = React.useRef(false);
  const atRef = React.useRef(at);
  atRef.current = at;
  const optsRef = React.useRef(opts);
  optsRef.current = opts;
  React.useEffect(() => {
    if (!booted.current) {
      booted.current = true;
      return;
    }
    if (optsRef.current?.snapWhen?.(target)) {
      setAt(target);
      setMounted(target);
      return;
    }
    if (optsRef.current?.flag) setMailPaneSliding(true);
    setSliding(true);
    setMounted(true);
    let first = 0;
    let second = 0;
    if (atRef.current !== target) {
      setAt(!target);
      first = window.requestAnimationFrame(() => {
        second = window.requestAnimationFrame(() => setAt(target));
      });
    }
    const done = window.setTimeout(() => {
      setSliding(false);
      if (!target) setMounted(false);
    }, PANE_SLIDE_MS + PANE_SLIDE_GRACE_MS);
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
      window.clearTimeout(done);
    };
  }, [target]);
  return { at, sliding, mounted };
}
