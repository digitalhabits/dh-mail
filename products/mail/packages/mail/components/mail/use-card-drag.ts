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
 */
export type CardResizeEdge = "left" | "top" | "top-left";

const MIN_CARD_WIDTH = 352;
const MIN_CARD_HEIGHT = 300;

export function useCardDrag(
  enabled: boolean,
  sizeKey?: string
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
  const [size, setSize] = React.useState<{ width?: number; height?: number }>({});

  React.useEffect(() => {
    if (!enabled || !sizeKey) return;
    try {
      const stored = JSON.parse(localStorage.getItem(sizeKey) ?? "null") as {
        width?: unknown;
        height?: unknown;
      } | null;
      if (!stored) return;
      const ok = (value: unknown, floor: number): value is number =>
        typeof value === "number" && Number.isFinite(value) && value >= floor;
      setSize({
        width: ok(stored.width, MIN_CARD_WIDTH) ? stored.width : undefined,
        height: ok(stored.height, MIN_CARD_HEIGHT) ? stored.height : undefined,
      });
    } catch {
      /* private mode, or something else wrote the key */
    }
  }, [enabled, sizeKey]);

  const startResize = (edge: CardResizeEdge) => (event: React.PointerEvent) => {
    if (!enabled || event.button !== 0) return;
    const card = cardRef.current;
    if (!card) return;
    event.preventDefault();
    event.stopPropagation();
    const box = card.getBoundingClientRect();
    const from = { x: event.clientX, y: event.clientY };
    // The right and bottom edges stay put, so the room to grow into is
    // what lies between them and the far sides of the window.
    const MARGIN = 16;
    const maxWidth = Math.max(MIN_CARD_WIDTH, box.right - MARGIN);
    const maxHeight = Math.max(MIN_CARD_HEIGHT, box.bottom - MARGIN);
    let latest = size;
    startPointerDrag(
      { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
      {
        cursor:
          edge === "left" ? "ew-resize" : edge === "top" ? "ns-resize" : "nwse-resize",
        onMove: (move) => {
          const next = { ...latest };
          if (edge !== "top") {
            next.width = Math.round(
              Math.min(maxWidth, Math.max(MIN_CARD_WIDTH, box.width + (from.x - move.clientX)))
            );
          }
          if (edge !== "left") {
            next.height = Math.round(
              Math.min(maxHeight, Math.max(MIN_CARD_HEIGHT, box.height + (from.y - move.clientY)))
            );
          }
          latest = next;
          setSize(next);
        },
        onEnd: () => {
          if (!sizeKey) return;
          try {
            localStorage.setItem(sizeKey, JSON.stringify(latest));
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
      offset.x || offset.y || size.width || size.height
        ? {
            ...(offset.x || offset.y
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
