"use client";

/**
 * The frame both floating cards stand in.
 *
 * Two cards float over the mail: the reply handed out of a thread
 * (`ThreadPane` with `floating`) and the new message handed out of the
 * composer (`ComposeView` with `floating`). A reader who learns one of them
 * knows the other, so everything that is not the message itself lives here:
 * the three views, the carry, the size, the dimmed page, and the heading
 * with its buttons.
 *
 * Each card keeps its own body, its own Close, and whatever else its
 * heading needs. Nothing else.
 *
 * Where each of the three views stands is in `@/lib/mail/card-window`,
 * which is plain strings and no React. The buttons and the dimmed page are
 * in `card-window.tsx` next door.
 */

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMailT } from "@/lib/mail/i18n";
import {
  useCardDrag,
  type CardResizeEdge,
} from "@/components/mail/use-card-drag";
import {
  CardWindowBackdrop,
  CardWindowButtons,
} from "@/components/mail/card-window";
import {
  cardWindowClass,
  type CardWindowView,
} from "@/lib/mail/card-window";

/**
 * Where each of the eight handles is, and which way it sizes the card.
 *
 * The edges are 8px of border to aim at rather than 6px, and the corners
 * are 24px squares that reach past the rounded corner, which cuts the
 * first few pixels of them away. An edge carries its own name; a corner is
 * the two edges it joins and carries none, so a screen reader hears each
 * direction once.
 */
const CARD_HANDLES: {
  edge: CardResizeEdge;
  orientation?: "horizontal" | "vertical";
  className: string;
}[] = [
  { edge: "left", orientation: "vertical", className: "inset-y-0 left-0 z-20 w-2 cursor-ew-resize" },
  { edge: "right", orientation: "vertical", className: "inset-y-0 right-0 z-20 w-2 cursor-ew-resize" },
  { edge: "top", orientation: "horizontal", className: "inset-x-0 top-0 z-20 h-2 cursor-ns-resize" },
  { edge: "bottom", orientation: "horizontal", className: "inset-x-0 bottom-0 z-20 h-2 cursor-ns-resize" },
  { edge: "top-left", className: "left-0 top-0 z-30 h-6 w-6 cursor-nwse-resize" },
  { edge: "top-right", className: "right-0 top-0 z-30 h-6 w-6 cursor-nesw-resize" },
  { edge: "bottom-left", className: "bottom-0 left-0 z-30 h-6 w-6 cursor-nesw-resize" },
  { edge: "bottom-right", className: "bottom-0 right-0 z-30 h-6 w-6 cursor-nwse-resize" },
];

/** The heading's button class, so every button in it matches its neighbours. */
const FLOATING_CARD_BUTTON =
  "shrink-0 rounded-md p-1 text-stone-500 hover:bg-stone-200/70 hover:text-stone-800";

export type FloatingCard = {
  /** False in a pane, which is not a card and has nowhere to go. */
  floating: boolean;
  view: CardWindowView;
  setView: React.Dispatch<React.SetStateAction<CardWindowView>>;
  /** The card is the window. */
  full: boolean;
  /** The card is on the bottom edge, and holds its heading and no more. */
  minimised: boolean;
  /** Carried and sized by hand: both shapes, never the one put away. */
  sizeable: boolean;
  /** What the reader dragged the card to. A side never dragged is absent. */
  size: { width?: number; height?: number };
  /** The card's own element. Put it on the card with `ref`. */
  cardRef: React.MutableRefObject<HTMLDivElement | null>;
  /** The size the reader gave it, or nothing while it has none. */
  style: React.CSSProperties | undefined;
  /** Where the card stands, at the view it is in. */
  className: string | undefined;
  startDrag: (event: React.PointerEvent) => void;
  startResize: ReturnType<typeof useCardDrag>["startResize"];
};

/**
 * The state of one floating card.
 *
 * `sizeKey` names the card, so the two of them remember their own sizes.
 * Held per card and not stored: one handed out again starts ordinary.
 */
