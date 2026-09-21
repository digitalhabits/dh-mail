"use client";

import * as React from "react";

import { startPointerDrag } from "@/lib/pointer-drag";

/**
 * Carry a card by its heading, and never off the screen.
 *
 * Two cards are read against what they cover and so want moving out of the
 * way: the CRM proposals, and the reply that floats over the list while you
 * look something up. One implementation, so they move alike.
 *
 * The range is worked out once, when the drag starts: where the card would
 * have to stop for a hand's width of it to still be on screen, and for its
 * heading — the part that carries it — never to go above the top, which
 * would leave nothing left to take hold of.
 *
 * The offset is a translation, so it works whichever corner the card is
 * anchored to.
 *
 * A card can also be made larger or smaller, from any of its four edges or
 * any of its four corners. A caller that wants this draws the handles and
 * gives each one `startResize`. The size is kept under `sizeKey`, when
 * there is one.
 *
 * The card in the corner is anchored by its right and bottom edges, so
 * only two of the four move on their own: drag the left edge and the card
 * grows to the left, drag the top and it grows upwards. The other two used
 * to have no handle at all, on the reasoning that an anchored edge cannot
 * move. It can. Carry the card away from the corner — which is the whole
 * point of carrying it — and the reader reaches for its bottom right, finds
 * nothing there, and says the card cannot be sized. So the far edges now
 * move the anchor with them: the card grows by what the hand moved, and the
 * carry offset shifts by the same amount, which holds the opposite edge
 * still and lets the held edge follow the pointer.
 *
 * A card in the middle of the window is a different animal. Nothing of it
 * stays put — it is held by its centre, so every edge moves from both ends,
 * and an edge dragged an inch makes the card two inches wider. `centred`
 * says which kind is on screen, and the two keep their own sizes: the
 * corner's card and the dialog are not the same shape, and one is not a
 * suggestion for the other.
 */
export type CardResizeEdge =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

/**
 * Which end of each axis the hand is on.
 *
 * "far" is the right edge or the bottom one — the pair the corner card is
 * anchored by, and the pair that therefore has to move the anchor to move
 * at all. A handle on neither end of an axis leaves that axis alone.
 */
const HELD: Record<CardResizeEdge, { x?: "near" | "far"; y?: "near" | "far" }> =
  {
    left: { x: "near" },
    right: { x: "far" },
    top: { y: "near" },
    bottom: { y: "far" },
    "top-left": { x: "near", y: "near" },
    "top-right": { x: "far", y: "near" },
    "bottom-left": { x: "near", y: "far" },
    "bottom-right": { x: "far", y: "far" },
  };

const MIN_CARD_WIDTH = 352;
const MIN_CARD_HEIGHT = 300;
/** The least the card leaves between itself and the side of the window. */
const MARGIN = 16;

