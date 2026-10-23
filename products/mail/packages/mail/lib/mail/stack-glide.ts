/**
 * Stacks switched on or off, shown as it happens.
 *
 * The switch changes which rows the list has: on, a sender's threads go
 * under the row of their newest thread; off, they come back out. The
 * timings are Claude Design's handoff (Stacks Animation Spec, option 5a):
 *
 *   On   0 ms     the threads that will stack take the tint, lift and a
 *                 shadow. Nothing else changes.
 *        250 ms   each slides up onto its sender's newest row: 600 ms,
 *                 90 ms apart, above the other rows.
 *        1050 ms  they drop under that row and go (200 ms). Only now does
 *                 the row take the tint and its "N threads", and the
 *                 gaps close (400 ms).
 *        1800 ms  the tint fades (900 ms).
 *
 *   Off  0 ms     the stack's row takes the tint; gaps open where its
 *                 threads belong (400 ms).
 *        250 ms   each thread lifts out from under it and slides into its
 *                 gap: 600 ms, 90 ms apart.
 *        1200 ms  they settle, and keep the tint where they landed.
 *        1500 ms  the tint fades (900 ms).
 *
 * The 90 ms steps stop at 200 ms, so that a big stack does not keep the
 * last threads moving long after the rest: all land by 1050 ms.
 *
 * How: the list changes at once. The places of the rows are
 * taken just before (`takeGlidePlaces`), and once the list has drawn again
 * (`glideToNewPlaces`) every row is put back where it was and moved from
 * there: the rows themselves for what stays, and copies over the list for
 * the threads that go into a stack or come out of one. A thread that comes
 * out keeps its real row hidden until its copy lands. Rows say which
 * threads they hold with `data-glide-keys`, newest first.
 *
 * The open thread, or else the top row on screen, stays where it is: the
 * list is scrolled to keep it. A thread whose way runs off the screen is
 * counted, and the count shows at that edge for a moment ("2 moved
 * below"). A thread far off the screen does not move. A second press
 * while it runs stops it where it is and runs the other way. With Reduce Motion nothing moves: the rows
 * cross-fade, and the tint alone shows what changed.
 */

const ATTR = "data-glide-keys";
/** On a copy: the thread it moves for, so a second press can find it. */
const COPY_ATTR = "data-glide-copy";
const EASE = "cubic-bezier(.3,.7,.2,1)";
const LIFT_SHADOW = "0 10px 24px rgba(30,45,62,.18)";
const TINT = "var(--mail-stack-tint)";
/** The latest start of a thread after the first, in ms. */
const STAGGER_MAX = 200;
/** Ways that stay further than this off the screen do not move. */
const OFF_SCREEN = 400;

export type GlideWords = {
  movedAbove: (count: number) => string;
  movedBelow: (count: number) => string;
};

type Place = { rect: DOMRect; keys: string[]; copy: HTMLElement };

type Taken = {
  root: HTMLElement;
  /** Stacks is being switched on: threads go into stacks. */
  stacking: boolean;
  byKey: Map<string, Place>;
  places: Place[];
  /** The row kept still on screen, by its first thread, and its top. */
  anchor: { key: string; top: number } | null;
  words: GlideWords;
};

type Run = { animations: Animation[]; added: HTMLElement[] };

let taken: Taken | null = null;
/** What a run left going, so a second press can stop it. */
let running: Run | null = null;

function keysOf(el: Element): string[] {
  return (el.getAttribute(ATTR) ?? "").split(" ").filter(Boolean);
}

function lessMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** How far along EASE is when `t` (0 to 1) of its time has gone. */
function eased(t: number): number {
  // EASE has no simple inverse, so its point at time t is found by halving.
  const bez = (s: number, a: number, b: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (bez(mid, 0.3, 0.2) < t) lo = mid;
    else hi = mid;
  }
  return bez(lo, 0.7, 1);
}

/** Stop a run: its copies go, and the rows stand where the list has them. */
function stopRunning() {
  if (!running) return;
  for (const a of running.animations) a.cancel();
  for (const el of running.added) el.remove();
  running = null;
}

/**
 * Take the places of the rows, just before the list changes.
 *
 * `stacking`: Stacks is being switched on. `openKey`: the open thread,
 * which is kept still on screen when it is in the list.
 */
