"use client";

/*
 * Where the confirmation of an archive, delete, move or snooze is drawn:
 * in the list, where the row was, or in the reader's toolbar when the list
 * is put away. The rules are in lib/mail/undo-slot.ts.
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { Archive, Clock, FolderInput, Trash2, Undo2, type LucideIcon } from "lucide-react";

import { useMailT } from "@/lib/mail/i18n";
import { mailUndoSlot, placeUndoSlot, type UndoSlot, type UndoSlotAction, type UndoSlotState } from "@/lib/mail/undo-slot";
import { cn } from "@/lib/utils";

export function useUndoSlot(): UndoSlotState {
  return React.useSyncExternalStore(mailUndoSlot.subscribe, mailUndoSlot.get, mailUndoSlot.get);
}

/**
 * This place is on screen to draw the slot. `on` false is a place that is
 * mounted but not seen (a list put away).
 */
export function useUndoSlotPlace(place: "list" | "strip", on: boolean) {
  React.useLayoutEffect(() => {
    if (!on) return;
    return mailUndoSlot.mount(place);
  }, [place, on]);
}

/** The list: where the slot goes among these day groups, if it has one. */
export function useUndoSlotPlacement<G extends { items: readonly { lastAt: string }[] }>(
  groups: readonly G[],
  skip?: (group: G) => boolean
): { slot: UndoSlot; group: number; index: number } | null {
  const { slot } = useUndoSlot();
  return React.useMemo(() => {
    if (!slot?.lastAt) return null;
    const at = placeUndoSlot(groups, slot.lastAt, skip);
    return at ? { slot, ...at } : null;
  }, [slot, groups, skip]);
}

function slotText(slot: UndoSlot): string {
  return `${slot.verb} ${slot.object}`;
}

/** The same icons as the toolbar buttons that do these. */
const ACTION_ICON: Record<UndoSlotAction, LucideIcon> = {
  archive: Archive,
  trash: Trash2,
  move: FolderInput,
  snooze: Clock,
};

/**
 * The icon, what happened in bold, and what it happened to. In the list
 * `face` is the width of the rows' faces: the icon stands centred where a
 * face stands, and the words start where the names do.
 */
function SlotWords({ slot, face }: { slot: UndoSlot; face?: "small" | "large" }) {
  const Icon = ACTION_ICON[slot.action];
  const icon = <Icon aria-hidden className="h-4 w-4 shrink-0 text-[var(--mail-chrome-fg)]" strokeWidth={1.75} />;
  return (
    <>
      {face ? (
        <span aria-hidden className={cn("flex shrink-0 justify-center", face === "small" ? "w-7" : "w-9")}>
          {icon}
        </span>
      ) : (
        icon
      )}
      <span className="flex min-w-0 flex-1 items-baseline gap-2 text-sm" title={slotText(slot)}>
        <span className="shrink-0 font-semibold text-[var(--mail-chrome-fg)]">{slot.verb}</span>
        <span className="min-w-0 truncate text-[var(--mail-list-muted)]">{slot.object}</span>
      </span>
    </>
  );
}

/** The navy Undo, the same as the one under a sent message (undo-send). */
function UndoButton({ slot, className }: { slot: UndoSlot; className?: string }) {
  const t = useMailT();
  return (
    <button
      type="button"
      data-undo-slot-button
      onClick={(e) => {
        e.stopPropagation();
        slot.undo();
      }}
      className={cn(
        "shrink-0 rounded-full bg-[#1b2432] px-3 py-0.5 text-sm font-semibold text-white hover:bg-[#2a3546]",
        className
      )}
    >
      {t("undo")}
    </button>
  );
}

/**
 * The pointer on the stack: it spreads out, and every time stops. Off it:
 * it closes up, and the times go on.
 */
function useSpread(): [boolean, { onPointerEnter: () => void; onPointerLeave: () => void }] {
  const [open, setOpen] = React.useState(false);
  // Leaving the page with the pointer still on it must not hold the times.
  React.useEffect(() => () => mailUndoSlot.hold(false), []);
  return [
    open,
    {
      onPointerEnter: () => {
        setOpen(true);
        mailUndoSlot.hold(true);
      },
      onPointerLeave: () => {
        setOpen(false);
        mailUndoSlot.hold(false);
      },
    },
  ];
}

/** One confirmation, as a card in the list. */
function SlotCard({ slot, smallFaces }: { slot: UndoSlot; smallFaces?: boolean }) {
  return (
    <div
      data-undo-card
      className={cn(
        // The rows' own measures: the face starts 24px in (the card's 8px
        // and 16px here, as ROW_PAD_LEFT), the name a gap after it, and the
        // Undo ends 18px from the edge, where the time does.
        "flex min-w-0 items-center rounded-surface bg-[var(--mail-row-hover)] py-3 pl-4 pr-2.5",
        smallFaces ? "gap-2.5" : "gap-3"
      )}
    >
      <SlotWords slot={slot} face={smallFaces ? "small" : "large"} />
      <UndoButton slot={slot} />
    </div>
  );
}

