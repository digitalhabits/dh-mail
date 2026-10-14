"use client";

/**
 * The reply composer inside the Reader.
 *
 * There is one composer for a thread, and the thread pane holds it. When
 * Reply or Forward is pressed in the Reader, the pane draws that same
 * composer at the foot of the Reader's column, through a portal. The words,
 * the recipients, the files and the draft stay in the pane's state, so
 * nothing is copied and nothing is lost when the composer moves.
 *
 * - The pane makes the slot (`useReaderComposerSlot`) and gives it to the
 *   bubbles through `ReaderComposerContext`.
 * - The Reader puts a host element in the slot while it is open, and says
 *   when it wants the composer (`shown`).
 * - The pane draws the composer band into the host while both are there
 *   (`ComposerHome`). In all other cases the band stays in the pane.
 *
 * When the Reader closes, or Esc puts the composer away, the host or the
 * request goes. The band then goes back to the pane with the words in it.
 * The editor is made again there from the words in the pane's state.
 */

import * as React from "react";
import { createPortal } from "react-dom";

export type ReaderComposerSlot = {
  /** Where the Reader wants the composer drawn: the foot of its column. */
  host: HTMLElement | null;
  setHost: (el: HTMLElement | null) => void;
  /** Reply or Forward was pressed in the Reader, and Esc did not undo it. */
  shown: boolean;
  setShown: (shown: boolean) => void;
  /** A composer is open in the pane. */
  open: boolean;
  /** The composer fills the pane, or it moves to or from that state. */
  cover: boolean;
};

/** The pane's slot. Null where no pane gives one: a chat window, the floating card. */
export const ReaderComposerContext = React.createContext<ReaderComposerSlot | null>(null);

/** The slot as the Reader reads it. Null when the composer cannot come into the Reader. */
export function useReaderComposer(): ReaderComposerSlot | null {
  return React.useContext(ReaderComposerContext);
}

/** The pane's half: the host and the request, and what the pane tells the Reader. */
export function useReaderComposerSlot(open: boolean, cover: boolean): ReaderComposerSlot {
  const [host, setHost] = React.useState<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(false);
  return React.useMemo(
    () => ({ host, setHost, shown, setShown, open, cover }),
    [host, shown, open, cover]
  );
}

/** The composer is drawn in the Reader now. */
export function composerInReader(slot: ReaderComposerSlot | null): boolean {
  return Boolean(slot && slot.host && slot.shown);
}

/** The band: in the Reader while it asks for it, in the pane at all other times. */
export function ComposerHome({
  slot,
  children,
}: {
  slot: ReaderComposerSlot | null;
  children: React.ReactNode;
}) {
  if (slot?.host && slot.shown) return createPortal(children, slot.host);
  return <>{children}</>;
}

/** The marker on the Reader's host element. */
export const READER_COMPOSER_ATTR = "data-reader-composer";

/** The element is inside a composer that the Reader shows. */
export function inReaderComposer(el: Element | null): boolean {
  return Boolean(el?.closest?.(`[${READER_COMPOSER_ATTR}]`));
}

/**
 * A composer is open inside a Reader now.
 *
 * The pane's own Esc (which asks to discard the draft) stands down then:
 * in the Reader, Esc puts the composer away and keeps the draft.
 */
export function readerHoldsComposer(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(`[${READER_COMPOSER_ATTR}] .mail-composer-region`));
}