export function takeGlidePlaces(
  root: HTMLElement | null,
  stacking: boolean,
  words: GlideWords,
  openKey?: string | null
): void {
  taken = null;
  if (!root) return stopRunning();
  // Take the places where a running glide shows them now, then stop it.
  const frame = root.getBoundingClientRect();
  const copyRects = new Map<string, DOMRect>();
  for (const el of root.parentElement?.querySelectorAll<HTMLElement>(`[${COPY_ATTR}]`) ?? []) {
    copyRects.set(el.getAttribute(COPY_ATTR) ?? "", el.getBoundingClientRect());
  }
  const byKey = new Map<string, Place>();
  const places: Place[] = [];
  let firstOnScreen: Place | null = null;
  for (const el of root.querySelectorAll<HTMLElement>(`[${ATTR}]`)) {
    const keys = keysOf(el);
    // A thread on its way out of a stack shows as its copy: its row is hidden.
    const rect = (keys.length === 1 && copyRects.get(keys[0])) || el.getBoundingClientRect();
    const place = { rect, keys, copy: el.cloneNode(true) as HTMLElement };
    places.push(place);
    for (const key of place.keys) if (!byKey.has(key)) byKey.set(key, place);
    if (!firstOnScreen && rect.bottom > frame.top + 1) firstOnScreen = place;
  }
  // A thread on its way into a stack is already in the stack's row, but
  // shows where its copy is.
  for (const [key, rect] of copyRects) {
    const place = byKey.get(key);
    if (place && place.keys.length > 1) byKey.set(key, { rect, keys: [key], copy: place.copy });
  }
  stopRunning();
  const open = openKey ? byKey.get(openKey) : undefined;
  const anchorPlace = open && open.rect.bottom > frame.top && open.rect.top < frame.bottom ? open : firstOnScreen;
  taken = {
    root,
    stacking,
    byKey,
    places,
    anchor: anchorPlace ? { key: openKey && open === anchorPlace ? openKey : anchorPlace.keys[0], top: anchorPlace.rect.top } : null,
    words,
  };
}

/** Run the switch's animation, once the list has drawn itself again. */
export function glideToNewPlaces(root: HTMLElement | null): void {
  const before = taken;
  taken = null;
  if (!before || !root || root !== before.root || typeof root.animate !== "function") return;
  const host = root.parentElement;
  if (!host) return;
  const rows = [...root.querySelectorAll<HTMLElement>(`[${ATTR}]`)];
  const rowByKey = new Map<string, HTMLElement>();
  for (const el of rows) for (const key of keysOf(el)) if (!rowByKey.has(key)) rowByKey.set(key, el);
  // The colors to fade back to, read before any animation can tint them.
  const base = new Map<HTMLElement, string>();
  for (const el of rows) base.set(el, getComputedStyle(el).backgroundColor);

  // The anchor stays where it was on screen.
  if (before.anchor) {
    const el = rowByKey.get(before.anchor.key);
    if (el) root.scrollTop += el.getBoundingClientRect().top - before.anchor.top;
  }

  const run: Run = { animations: [], added: [] };
  running = run;
  const play = (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const a = el.animate(frames, options);
    run.animations.push(a);
    return a;
  };

  if (lessMotion()) {
    // Nothing moves: the rows cross-fade, and the tint shows what changed.
    for (const el of rows) play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" });
    for (const el of rows) {
      const keys = keysOf(el);
      const changed = before.stacking ? keys.length > 1 : before.byKey.get(keys[0])?.keys.length !== 1;
      if (changed) tintThenFade(el, base.get(el), play, 0, 900);
    }
  } else {
    const frame = root.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const nowTop = new Map<HTMLElement, number>();
    for (const el of rows) nowTop.set(el, el.getBoundingClientRect().top);
    if (before.stacking) stackOn(before, rows, frame, hostRect, nowTop, base, host, play, run);
    else stackOff(before, rows, frame, hostRect, nowTop, base, host, play, run);
  }

  // The run ends with its last animation. A stopped run rejects: it is already cleared.
  Promise.all(run.animations.map((a) => a.finished)).then(() => running === run && stopRunning(), () => {});
}

