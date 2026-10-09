/**
 * How big the whole app is drawn, and how the two buttons move it.
 *
 * The reader can type nothing here — there are only a minus and a plus —
 * but a size can still arrive from an older version, from another window,
 * or from a hand-edited store, so what comes back has to be a size the app
 * can actually draw at.
 */

import assert from "node:assert/strict";

import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  clampUiScale,
  nextUiScaleStop,
} from "@/lib/mail/ui-scale";

/** Steps go to the next tenth, not a tenth past wherever we are. */
assert.equal(nextUiScaleStop(1, 1), 1.1);
assert.equal(nextUiScaleStop(1, -1), 0.9);
assert.equal(nextUiScaleStop(1.2, 1), 1.3);

/** An odd size from somewhere else lands on a round one, in the direction asked. */
assert.equal(nextUiScaleStop(1.13, 1), 1.2);
assert.equal(nextUiScaleStop(1.13, -1), 1.1);

/** The ends hold. */
assert.equal(nextUiScaleStop(UI_SCALE_MIN, -1), UI_SCALE_MIN);
assert.equal(nextUiScaleStop(UI_SCALE_MAX, 1), UI_SCALE_MAX);

/** Stepping off an end and back gives the round number beside it. */
assert.equal(nextUiScaleStop(nextUiScaleStop(UI_SCALE_MAX, 1), -1), 1.5);

/** Anything outside the range is brought inside it. */
assert.equal(clampUiScale(9), UI_SCALE_MAX);
assert.equal(clampUiScale(0.1), UI_SCALE_MIN);

/** A stored value that is not a number at all is 100%, not NaN. */
assert.equal(clampUiScale(Number.NaN), 1);
assert.equal(clampUiScale(Number.POSITIVE_INFINITY), 1);

/** Floating-point dust does not hold a value on its own stop. */
let scale = 1;
for (let i = 0; i < 4; i++) scale = nextUiScaleStop(scale, 1);
assert.equal(scale, 1.4);
for (let i = 0; i < 4; i++) scale = nextUiScaleStop(scale, -1);
assert.equal(scale, 1);