/**
 * The rows that left, as their confirmations: a stack, newest on top, the
 * older ones peeking out under it, as the toasts did. The pointer on it
 * spreads it out, each with its own Undo. In the avatar rail it is the
 * Undo arrow alone, for the newest, with the words in its tooltip.
 */
export function UndoSlotRow({
  narrow,
  smallFaces,
}: {
  narrow?: boolean;
  /** The rows' faces are the small ones (compact, not wide): 28px, not 36. */
  smallFaces?: boolean;
}) {
  const t = useMailT();
  const { slots } = useUndoSlot();
  const [open, spread] = useSpread();
  const top = slots[0];
  if (!top) return null;
  const rest = slots.slice(1);
  if (narrow) {
    const text = slots.map(slotText).join("\n");
    return (
      <div
        data-undo-slot
        className="flex items-center justify-center bg-[var(--mail-row-hover)] px-1 py-1.5 shadow-[inset_0_-1px_0_var(--mail-row-line)]"
        {...spread}
      >
        <button
          type="button"
          data-undo-slot-button
          title={`${text}\n${t("undo")}: ${slotText(top)}`}
          aria-label={`${t("undo")}: ${slotText(top)}`}
          onClick={top.undo}
          className="relative flex h-9 w-12 items-center justify-center rounded-full bg-[#1b2432] text-white hover:bg-[#2a3546]"
        >
          <Undo2 className="h-4 w-4" />
          {rest.length ? (
            <span className="absolute -right-1 -top-1 rounded-full bg-[var(--mail-accent)] px-1 text-[10px] font-semibold leading-4 text-white">
              {slots.length}
            </span>
          ) : null}
        </button>
      </div>
    );
  }
  return (
    <div data-undo-slot role="status" className="px-2 py-[2px]" {...spread}>
      <SlotCard slot={top} smallFaces={smallFaces} />
      {open
        ? rest.map((slot) => (
            <div key={slot.id} className="mt-1">
              <SlotCard slot={slot} smallFaces={smallFaces} />
            </div>
          ))
        : rest.slice(0, 2).map((slot, i) => (
            // The edge of the one under: a strip of a card, a little
            // narrower each step down, as a stack of toasts looks.
            <div
              key={slot.id}
              aria-hidden
              data-undo-slot-edge
              className={cn(
                "mx-auto h-1.5 rounded-b-control bg-[var(--mail-row-hover)] brightness-[0.97]",
                i === 0 ? "w-[calc(100%-16px)]" : "w-[calc(100%-32px)] brightness-[0.94]"
              )}
            />
          ))}
    </div>
  );
}

/**
 * The reader toolbar's copy, after its buttons, for when there is no list
 * on screen to hold the rows. The newest, with how many more; the pointer
 * on it lists the rest under it. It gives way to the buttons: the words
 * cut short before a button moves behind the ellipsis.
 */
export function UndoSlotPill() {
  const { slots, listOn } = useUndoSlot();
  const [open, spread] = useSpread();
  const ref = React.useRef<HTMLDivElement>(null);
  useUndoSlotPlace("strip", true);
  const top = slots[0];
  if (!top || listOn > 0) return null;
  const rest = slots.slice(1);
  const box = open && rest.length ? ref.current?.getBoundingClientRect() : null;
  return (
    <div
      ref={ref}
      data-undo-slot
      role="status"
      className="ml-2 flex min-w-0 shrink items-center gap-2 rounded-full bg-[var(--mail-row-hover)] py-0.5 pl-3 pr-0.5"
      {...spread}
    >
      <SlotWords slot={top} />
      {rest.length ? (
        <span className="shrink-0 text-xs font-semibold text-[var(--mail-list-muted)]">+{rest.length}</span>
      ) : null}
      <UndoButton slot={top} className="py-[3px]" />
      {box
        ? createPortal(
            // The rest, hung under the pill: the toolbar clips what leaves it.
            <div
              data-undo-slot-more
              className="mail-shell fixed z-[100] flex w-max max-w-[28rem] flex-col gap-1 pt-1"
              style={{ left: box.left, top: box.bottom }}
              {...spread}
            >
              {rest.map((slot) => (
                <div
                  key={slot.id}
                  className="flex min-w-0 items-center gap-2 rounded-full bg-[var(--mail-row-hover)] py-0.5 pl-3 pr-0.5 shadow-md"
                >
                  <SlotWords slot={slot} />
                  <UndoButton slot={slot} className="py-[3px]" />
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