type Play = (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => Animation;

/** The tint from `from` ms, held, then faded over `fade` ms to `base`. */
function tintThenFade(el: HTMLElement, base: string | undefined, play: Play, from: number, holdUntil: number, fade = 900) {
  const total = holdUntil - from + fade;
  play(
    el,
    [
      { backgroundColor: TINT, offset: 0 },
      { backgroundColor: TINT, offset: (holdUntil - from) / total },
      { backgroundColor: base, offset: 1 },
    ],
    { duration: total, delay: from, easing: "ease" }
  );
}

/** Threads go under their sender's newest row. */
function stackOn(
  before: Taken,
  rows: HTMLElement[],
  frame: DOMRect,
  hostRect: DOMRect,
  nowTop: Map<HTMLElement, number>,
  base: Map<HTMLElement, string>,
  host: HTMLElement,
  play: Play,
  run: Run
) {
  // Every row starts where its newest thread's row was, and goes to its
  // place as the gaps close, at 1050 ms.
  for (const el of rows) {
    const from = before.byKey.get(keysOf(el)[0]);
    if (!from) {
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, delay: 1050, fill: "backwards" });
      continue;
    }
    const dy = from.rect.top - (nowTop.get(el) ?? 0);
    if (Math.abs(dy) >= 1) {
      play(el, [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
        duration: 400,
        delay: 1050,
        easing: EASE,
        fill: "backwards",
      });
    }
    const keys = keysOf(el);
    if (keys.length > 1) {
      // The stack's row: its count and tint, only once the
      // threads are under it.
      const count = el.querySelector<HTMLElement>("[data-stack-count]");
      if (count) play(count, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: 1050, fill: "backwards" });
      tintThenFade(el, base.get(el), play, 1050, 1800);
    }
  }
  // The threads that go under a row: copies of their old rows, lifted,
  // sliding up onto it one after another.
  let n = 0;
  let above = 0;
  let below = 0;
  for (const place of before.places) {
    const lead = place.keys[0];
    if (rows.some((el) => keysOf(el)[0] === lead)) continue;
    const head = rows.find((el) => keysOf(el).includes(lead));
    if (!head) continue;
    const headFrom = before.byKey.get(keysOf(head)[0]);
    if (!headFrom) continue;
    const startTop = place.rect.top;
    const endTop = headFrom.rect.top;
    if (startTop > frame.bottom || endTop > frame.bottom) below += 1;
    if (startTop + place.rect.height < frame.top) above += 1;
    if (startTop > frame.bottom + OFF_SCREEN || startTop + place.rect.height < frame.top - OFF_SCREEN) continue;
    const copy = floatCopy(place.copy, lead, place.rect, hostRect, host, run);
    const delay = Math.min(n * 90, STAGGER_MAX);
    n += 1;
    play(copy, [
      { backgroundColor: getComputedStyle(copy).backgroundColor, transform: "scale(1)", boxShadow: "none" },
      { backgroundColor: TINT, transform: "scale(1.015)", boxShadow: LIFT_SHADOW },
    ], { duration: 200, fill: "forwards" });
    // Landed on the row by 1050 ms at the latest: under it, and gone.
    play(copy, [
      { transform: "translateY(0) scale(1.015)" },
      { transform: `translateY(${endTop - startTop}px) scale(1.015)` },
    ], { duration: 600, delay: 250 + delay, easing: EASE, fill: "forwards" }).finished.then(() => {
      copy.style.zIndex = "0";
    }, () => {});
    play(copy, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 1050, fill: "forwards" }).finished.then(
      () => copy.remove(),
      () => {}
    );
  }
  movedNote(above, below, before.words, host, play, run);
}

