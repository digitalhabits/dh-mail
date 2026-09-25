/**
 * Where the mail list's box stands while it rests and while it slides
 * (components/mail/list-box-style.ts).
 *
 * No walk can read these: happy-dom lays nothing out. So each shape the
 * box can take is checked here, for the list beside the reader (vertical:
 * false) and above or below it (vertical: true).
 */

import { listBoxStyle, listInnerStyle } from "@/components/mail/list-box-style";
import { PANE_SLIDE_EASE, PANE_SLIDE_MS } from "@/lib/mail/pane-slide";

import { check, suite } from "./harness.mjs";

const REST = {
  listExpandSliding: false,
  listSlideOverlay: false,
  listExpanded: false,
  listOpen: true,
  listVertical: false,
  listFirst: true,
  expandClip: "inset(0px 40% 0px 0px)",
  listSlideTransform: "translateX(-100%)",
  railInset: 200,
  listHeight: 300,
  shownListWidth: 420,
};
const at = (over) => ({ ...REST, ...over });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

suite(async () => {
  // ---- The outer box -------------------------------------------------------------
  check("at rest beside the reader, it takes the list's width", same(listBoxStyle(REST), { width: 420 }), JSON.stringify(listBoxStyle(REST)));
  check("shut, it takes none", same(listBoxStyle(at({ listOpen: false })), { width: 0 }));
  check("above or below the reader, it takes the list's height", same(listBoxStyle(at({ listVertical: true })), { height: 300 }));
  check("and shut there, none", same(listBoxStyle(at({ listVertical: true, listOpen: false })), { height: 0 }));
  check("expanded, it is left to its class", listBoxStyle(at({ listExpanded: true })) === undefined);

  const sweep = listBoxStyle(at({ listExpandSliding: true }));
  check(
    "in the expand sweep, over the whole pane with the clip that meters it",
    sweep.position === "absolute" && sweep.inset === 0 && sweep.clipPath === REST.expandClip &&
      sweep.transitionDuration === `${PANE_SLIDE_MS}ms` && sweep.transitionTimingFunction === PANE_SLIDE_EASE,
    JSON.stringify(sweep)
  );

  const slide = listBoxStyle(at({ listSlideOverlay: true }));
  check(
    "in a slide, out of the flow, moved by its transform, clear of the rail",
    slide.position === "absolute" && slide.transform === REST.listSlideTransform &&
      slide.width === 420 && slide.left === 200 && slide.top === 0 && slide.bottom === 0,
    JSON.stringify(slide)
  );
  const slideRight = listBoxStyle(at({ listSlideOverlay: true, listFirst: false }));
  check("on the right, clear of the rail on the right", slideRight.right === 200 && slideRight.left === undefined, JSON.stringify(slideRight));
  const slideDown = listBoxStyle(at({ listSlideOverlay: true, listVertical: true, listFirst: false }));
  check(
    "above or below, the rail's width off its left, at the foot",
    slideDown.left === 200 && slideDown.right === 0 && slideDown.height === 300 && slideDown.bottom === 0,
    JSON.stringify(slideDown)
  );

  // ---- The inner box --------------------------------------------------------------
  const inner = listInnerStyle(REST);
  check(
    "the list inside keeps its width, against the reader's edge",
    inner.position === "absolute" && inner.width === 420 && inner.right === 0 && inner.left === undefined,
    JSON.stringify(inner)
  );
  check("on the right, against the left edge", listInnerStyle(at({ listFirst: false })).left === 0);
  const innerDown = listInnerStyle(at({ listVertical: true }));
  check("above the reader, its height, against the foot", innerDown.height === 300 && innerDown.bottom === 0, JSON.stringify(innerDown));
  check("expanded, it fills the box", same(listInnerStyle(at({ listExpanded: true })), { position: "absolute", inset: 0 }));
  check("and in the sweep too", same(listInnerStyle(at({ listExpandSliding: true })), { position: "absolute", inset: 0 }));
});
