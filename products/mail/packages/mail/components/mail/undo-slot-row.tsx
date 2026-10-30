"use client";

/*
 * Where the confirmation of an archive, delete, move, snooze or send is
 * drawn: at the foot of the list, or at the foot of the reader when the
 * list is put away. The rules are in lib/mail/undo-slot.ts.
 */

import * as React from "react";
import { Archive, Clock, FileX, FolderInput, Send, Trash2, Undo2, type LucideIcon } from "lucide-react";

import { useMailT } from "@/lib/mail/i18n";
import { mailUndoSlot, type UndoSlot, type UndoSlotAction, type UndoSlotState } from "@/lib/mail/undo-slot";
import { cn } from "@/lib/utils";

export function useUndoSlot(): UndoSlotState {
  return React.useSyncExternalStore(mailUndoSlot.subscribe, mailUndoSlot.get, mailUndoSlot.get);
}

/**
 * This place is on screen to draw the slot. `on` false is a place that is
 * mounted but not seen (a list put away).
 */
function useUndoSlotPlace(place: "list" | "strip", on: boolean) {
  React.useLayoutEffect(() => {
    if (!on) return;
    return mailUndoSlot.mount(place);
  }, [place, on]);
}

/**
 * The seconds left until `endsAt`, said again each second. A pill is keyed
 * by its slot, so `endsAt` never changes under one.
 */
function useSecondsLeft(endsAt: number | undefined): number {
  const left = React.useCallback(
    () => (endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : 0),
    [endsAt]
  );
  const [now, setNow] = React.useState(left);
  React.useEffect(() => {
    if (!endsAt) return;
    const tick = window.setInterval(() => setNow(left()), 250);
    return () => window.clearInterval(tick);
  }, [endsAt, left]);
  return now;
}

function slotVerb(slot: UndoSlot, left: number): string {
  return slot.countdown ? slot.countdown.verb(left) : slot.verb;
}

/** The same icons as the buttons that do these. */
const ACTION_ICON: Record<UndoSlotAction, LucideIcon> = {
  archive: Archive,
  trash: Trash2,
  move: FolderInput,
  snooze: Clock,
  send: Send,
  discard: FileX,
};

/** The icon, what happened in bold, and what it happened to. */
function SlotWords({ slot }: { slot: UndoSlot }) {
  const Icon = ACTION_ICON[slot.action];
  const verb = slotVerb(slot, useSecondsLeft(slot.countdown?.endsAt));
  return (
    <>
      <Icon aria-hidden className="h-4 w-4 shrink-0 text-[var(--mail-chrome-fg)]" strokeWidth={1.75} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2 text-sm" title={`${verb} ${slot.object}`.trim()}>
        {/* A long verb ("Sends at 14:30, if this computer is on…") gives way
            too, after the subject, so Undo always shows. A countdown
            ("Sending in 4…") is short and never gives way: the seconds are
            the point. */}
        <span
          className={cn(
            "font-semibold text-[var(--mail-chrome-fg)]",
            slot.countdown ? "shrink-0 whitespace-nowrap tabular-nums" : "min-w-0 shrink truncate"
          )}
        >
          {verb}
        </span>
        {slot.object ? <span className="min-w-0 shrink-[4] truncate text-[var(--mail-list-muted)]">{slot.object}</span> : null}
      </span>
    </>
  );
}

/** The navy Undo. */
function UndoButton({ slot }: { slot: UndoSlot }) {
  const t = useMailT();
  return (
    <button
      type="button"
      data-undo-slot-button
      onClick={(e) => {
        e.stopPropagation();
        slot.undo();
      }}
      className="shrink-0 rounded-full bg-[#1b2432] px-3 py-[3px] text-sm font-semibold text-white hover:bg-[#2a3546]"
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

/** One confirmation: a pill that floats over what is under it. */
function SlotPill({ slot }: { slot: UndoSlot }) {
  return (
    <div
      data-undo-card
      className="flex min-w-0 items-center gap-2.5 rounded-full border border-[var(--mail-pane-divider)] bg-[var(--mail-pane)] py-1 pl-4 pr-1 shadow-lg"
    >
      <SlotWords slot={slot} />
      <UndoButton slot={slot} />
    </div>
  );
}

/** The narrow list of faces: the Undo arrow alone, with the words in its tooltip. */
function NarrowUndo({ slots }: { slots: UndoSlot[] }) {
  const t = useMailT();
  const top = slots[0];
  const said = (slot: UndoSlot) => `${slot.verb} ${slot.object}`.trim();
  return (
    <button
      type="button"
      data-undo-slot-button
      title={`${slots.map(said).join("\n")}\n${t("undo")}: ${said(top)}`}
      aria-label={`${t("undo")}: ${said(top)}`}
      onClick={top.undo}
      className="pointer-events-auto relative flex h-9 w-12 items-center justify-center rounded-full bg-[#1b2432] text-white shadow-lg hover:bg-[#2a3546]"
    >
      <Undo2 className="h-4 w-4" />
      {slots.length > 1 ? (
        <span className="absolute -right-1 -top-1 rounded-full bg-[var(--mail-accent)] px-1 text-[10px] font-semibold leading-4 text-white">
          {slots.length}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The confirmations, at the foot of the list or of the reader: newest in
 * front, the older ones peeking out behind it, as the toasts did. The
 * pointer on it spreads them out, each with its own Undo.
 *
 * `place` "list" is the list's foot, while `on` (the list is seen). "strip"
 * is the reader's foot, which draws only while no list is seen, or always
 * when it is `over` everything (the Reader that fills the window).
 * Drawn in a box that is `relative`, over its foot.
 */
export function UndoSlotFoot({
  place,
  on = true,
  over = false,
  narrow,
}: {
  place: "list" | "strip";
  on?: boolean;
  /** Drawn over the list, which cannot be seen under it. */
  over?: boolean;
  /** The narrow list of faces. */
  narrow?: boolean;
}) {
  const { slots, listOn } = useUndoSlot();
  const [open, spread] = useSpread();
  useUndoSlotPlace(place, on);
  const top = slots[0];
  if (!on || !top || (place === "strip" && listOn > 0 && !over)) return null;
  // Behind the newest, the oldest furthest up.
  const rest = slots.slice(1).reverse();
  return (
    <div
      data-undo-foot={place}
      className={cn("pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center", narrow ? "px-1" : "px-3")}
    >
      {narrow ? (
        <div data-undo-slot role="status" className="flex">
          <NarrowUndo slots={slots} />
        </div>
      ) : (
        <div
          data-undo-slot
          role="status"
          className="pointer-events-auto flex w-max min-w-0 max-w-full flex-col items-stretch"
          {...spread}
        >
          {open
            ? rest.map((slot) => (
                <div key={slot.id} className="mb-1 flex min-w-0">
                  <SlotPill slot={slot} />
                </div>
              ))
            : rest.slice(-2).map((slot, i, shown) => (
                // The edge of the one behind: a strip of a pill above it,
                // a little narrower each step back, as a stack of toasts.
                <div
                  key={slot.id}
                  aria-hidden
                  data-undo-slot-edge
                  className={cn(
                    "mx-auto h-1.5 rounded-t-full border border-b-0 border-[var(--mail-pane-divider)] bg-[var(--mail-pane)] brightness-[0.97]",
                    shown.length - i === 1 ? "w-[calc(100%-24px)]" : "w-[calc(100%-48px)] brightness-[0.94]"
                  )}
                />
              ))}
          <SlotPill key={top.id} slot={top} />
        </div>
      )}
    </div>
  );
}