export function useCardDrag(
  enabled: boolean,
  sizeKey?: string,
  centred = false
): {
  cardRef: React.MutableRefObject<HTMLDivElement | null>;
  offset: { x: number; y: number };
  startDrag: (event: React.PointerEvent) => void;
  /** The style to put on the card, or undefined while it has not moved. */
  cardStyle: React.CSSProperties | undefined;
  /** What the reader dragged the card to. A side never dragged is absent. */
  size: { width?: number; height?: number };
  startResize: (edge: CardResizeEdge) => (event: React.PointerEvent) => void;
} {
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  type CardSize = { width?: number; height?: number };
  const [sizes, setSizes] = React.useState<{
    corner: CardSize;
    centre: CardSize;
  }>({ corner: {}, centre: {} });
  const size = centred ? sizes.centre : sizes.corner;
  /** The dialog's own key, beside the corner card's. */
  const centreKey = sizeKey ? `${sizeKey}:centred` : undefined;

  React.useEffect(() => {
    if (!enabled || !sizeKey || !centreKey) return;
    const read = (key: string): CardSize => {
      try {
        const stored = JSON.parse(localStorage.getItem(key) ?? "null") as {
          width?: unknown;
          height?: unknown;
        } | null;
        if (!stored) return {};
        const ok = (value: unknown, floor: number): value is number =>
          typeof value === "number" && Number.isFinite(value) && value >= floor;
        /*
          A size outlives the window it was chosen in. The reader makes the
          app window smaller, or unplugs the display the card was sized on,
          and the number read back here is larger than there is room for.
          So it is cut to the window as well as held above the floor. The
          card's own `max-` ceilings say the same thing in CSS, on every
          frame; this keeps the stored number honest.
        */
        const room = (floor: number, side: number) =>
          Math.max(floor, side - MARGIN * 2);
        const width = ok(stored.width, MIN_CARD_WIDTH)
          ? Math.min(stored.width, room(MIN_CARD_WIDTH, window.innerWidth))
          : undefined;
        const height = ok(stored.height, MIN_CARD_HEIGHT)
          ? Math.min(stored.height, room(MIN_CARD_HEIGHT, window.innerHeight))
          : undefined;
        return { width, height };
      } catch {
        /* private mode, or something else wrote the key */
        return {};
      }
    };
    const readBoth = () =>
      setSizes({ corner: read(sizeKey), centre: read(centreKey) });
    readBoth();
    // The window can change size while the card is open.
    window.addEventListener("resize", readBoth);
    return () => window.removeEventListener("resize", readBoth);
  }, [enabled, sizeKey, centreKey]);

  const startResize = (edge: CardResizeEdge) => (event: React.PointerEvent) => {
    if (!enabled || event.button !== 0) return;
    const card = cardRef.current;
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    const box = card.getBoundingClientRect();
    const from = { x: event.clientX, y: event.clientY };
    const held = HELD[edge];
    const base = { ...offset };
    /*
      How much room the held edge has to grow into.

      In the middle, the room is the window itself less a margin on each
      side, and every inch of the drag moves two edges. In the corner, the
      card grows away from the edge opposite the hand: hold the left edge
      and the room is what lies between the card's right edge and the left
      of the window. Hold the right edge and it is the other way about.
    */
    const room = (
      side: "near" | "far" | undefined,
      floor: number,
      near: number,
      far: number,
      window_: number
    ) => {
      if (centred) return Math.max(floor, window_ - MARGIN * 2);
      return Math.max(floor, side === "far" ? window_ - MARGIN - near : far - MARGIN);
    };
    const maxWidth = room(
      held.x,
      MIN_CARD_WIDTH,
      box.left,
      box.right,
      window.innerWidth
    );
    const maxHeight = room(
      held.y,
      MIN_CARD_HEIGHT,
      box.top,
      box.bottom,
      window.innerHeight
    );
    const grows = centred ? 2 : 1;
    // Which way the edge under the hand makes the card bigger.
    const wider = held.x === "far" ? 1 : -1;
    const taller = held.y === "far" ? 1 : -1;
    let latest = size;
    startPointerDrag(
      { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
      {
        cursor: !held.y
          ? "ew-resize"
          : !held.x
            ? "ns-resize"
            : (held.x === "far") === (held.y === "far")
              ? "nwse-resize"
              : "nesw-resize",
        onMove: (move) => {
          const next = { ...latest };
          if (held.x) {
            next.width = Math.round(
              Math.min(
                maxWidth,
                Math.max(
                  MIN_CARD_WIDTH,
                  box.width + (move.clientX - from.x) * wider * grows
                )
              )
            );
          }
          if (held.y) {
            next.height = Math.round(
              Math.min(
                maxHeight,
                Math.max(
                  MIN_CARD_HEIGHT,
                  box.height + (move.clientY - from.y) * taller * grows
                )
              )
            );
          }
          latest = next;
          setSizes((current) =>
            centred
              ? { ...current, centre: next }
              : { ...current, corner: next }
          );
          /*
            A far edge moves the anchor with it.

            The corner card is pinned by its right and bottom edges, so
            width alone moves the left edge and leaves the right where it
            was — the opposite of what the hand is doing. Carrying the
            anchor by exactly what the card grew holds the far side under
            the pointer and the near side still. Never in the middle: the
            dialog is held by a transform of its own.
          */
          if (centred) return;
          setOffset({
            x:
              held.x === "far"
                ? base.x + ((next.width ?? box.width) - box.width)
                : base.x,
            y:
              held.y === "far"
                ? base.y + ((next.height ?? box.height) - box.height)
                : base.y,
          });
        },
        onEnd: () => {
          const key = centred ? centreKey : sizeKey;
          if (!key) return;
          try {
            localStorage.setItem(key, JSON.stringify(latest));
          } catch {
            /* private mode */
          }
        },
      }
    );
  };

  const startDrag = (event: React.PointerEvent) => {
    if (!enabled || event.button !== 0) return;
    // The close button, and anything else in the heading that answers a
    // press of its own.
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) {
      return;
    }
    const card = cardRef.current;
    if (!card) return;
    const box = card.getBoundingClientRect();
    const base = { left: box.left - offset.x, top: box.top - offset.y };
    const EDGE = 72;
    const limit = {
      minX: EDGE - base.left - box.width,
      maxX: window.innerWidth - EDGE - base.left,
      minY: -base.top,
      maxY: window.innerHeight - EDGE - base.top,
    };
    const from = { x: event.clientX - offset.x, y: event.clientY - offset.y };
    const clamp = (value: number, low: number, high: number) =>
      Math.min(Math.max(value, low), Math.max(low, high));

    startPointerDrag(
      { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
      {
        cursor: "grabbing",
        onMove: (move) =>
          setOffset({
            x: clamp(move.clientX - from.x, limit.minX, limit.maxX),
            y: clamp(move.clientY - from.y, limit.minY, limit.maxY),
          }),
      }
    );
  };

  return {
    cardRef,
    offset,
    startDrag,
    cardStyle:
      (!centred && (offset.x || offset.y)) || size.width || size.height
        ? {
            /* Never in the middle: the dialog is held there by a transform
               of its own, and a second one would take its place and drop
               it back into the corner it was carried from. */
            ...(!centred && (offset.x || offset.y)
              ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
              : {}),
            ...(size.width ? { width: size.width } : {}),
            ...(size.height ? { height: size.height } : {}),
          }
        : undefined,
    size,
    startResize,
  };
}
