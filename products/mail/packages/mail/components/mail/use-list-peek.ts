"use client";

/**
 * The mail list put away, and shown again from the edge.
 *
 * - `useListHidden`: whether the reader has put the list away, kept on this
 *   machine. It stays put away from one thread to the next, and with
 *   nothing open, when the resting picture takes the pane.
 * - `useListPeek`: while it is put away, the pointer at the list's edge
 *   brings it out over the reader, with the folders beside it when they
 *   are shown, and they go again when the pointer leaves them. What comes
 *   out is marked `data-mail-peek`. Menus they open are drawn outside them
 *   (portals), so the pointer on one of those does not count as leaving.
 */

import { MAIL_LIST_HIDDEN_KEY as KEY } from "@/lib/mail/storage-keys";
import * as React from "react";

export function useListHidden(): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [hidden, setHidden] = React.useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      if (hidden) window.localStorage.setItem(KEY, "1");
      else window.localStorage.removeItem(KEY);
    } catch {
      /* private mode: kept for as long as the window is open */
    }
  }, [hidden]);
  return [hidden, setHidden];
}

/**
 * The list put away, but out again while a search is on: the search's
 * answers are in the list, and a search into a hidden list showed nothing.
 * Cleared, the list goes away again. Put away during the search, it stays
 * away until the search is cleared. The choice that is kept is the reader's
 * own; a search never changes it.
 */
export function useListHiddenUnlessSearching(
  search: string
): [boolean, React.Dispatch<React.SetStateAction<boolean>>, boolean] {
  const [hidden, setHidden] = useListHidden();
  const searching = search.trim().length > 0;
  const [putAway, setPutAway] = React.useState(false);
  // A cleared search forgets that the list was put away during it. Done as
  // the search changes, while drawing, so no frame shows the old answer.
  const [wasSearching, setWasSearching] = React.useState(searching);
  if (wasSearching !== searching) {
    setWasSearching(searching);
    if (!searching) setPutAway(false);
  }
  const shownHidden = hidden && (!searching || putAway);
  const set = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (next) => {
      const value = typeof next === "function" ? next(shownHidden) : next;
      if (searching && value) setPutAway(true);
      setHidden(value);
    },
    [searching, shownHidden, setHidden]
  );
  /*
    Put away, and out only for the search. Its button is then the pin, as
    when it comes out from the edge: the reader asked for it away, and a
    hide button over a list that was hidden already read as nonsense.
  */
  const outForSearch = hidden && searching && !putAway;
  return [shownHidden, set, outForSearch];
}

/** Drawn outside the list but part of it: its menus, popovers and dialogs. */
const OUTSIDE_BUT_OURS =
  '[data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [role="listbox"]';

export type ListPeek = {
  on: boolean;
  peek: () => void;
  unpeek: () => void;
};

/**
 * How far past what came out the pointer may stray and keep it out.
 *
 * Its edge is where it is sized from, and the reader reaching for the edge
 * overshoots it. Then the list goes away under the pointer before the drag
 * can start. A margin beside it, as wide as a fingertip's slip, forgives that.
 */
const PEEK_MARGIN_PX = 24;

function nearPeek(event: PointerEvent): boolean {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const el of document.querySelectorAll("[data-mail-peek]")) {
    const rect = el.getBoundingClientRect();
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  }
  return (
    event.clientX >= left - PEEK_MARGIN_PX &&
    event.clientX <= right + PEEK_MARGIN_PX &&
    event.clientY >= top &&
    event.clientY <= bottom
  );
}

export function useListPeek(hidden: boolean): ListPeek {
  const [on, setOn] = React.useState(false);
  const peek = React.useCallback(() => setOn(true), []);
  const unpeek = React.useCallback(() => setOn(false), []);

  // Shown for good, or with nothing open: nothing to peek at.
  if (on && !hidden) setOn(false);

  React.useEffect(() => {
    if (!on) return;
    const onMove = (event: PointerEvent) => {
      // A button held down is a drag or a selection under way.
      if (event.buttons) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-mail-peek]")) return;
      if (target.closest(OUTSIDE_BUT_OURS)) return;
      if (nearPeek(event)) return;
      setOn(false);
    };
    /*
      A message is drawn in a frame of its own, and a pointer over a frame
      moves in the frame's document: this one hears no more moves, and the
      list stayed out. Going into a frame is still heard here, so it goes
      then — from wherever the pointer was. Heard only when it came from
      the list, the list stayed out when the pointer crossed the strip
      beside it (PEEK_MARGIN_PX) on its way into a message.
    */
    const onOut = (event: PointerEvent) => {
      if (event.buttons) return;
      const to = event.relatedTarget;
      if (to instanceof HTMLIFrameElement) {
        if (!to.closest("[data-mail-peek]") && !to.closest(OUTSIDE_BUT_OURS)) setOn(false);
        return;
      }
      // Out of the window altogether, from the list: it goes too. Anywhere
      // else in this document, the moves above decide.
      const from = event.target;
      if (!(from instanceof Element) || !from.closest("[data-mail-peek]")) return;
      if (to instanceof Element) return;
      setOn(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(OUTSIDE_BUT_OURS)) setOn(false);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerout", onOut);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
      document.removeEventListener("keydown", onKey);
    };
  }, [on]);

  return { on: on && hidden, peek, unpeek };
}

/*
  Pinned from the edge: the list is already out, over the reader, so it
  takes its place in the row without a slide. A slide brings it in from
  nothing, though it was on screen a moment before: put away, then out again.
  Set by the pin; the list's sweep reads it once (use-mail-pane-geometry).
*/
let pinnedInPlace = false;
export function pinListInPlace(): void {
  pinnedInPlace = true;
}
export function takePinnedInPlace(): boolean {
  const was = pinnedInPlace;
  pinnedInPlace = false;
  return was;
}
