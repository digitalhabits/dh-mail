"use client";

/**
 * A recipient being carried from one field to another.
 *
 * To, Cc and Bcc are three fields that do not know about each other, and
 * moving somebody between them meant taking them out of one and typing
 * them into the next. The chip carries what it is and how to take it out
 * of where it came from, so the place it lands on can finish the move by
 * itself — no field has to know what the others are.
 *
 * The carry runs on pointer events, not on the browser's drag-and-drop.
 * The Mac app's web view is WebKit, and its drag-and-drop came to the
 * chips as a drag that started and then never landed: no drop event
 * arrived, so the chip could be lifted but not moved. A pointer is the
 * same in every engine, and a test can walk it.
 *
 * A place to drop is anything marked with `data-recipient-drop`: each
 * field, and the Cc and Bcc buttons that stand in for a row not shown
 * yet. Without a provider round them there is nothing to carry to, and
 * the chips are simply not carried.
 */

import * as React from "react";

import { recipientKey, type MailRecipient } from "@/lib/mail/contact-list-types";
import { cn } from "@/lib/utils";

export type CarriedRecipient = {
  /** The drop place the chip came from: dropping it there does nothing. */
  fromId: string;
  recipient: MailRecipient;
  /** Take it out of the field it came from, once it has landed. */
  takeFromSource: () => void;
};

type Accept = (recipient: MailRecipient) => void;

type CarryState = {
  carried: CarriedRecipient | null;
  /** The drop place under the pointer, when it is not the source. */
  overId: string | null;
  /** Called on a chip's pointer-down: carries it once the pointer moves. */
  lift: (event: React.PointerEvent, carried: CarriedRecipient, onStart: () => void) => void;
  register: (id: string, accept: Accept) => () => void;
};

const RecipientCarry = React.createContext<CarryState | null>(null);

export const useRecipientCarry = () => React.useContext(RecipientCarry);

/** How far the pointer moves before a press becomes a carry. */
const LIFT_DISTANCE = 4;

/** `list` with `recipient` at its end, unless it is there already. */
export function withRecipient(list: MailRecipient[], recipient: MailRecipient) {
  const key = recipientKey(recipient);
  return list.some((r) => recipientKey(r) === key) ? list : [...list, recipient];
}

/**
 * The drop place under the pointer, looked up by the point.
 *
 * Not the event's target: a finger keeps sending its events to where it
 * went down, and so does a mouse once something has captured the pointer.
 * The floating reply card did that, and a chip carried in it never found
 * the field it was over (2026-10-19). The ghost lets the point through.
 */
function dropIdAt(event: PointerEvent): string | null {
  let el: Element | null = event.target instanceof Element ? event.target : null;
  if (typeof document.elementFromPoint === "function") {
    el = document.elementFromPoint(event.clientX, event.clientY) ?? el;
  }
  const place = el?.closest("[data-recipient-drop]");
  return place?.getAttribute("data-recipient-drop") ?? null;
}

/** A copy of the chip that follows the pointer while it is carried. */
function makeGhost(chip: HTMLElement | null) {
  if (!chip) return null;
  const ghost = chip.cloneNode(true) as HTMLElement;
  const box = chip.getBoundingClientRect();
  Object.assign(ghost.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    margin: "0",
    zIndex: "2147483647",
    pointerEvents: "none",
    opacity: "0.9",
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.18)",
  });
  document.body.appendChild(ghost);
  const offset = { x: box.width / 2, y: box.height / 2 };
  return {
    move: (x: number, y: number) => {
      ghost.style.transform = `translate(${x - offset.x}px, ${y - offset.y}px)`;
    },
    remove: () => ghost.remove(),
  };
}

/** The page may not select text while a chip is carried across it. */
function holdSelection() {
  const style = document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string };
  const before = [style.userSelect, style.webkitUserSelect ?? "", style.cursor];
  style.userSelect = "none";
  style.webkitUserSelect = "none";
  style.cursor = "grabbing";
  return () => {
    [style.userSelect, style.webkitUserSelect, style.cursor] = before;
  };
}