/** Threads come out from under their stack's row. */
function stackOff(
  before: Taken,
  rows: HTMLElement[],
  frame: DOMRect,
  hostRect: DOMRect,
  nowTop: Map<HTMLElement, number>,
  base: Map<HTMLElement, string>,
  host: HTMLElement,
  play: Play,
  run: Run
) {
  let n = 0;
  let above = 0;
  let below = 0;
  for (const el of rows) {
    const key = keysOf(el)[0];
    const from = before.byKey.get(key);
    const top = nowTop.get(el) ?? 0;
    if (!from) {
      play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      continue;
    }
    if (from.keys[0] === key) {
      // The stack's row (or any other row): to its place as the gaps open.
      const dy = from.rect.top - top;
      if (Math.abs(dy) >= 1) {
        play(el, [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
          duration: 400,
          easing: EASE,
        });
      }
      if (from.keys.length > 1) tintThenFade(el, base.get(el), play, 0, 1500);
      continue;
    }
    // A thread from under a stack: it starts where the gliding stack's row is then.
    const head = rows.find((r) => keysOf(r)[0] === from.keys[0]);
    const headNow = head ? nowTop.get(head) ?? from.rect.top : from.rect.top;
    const delay = 250 + Math.min(n * 90, STAGGER_MAX);
    const startTop = from.rect.top + (headNow - from.rect.top) * eased(delay / 400);
    const rect = el.getBoundingClientRect();
    if (top > frame.bottom || startTop > frame.bottom) below += 1;
    if (top + rect.height < frame.top) above += 1;
    const near = (y: number) => y + rect.height > frame.top - OFF_SCREEN && y < frame.bottom + OFF_SCREEN;
    if (!near(startTop) && !near(top)) {
      // Far off the screen: in its place at once, with the tint.
      tintThenFade(el, base.get(el), play, 0, 1500);
      continue;
    }
    n += 1;
    // Its copy lifts out and slides into the gap. The real row stays hidden until it lands.
    const landAt = delay + 600;
    const startRect = new DOMRect(rect.left, startTop, rect.width, rect.height);
    const copy = floatCopy(el.cloneNode(true) as HTMLElement, key, startRect, hostRect, host, run);
    play(copy, [
      { transform: "translateY(0) scale(1.015)", opacity: 0, boxShadow: LIFT_SHADOW, backgroundColor: TINT, offset: 0 },
      { opacity: 1, offset: 0.1 },
      { transform: `translateY(${top - startTop}px) scale(1.015)`, opacity: 1, boxShadow: LIFT_SHADOW, backgroundColor: TINT, offset: 1 },
    ], { duration: 600, delay, easing: EASE, fill: "both" }).finished.then(() => copy.remove(), () => {});
    play(el, [{ opacity: 0 }, { opacity: 0 }], { duration: landAt });
    // Settled by 1200 ms, tinted until 1500, faded by 2400.
    play(el, [
      { transform: "scale(1.015)", boxShadow: LIFT_SHADOW },
      { transform: "scale(1)", boxShadow: "none" },
    ], { duration: Math.max(150, 1200 - landAt), delay: landAt, easing: "ease" });
    tintThenFade(el, base.get(el), play, landAt, 1500);
  }
  movedNote(above, below, before.words, host, play, run);
}

/** A copy of a row over the list, standing at `rect`, for thread `key`. */
function floatCopy(copy: HTMLElement, key: string, rect: DOMRect, hostRect: DOMRect, host: HTMLElement, run: Run): HTMLElement {
  copy.removeAttribute(ATTR);
  copy.setAttribute(COPY_ATTR, key);
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, {
    position: "absolute",
    left: `${rect.left - hostRect.left}px`,
    top: `${rect.top - hostRect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    pointerEvents: "none",
    zIndex: "5",
    transformOrigin: "center",
  });
  host.append(copy);
  run.added.push(copy);
  return copy;
}

/** "N moved below" / "N moved above", at that edge, for a moment. */
function movedNote(above: number, below: number, words: GlideWords, host: HTMLElement, play: Play, run: Run) {
  const note = (text: string, edge: "top" | "bottom") => {
    const el = document.createElement("div");
    el.textContent = text;
    el.setAttribute("role", "status");
    // Drawn with styles of its own: made here, it is no class the
    // stylesheet was built from.
    Object.assign(el.style, {
      position: "absolute",
      left: "50%",
      [edge]: "10px",
      transform: "translateX(-50%)",
      zIndex: "6",
      pointerEvents: "none",
      borderRadius: "999px",
      background: "var(--mail-chrome-pinned)",
      color: "var(--mail-chrome-pinned-fg)",
      padding: "4px 12px",
      fontSize: "12px",
      fontWeight: "500",
      boxShadow: "0 4px 12px rgba(30,45,62,.18)",
      whiteSpace: "nowrap",
    });
    host.append(el);
    run.added.push(el);
    const a = play(el, [
      { opacity: 0, offset: 0 },
      { opacity: 1, offset: 0.12 },
      { opacity: 1, offset: 0.8 },
      { opacity: 0, offset: 1 },
    ], { duration: 2200, delay: 250, fill: "both" });
    a.onfinish = () => el.remove();
  };
  if (below) note(words.movedBelow(below), "bottom");
  if (above) note(words.movedAbove(above), "top");
}
