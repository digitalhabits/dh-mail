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
 * A card can also be made larger or smaller, from its left edge, its top
 * edge, or the corner between them. Those are the edges that move: the card
 * stands in the bottom right corner, so its right and bottom edges stay
 * where they are. A caller that wants this draws the handles and gives each
 * one `startResize`. The size is kept under `sizeKey`, when there is one.
 *
 * A card in the middle of the window is a different animal. Nothing of it
 * stays put — it is held by its centre, so every edge moves, and an edge
 * dragged an inch makes the card two inches wider. Both edges of each pair
 * are given a handle there, because a dialog is grabbed wherever it is
 * nearest. `centred` says which kind is on screen, and the two keep their
 * own sizes: the corner's card and the dialog are not the same shape, and
 * one is not a suggestion for the other.
 */
export type CardResizeEdge =
  | "left"
  | "top"
  | "top-left"
  | "right"
  | "bottom"
  | "bottom-right";

const MIN_CARD_WIDTH = 352;
const MIN_CARD_HEIGHT = 300;

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
        return {
          width: ok(stored.width, MIN_CARD_WIDTH) ? stored.width : undefined,
          height: ok(stored.height, MIN_CARD_HEIGHT) ? stored.height : undefined,
        };
      } catch {
        /* private mode, or something else wrote the key */
        return {};
      }
    };
    setSizes({ corner: read(sizeKey), centre: read(centreKey) });
  }, [enabled, sizeKey, centreKey]);

  const startResize = (edge: CardResizeEdge) => (event: React.PointerEvent) => {
    if (!enabled || event.button !== 0) return;
    const card = cardRef.current;
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    const box = card.getBoundingClientRect();
    const from = { x: event.clientX, y: event.clientY };
    const MARGIN = 16;
    // In the corner, the right and bottom edges stay put, so the room to
    // grow into is what lies between them and the far sides of the window.
    // In the middle, the room is the window itself, less a margin on each
    // side — and every inch of the drag moves two edges.
    const maxWidth = centred
      ? Math.max(MIN_CARD_WIDTH, window.innerWidth - MARGIN * 2)
      : Math.max(MIN_CARD_WIDTH, box.right - MARGIN);
    const maxHeight = centred
      ? Math.max(MIN_CARD_HEIGHT, window.innerHeight - MARGIN * 2)
      : Math.max(MIN_CARD_HEIGHT, box.bottom - MARGIN);
    const grows = centred ? 2 : 1;
    const movesWidth = edge !== "top" && edge !== "bottom";
    const movesHeight = edge !== "left" && edge !== "right";
    // Which way the edge under the hand makes the card bigger.
    const wider = edge === "right" || edge === "bottom-right" ? 1 : -1;
    const taller = edge === "bottom" || edge === "bottom-right" ? 1 : -1;
    let latest = size;
    startPointerDrag(
      { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
      {
        cursor: !movesHeight ? "ew-resize" : !movesWidth ? "ns-resize" : "nwse-resize",
        onMove: (move) => {
          const next = { ...latest };
          if (movesWidth) {
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
          if (movesHeight) {
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