/** The click that ends a carry is not a click on what it ended over. */
function swallowNextClick() {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}

export function RecipientCarryProvider({ children }: { children: React.ReactNode }) {
  const [carried, setCarried] = React.useState<CarriedRecipient | null>(null);
  const [overId, setOverId] = React.useState<string | null>(null);
  const targets = React.useRef(new Map<string, Accept>()).current;

  const register = React.useCallback(
    (id: string, accept: Accept) => {
      targets.set(id, accept);
      return () => {
        if (targets.get(id) === accept) targets.delete(id);
      };
    },
    [targets]
  );

  const lift = React.useCallback(
    (event: React.PointerEvent, next: CarriedRecipient, onStart: () => void) => {
      if (event.button !== 0) return;
      if ((event.target as HTMLElement).closest("[data-chip-remove]")) return;
      const chip = event.currentTarget as HTMLElement;
      const start = { x: event.clientX, y: event.clientY };
      const pointerId = event.pointerId;
      let ghost: ReturnType<typeof makeGhost> = null;
      let release: (() => void) | null = null;
      let over: string | null = null;

      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", finish);
        window.removeEventListener("keydown", onKey, true);
        ghost?.remove();
        release?.();
        setCarried(null);
        setOverId(null);
      };
      const onMove = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        if (!release) {
          if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < LIFT_DISTANCE) return;
          release = holdSelection();
          ghost = makeGhost(chip);
          onStart();
          setCarried(next);
        }
        ghost?.move(e.clientX, e.clientY);
        const id = dropIdAt(e);
        over = id && id !== next.fromId && targets.has(id) ? id : null;
        setOverId(over);
      };
      const onUp = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        const wasCarried = release != null;
        finish();
        if (!wasCarried) return;
        swallowNextClick();
        const accept = over ? targets.get(over) : undefined;
        if (!accept) return;
        accept(next.recipient);
        next.takeFromSource();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !release) return;
        e.preventDefault();
        e.stopPropagation();
        finish();
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", finish);
      window.addEventListener("keydown", onKey, true);
    },
    [targets]
  );

  const value = React.useMemo(
    () => ({ carried, overId, lift, register }),
    [carried, overId, lift, register]
  );
  return <RecipientCarry.Provider value={value}>{children}</RecipientCarry.Provider>;
}

/**
 * Marks a place a carried recipient may land, and says whether one is
 * over it now. `accept` is read at the drop, so it may close over the
 * latest list.
 */
export function useRecipientDrop(id: string, accept: Accept) {
  const carry = useRecipientCarry();
  const acceptRef = React.useRef(accept);
  React.useLayoutEffect(() => {
    acceptRef.current = accept;
  });
  const register = carry?.register;
  React.useEffect(
    () => register?.(id, (r) => acceptRef.current(r)),
    [register, id]
  );
  const carrying = carry?.carried != null && carry.carried.fromId !== id;
  return {
    dropProps: carry ? { "data-recipient-drop": id } : {},
    carrying,
    over: carrying && carry?.overId === id,
  };
}

/**
 * A button that stands in for a field not shown yet — Cc or Bcc — and
 * takes a recipient dropped on it. So somebody can be moved to Bcc
 * without Bcc being opened first.
 */
export function RecipientDropZone({
  onDropRecipient,
  children,
}: {
  onDropRecipient: Accept;
  children: React.ReactNode;
}) {
  const id = React.useId();
  const { dropProps, carrying, over } = useRecipientDrop(id, onDropRecipient);
  return (
    <span
      {...dropProps}
      className={cn(
        "inline-flex rounded-inner",
        carrying && "text-teal-700",
        over && "ring-2 ring-teal-500/60"
      )}
    >
      {children}
    </span>
  );
}