export function useFloatingCard(
  floating: boolean,
  sizeKey: string
): FloatingCard {
  const [view, setView] = React.useState<CardWindowView>("normal");
  const full = floating && view === "full";
  const minimised = floating && view === "minimised";
  /** Sized by hand in either shape, and put away in neither. */
  const sizeable = floating && view !== "minimised";
  const { cardRef, startDrag, cardStyle, size, startResize } = useCardDrag(
    floating,
    sizeKey,
    full
  );

  /**
   * Escape leaves the full view, as it leaves every other dialog.
   *
   * A press on the dimmed page says the same thing, and says it with a
   * mouse. This is the same way out for a reader who is typing.
   */
  React.useEffect(() => {
    if (!full) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // A menu or a dialog open over the card answers the key first.
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]'
        )
      ) {
        return;
      }
      event.preventDefault();
      setView("normal");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [full]);

  return {
    floating,
    view,
    setView,
    full,
    minimised,
    sizeable,
    size,
    cardRef,
    /* Put away, the card has no size of its own: it is its heading, and as
       wide as a heading needs. */
    style: sizeable ? cardStyle : undefined,
    className: floating ? cardWindowClass(view) : undefined,
    startDrag,
    startResize,
  };
}

/**
 * The dimmed page, the edges that size the card, and the heading.
 *
 * Draw it as the card's first child, in this order: the handles stand over
 * the border, above the heading, so a press on the heading's top few pixels
 * sizes the card rather than carrying it.
 */
export function FloatingCardChrome({
  card,
  title,
  hidden,
  onClose,
}: {
  card: FloatingCard;
  /** The heading's words. The subject, or what the card is for. */
  title: string;
  /** The card is out of sight right now, so there is no page to dim. */
  hidden?: boolean;
  onClose: () => void;
}) {
  const t = useMailT();
  if (!card.floating) return null;
  return (
    <>
      {/* Only while there is a card to see: a message on its way out hides
          its card for the length of the Undo, and a dimmed window with
          nothing on it would be all that was left. */}
      <CardWindowBackdrop
        shown={card.full && !hidden}
        onDismiss={() => card.setView("normal")}
      />
      {card.sizeable ? (
        /*
          The card is sized from any edge and any corner, as a window is.

          It had three handles — the left edge, the top edge and the corner
          between them — because a card in the bottom right corner is
          anchored by its other two. But a card that can be carried does
          not stay in the corner, and a reader who has carried one reaches
          for its bottom right and finds nothing. The far edges now carry
          the anchor with them: see `use-card-drag`.

          Thin strips over the border, above the heading, so a press on the
          heading's top few pixels sizes the card rather than carrying it.
          Not while the card is put away: a heading on the bottom edge has
          no size worth choosing.
        */
        <>
          {CARD_HANDLES.map(({ edge, orientation, className }) => (
            <div
              key={edge}
              // A corner is the two edges it joins, and each of those has
              // its own name already. Named again here it would be read
              // out twice.
              {...(orientation
                ? {
                    role: "separator",
                    "aria-orientation": orientation,
                    "aria-label": t("dragToResize"),
                    title: t("dragToResize"),
                  }
                : { "aria-hidden": true })}
              onPointerDown={card.startResize(edge)}
              className={cn("absolute touch-none", className)}
            />
          ))}
        </>
      ) : null}
      <div
        className={cn(
          "flex shrink-0 touch-none select-none items-center gap-2 border-b border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] px-3 py-2",
          card.view === "normal" && "cursor-grab active:cursor-grabbing",
          // Put away, the heading is all there is — so it is also the way
          // back, which is where a reader presses first.
          card.minimised && "cursor-pointer"
        )}
        onPointerDown={card.view === "normal" ? card.startDrag : undefined}
        onClick={
          card.minimised
            ? (event) => {
                if ((event.target as HTMLElement).closest("button, a, input")) {
                  return;
                }
                card.setView("normal");
              }
            : undefined
        }
      >
        {/*
          The title is a name, not a button. It was one in the reply card,
          and a press took the reply back to the thread — so a click on the
          heading, which is also what carries the card, put the card away.
        */}
        <span
          className="min-w-0 flex-1 truncate text-sm font-semibold text-stone-800"
          title={title || undefined}
        >
          {title}
        </span>
        {/* Three buttons, the same three on both cards. Neither heading
            carries a fourth that opens the message where it came from:
            Close leaves the draft where it is, so the two said the same
            thing. The key still does it. */}
        <CardWindowButtons
          view={card.view}
          onChange={card.setView}
          className={FLOATING_CARD_BUTTON}
        />
        <button
          type="button"
          title={t("close")}
          aria-label={t("close")}
          className={FLOATING_CARD_BUTTON}
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </>
  );
}
