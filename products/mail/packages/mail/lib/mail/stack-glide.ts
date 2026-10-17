/**
 * Stacks switched on or off, shown as it happens.
 *
 * The switch changes which rows the list has: on, a sender's threads go
 * under the row of their newest thread; off, they come back out. The
 * timings are Claude Design's handoff (Stacks Animation Spec, option 5a,
 * 2026-10-17):
 *
 *   On   0 ms     the threads that will stack take the tint, lift and a
 *                 shadow. Nothing else changes.
 *        250 ms   each slides up onto its sender's newest row: 600 ms,
 *                 90 ms apart, above the other rows.
 *        1050 ms  they drop under that row and go (200 ms). Only now does
 *                 the row take the tint, its "N threads" and its deck
 *                 edge, and the gaps close (400 ms).
 *        1800 ms  the tint fades (900 ms).
 *
 *   Off  0 ms     the stack's row takes the tint; gaps open where its
 *                 threads belong (400 ms).
 *        250 ms   each thread lifts out from under it and slides into its
 *                 gap: 600 ms, 90 ms apart.
 *        1200 ms  they settle, and keep the tint where they landed.
 *        1500 ms  the tint fades (900 ms).
 *
 * How: the list changes at once, as before. The places of the rows are
 * taken just before (`takeGlidePlaces`), and once the list has drawn again
 * (`glideToNewPlaces`) every row is put back where it was and moved from
 * there: the rows themselves for what stays, copies of the old rows for
 * the threads that go into a stack. Rows say which threads they hold with
 * `data-glide-keys`, newest first.
 *
 * The open thread, or else the top row on screen, stays where it is: the
 * list is scrolled to keep it. A thread whose way runs off the screen is
 * counted, and the count shows at that edge for a moment ("2 moved
 * below"). A second press while it runs stops it where it is and runs the
 * other way. With Reduce Motion nothing moves: the rows cross-fade, and
 * the tint alone shows what changed.
 */

const ATTR = "data-glide-keys";
const EASE = "cubic-bezier(.3,.7,.2,1)";
const LIFT_SHADOW = "0 10px 24px rgba(30,45,62,.18)";
const DECK = "0 4px 0 -1px var(--mail-deck-1), 0 8px 0 -2px var(--mail-deck-2)";
const TINT = "var(--mail-stack-tint)";

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

let taken: Taken | null = null;
/** What a run left going, so a second press can stop it. */
let running: { timers: number[]; animations: Animation[]; added: HTMLElement[]; raised: HTMLElement[] } | null = null;

function keysOf(el: Element): string[] {
  return (el.getAttribute(ATTR) ?? "").split(" ").filter(Boolean);
}

function lessMotion(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** Stop a run where it is: the rows stand where the list has them. */
function stopRunning() {
  if (!running) return;
  for (const id of running.timers) window.clearTimeout(id);
  for (const a of running.animations) a.cancel();
  for (const el of running.added) el.remove();
  for (const el of running.raised) {
    el.style.zIndex = "";
    el.style.position = "";
  }
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
  stopRunning();
  taken = null;
  if (!root) return;
  const frame = root.getBoundingClientRect();
  const byKey = new Map<string, Place>();
  const places: Place[] = [];
  let firstOnScreen: Place | null = null;
  for (const el of root.querySelectorAll<HTMLElement>(`[${ATTR}]`)) {
    const rect = el.getBoundingClientRect();
    const place = { rect, keys: keysOf(el), copy: el.cloneNode(true) as HTMLElement };
    places.push(place);
    for (const key of place.keys) if (!byKey.has(key)) byKey.set(key, place);
    if (!firstOnScreen && rect.bottom > frame.top + 1) firstOnScreen = place;
  }
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

  // The anchor stays where it was on screen.
  if (before.anchor) {
    const el = rowByKey.get(before.anchor.key);
    if (el) root.scrollTop += el.getBoundingClientRect().top - before.anchor.top;
  }

  const run = { timers: [] as number[], animations: [] as Animation[], added: [] as HTMLElement[], raised: [] as HTMLElement[] };
  running = run;
  const at = (ms: number, fn: () => void) => run.timers.push(window.setTimeout(fn, ms));
  const play = (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => {
    const a = el.animate(frames, options);
    run.animations.push(a);
    return a;
  };
  at(3000, () => {
    if (running === run) running = null;
  });

  if (lessMotion()) {
    // Nothing moves: the rows cross-fade, and the tint shows what changed.
    for (const el of rows) play(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" });
    for (const el of rows) {
      const keys = keysOf(el);
      const changed = before.stacking ? keys.length > 1 : before.byKey.get(keys[0])?.keys.length !== 1;
      if (changed) tintThenFade(el, play, 0, 900);
    }
    return;
  }

  const frame = root.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const nowTop = new Map<HTMLElement, number>();
  for (const el of rows) nowTop.set(el, el.getBoundingClientRect().top);

  if (before.stacking) stackOn(before, rows, frame, hostRect, nowTop, host, play, at, run);
  else stackOff(before, rows, frame, hostRect, nowTop, host, play, at, run);
}

type Play = (el: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) => Animation;
type At = (ms: number, fn: () => void) => void;

/** The tint from `from` ms, held, then faded over `fade` ms. */
function tintThenFade(el: HTMLElement, play: Play, from: number, holdUntil: number, fade = 900) {
  const base = getComputedStyle(el).backgroundColor;
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
  host: HTMLElement,
  play: Play,
  at: At,
  run: { added: HTMLElement[] }
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
      // The stack's row: its count, deck edge and tint, only once the
      // threads are under it.
      const count = el.querySelector<HTMLElement>("[data-stack-count]");
      if (count) play(count, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, delay: 1050, fill: "backwards" });
      play(el, [{ boxShadow: "none" }, { boxShadow: DECK }], { duration: 200, delay: 1050, fill: "backwards" });
      tintThenFade(el, play, 1050, 1800);
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
    if (startTop > frame.bottom + 400 || startTop + place.rect.height < frame.top - 400) continue;
    const copy = floatCopy(place, hostRect, host, run);
    const delay = n * 90;
    n += 1;
    play(copy, [
      { backgroundColor: getComputedStyle(copy).backgroundColor, transform: "scale(1)", boxShadow: "none" },
      { backgroundColor: TINT, transform: "scale(1.015)", boxShadow: LIFT_SHADOW },
    ], { duration: 200, fill: "forwards" });
    play(copy, [
      { transform: "translateY(0) scale(1.015)" },
      { transform: `translateY(${endTop - startTop}px) scale(1.015)` },
    ], { duration: 600, delay: 250 + delay, easing: EASE, fill: "forwards" });
    // Under the row, and gone.
    at(1050, () => {
      copy.style.zIndex = "0";
    });
    play(copy, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, delay: 1050, fill: "forwards" });
    at(1300, () => copy.remove());
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
  host: HTMLElement,
  play: Play,
  at: At,
  run: { added: HTMLElement[]; raised: HTMLElement[] }
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
    const wasStack = from.keys.length > 1;
    const isLead = from.keys[0] === key;
    if (isLead) {
      // The stack's row (or any other row): to its place as the gaps open.
      const dy = from.rect.top - top;
      if (Math.abs(dy) >= 1) {
        play(el, [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], {
          duration: 400,
          easing: EASE,
        });
      }
      if (wasStack) tintThenFade(el, play, 0, 1500);
      continue;
    }
    // A thread from under a stack: hidden under the stack's row, then
    // lifted out of it into its gap.
    const head = rows.find((r) => keysOf(r)[0] === from.keys[0]);
    const headTop = head ? nowTop.get(head) ?? from.rect.top : from.rect.top;
    if (top > frame.bottom || headTop > frame.bottom) below += 1;
    if (top + el.offsetHeight < frame.top) above += 1;
    const delay = 250 + n * 90;
    n += 1;
    const dy = headTop - top;
    el.style.zIndex = "3";
    el.style.position = "relative";
    run.raised.push(el);
    play(el, [
      { transform: `translateY(${dy}px) scale(1.015)`, opacity: 0, boxShadow: LIFT_SHADOW, backgroundColor: TINT, offset: 0 },
      { transform: `translateY(${dy}px) scale(1.015)`, opacity: 1, boxShadow: LIFT_SHADOW, backgroundColor: TINT, offset: 0.05 },
      { transform: "translateY(0) scale(1.015)", opacity: 1, boxShadow: LIFT_SHADOW, backgroundColor: TINT, offset: 1 },
    ], { duration: 600, delay, easing: EASE, fill: "backwards" });
    // Settled at 1200 ms, tinted until 1500, faded by 2400.
    const settleFrom = delay + 600;
    play(el, [
      { transform: "scale(1.015)", boxShadow: LIFT_SHADOW },
      { transform: "scale(1)", boxShadow: "none" },
    ], { duration: Math.max(150, 1200 - settleFrom), delay: settleFrom, easing: "ease" });
    tintThenFade(el, play, settleFrom, Math.max(settleFrom, 1500));
    at(2500, () => {
      el.style.zIndex = "";
      el.style.position = "";
    });
  }
  movedNote(above, below, before.words, host, play, run);
}

/** A copy of an old row, standing where the row stood, over the list. */
function floatCopy(place: Place, hostRect: DOMRect, host: HTMLElement, run: { added: HTMLElement[] }): HTMLElement {
  const copy = place.copy;
  copy.removeAttribute(ATTR);
  copy.setAttribute("aria-hidden", "true");
  Object.assign(copy.style, {
    position: "absolute",
    left: `${place.rect.left - hostRect.left}px`,
    top: `${place.rect.top - hostRect.top}px`,
    width: `${place.rect.width}px`,
    height: `${place.rect.height}px`,
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
function movedNote(above: number, below: number, words: GlideWords, host: HTMLElement, play: Play, run: { added: HTMLElement[] }) {
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
