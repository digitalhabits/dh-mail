"use client";

/*
 * The keys MailPage answers on the window, off the page: Escape out of a
 * folder, Down and Up through the list (threads or people), the search
 * field, the two text sizes, the list's expand, a new message, and
 * Command+Z.
 *
 * Owns: the one keydown listener and the rules of which key does what,
 * including when a key is left alone (typing, or inside a menu or dialog).
 *
 * Does not own: what a key then does. Every action is the page's, passed
 * in. The thread's own keys (archive, delete, reply…) are ThreadPane's,
 * and a selection's are SelectionPane's.
 *
 * One effect: the listener. The page calls this hook where it always
 * stood. New window keys go in this file, not in MailPage.
 */

import * as React from "react";

import type { MailViewMode } from "@/components/mail/MailListControls";
import { nextZoomStop } from "@/components/mail/use-mail-layout";
import type { ActiveMailFolder } from "@/components/mail/mail-list-state";
import type { PersonRow } from "@/lib/mail/person-participants";
import {
  shortcutMatchesEvent,
  type MailShortcut,
  type MailShortcutAction,
} from "@/lib/mail/shortcuts";
import { rowStandsFor, threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";
import { nextUiScaleStop } from "@/lib/mail/ui-scale";

/** Where Down or Up goes from `from` in a list of `length`; -1 is no place yet, and goes to the top. */
function stepIndex(from: number, key: string, length: number): number {
  if (from === -1) return 0;
  return key === "ArrowDown" ? Math.min(from + 1, length - 1) : Math.max(from - 1, 0);
}

/**
 * Focus the row the keys moved to, and bring it into view, once it is
 * painted as selected, and only as far as it needs to go: a selection two
 * rows down should not re-centre the list. Found by reading each row's
 * key rather than by a selector, because a thread id is not safe to put
 * in one.
 *
 * Focus as well as select. Each row is focusable, so the ring the browser
 * draws stays on whichever one was last clicked: it sat on the row at the
 * top while the selection walked away from it.
 */
function focusRowAfterPaint(key: "personKey" | "threadKey", wanted: string): void {
  const selector = key === "personKey" ? "[data-person-key]" : "[data-thread-key]";
  requestAnimationFrame(() => {
    for (const row of document.querySelectorAll<HTMLElement>(selector)) {
      if (row.dataset[key] !== wanted) continue;
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: "nearest" });
      break;
    }
  });
}

export function useMailWindowKeys({
  undoLastMailAction,
  hasMailUndo,
  startCompose,
  selected,
  activeFolder,
  setActiveFolder,
  adjustZoom,
  shortcuts,
  toggleListExpanded,
  detailOpen,
  uiScale,
  setUiScale,
  zoom,
  viewMode,
  selectedPersonKey,
  landOnPerson,
  personRowOrderRef,
  screenThreadOrderRef,
  openThreadRef,
  searchInputRef,
}: {
  undoLastMailAction: () => Promise<void>;
  hasMailUndo: () => boolean;
  startCompose: () => void;
  /** The open thread, which Down and Up count from. */
  selected: { account: string; threadId: string } | null;
  activeFolder: ActiveMailFolder | null;
  setActiveFolder: (folder: ActiveMailFolder | null) => void;
  adjustZoom: (delta: number) => void;
  shortcuts: Record<MailShortcutAction, MailShortcut>;
  toggleListExpanded: () => void;
  /** A thread or a composer is on screen: Cmd+Plus/Minus is its zoom. */
  detailOpen: boolean;
  uiScale: number;
  setUiScale: (value: number) => void;
  zoom: number;
  viewMode: MailViewMode;
  selectedPersonKey: string | null;
  landOnPerson: (row?: PersonRow | null) => void;
  personRowOrderRef: React.RefObject<PersonRow[]>;
  screenThreadOrderRef: React.RefObject<MailThreadSummary[]>;
  openThreadRef: React.RefObject<((t: MailThreadSummary) => void) | null>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
}): void {
  React.useEffect(() => {
    /** Down and Up in the people view: the next person, landed on as a click lands. */
    const walkPeople = (e: KeyboardEvent) => {
      const people = personRowOrderRef.current;
      if (!people.length) return;
      e.preventDefault();
      const from = selectedPersonKey
        ? people.findIndex((r) => r.key === selectedPersonKey)
        : -1;
      const to = stepIndex(from, e.key, people.length);
      const person = people[to];
      if (!person || to === from) return;
      // The same landing a click makes, so a person with one thread
      // opens it here too rather than showing a card to press.
      landOnPerson(person);
      focusRowAfterPaint("personKey", person.key);
    };

    /** Down and Up in the thread list: the next thread, opened. */
    const walkThreads = (e: KeyboardEvent) => {
      const rows = screenThreadOrderRef.current;
      if (!rows.length) return;
      e.preventDefault();
      const at = selected
        ? rows.findIndex((t) => rowStandsFor(t, selected))
        : -1;
      // Nothing selected yet: the first key press takes the top row rather
      // than counting from a place the reader never was.
      const next = stepIndex(at, e.key, rows.length);
      const target = rows[next];
      // Already at the end being asked for. Re-opening the same row would
      // refetch and re-focus it for no movement at all.
      if (!target || next === at) return;
      openThreadRef.current?.(target);
      focusRowAfterPaint("threadKey", threadKey(target));
    };

    /** The text size keys. True when the key was one of them. */
    const sizeKey = (e: KeyboardEvent): boolean => {
      // Option+Cmd+Plus/Minus/0 → the app text size, in every state.
      //
      // Always the app. It does not depend on a thread being open or focused.
      // Cmd+Plus/Minus keeps meaning the thing being read or written.
      //
      // `code` rather than `key`: Option turns those keys into other marks
      // (≠, –, º), the same trap as Option+F in onKeyDown. The Cmd+Plus/Minus
      // branch after it still reads `key`, because that is what is right
      // without Option.
      //
      // It fires while typing as well. The composer is part of what is
      // resized, and someone who resizes the app while writing means it.
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey) {
        if (e.code === "Equal") {
          e.preventDefault();
          setUiScale(nextUiScaleStop(uiScale, 1));
          return true;
        }
        if (e.code === "Minus") {
          e.preventDefault();
          setUiScale(nextUiScaleStop(uiScale, -1));
          return true;
        }
        if (e.code === "Digit0") {
          e.preventDefault();
          setUiScale(1);
          return true;
        }
      }

      // Cmd/Ctrl+Plus and Cmd/Ctrl+Minus → the text size the +/− controls set
      // when a thread or a composer is open. With nothing open they step the
      // app size instead, so the keys are never dead.
      //
      // That fallthrough is a convenience. Option+Cmd+Plus/Minus is the rule:
      // it is the app in every state, including this one, where both do the
      // same thing.
      //
      // The test is `detailOpen`. It is visible on the screen. Do not use
      // focus. Focus is invisible, and the two scales then drift with nobody
      // able to tell which key moved which.
      //
      // This is read before onKeyDown's Shift test on purpose. A US keyboard makes
      // "+" with Shift, and a Danish one has a key for it, so the Shift state
      // says nothing here. Both layouts are read by `key`, not `code`.
      //
      // It fires while typing as well: the composer shows the same control,
      // and no text field does anything else with these.
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.key === "+" || e.key === "=") {
          // Without this the webview zooms the whole window instead.
          e.preventDefault();
          if (detailOpen) {
            // To the next round size, not a tenth on from wherever a pinch
            // happened to stop — see `nextZoomStop`.
            adjustZoom(nextZoomStop(zoom, 1) - zoom);
          } else {
            setUiScale(nextUiScaleStop(uiScale, 1));
          }
          return true;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          if (detailOpen) {
            adjustZoom(nextZoomStop(zoom, -1) - zoom);
          } else {
            setUiScale(nextUiScaleStop(uiScale, -1));
          }
          return true;
        }
      }
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // A key can land on the document itself, which has no `closest`.
      const target = e.target instanceof Element ? e.target : null;
      const typing = Boolean(
        target?.closest('input, textarea, [contenteditable="true"]')
      );
      /**
       * A key pressed inside an open menu belongs to that menu.
       *
       * These shortcuts live on the window, so they answered keys pressed
       * anywhere — including inside a popover the reader had just opened.
       * Down in the snooze menu moved the selected thread, which is the
       * one thing that must not happen while you are choosing what to do
       * with the thread you are on.
       */
      if (
        target?.closest(
          '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]'
        )
      ) {
        return;
      }

      // Escape → leave the open folder (back to inbox tabs).
      if (
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key === "Escape" &&
        activeFolder
      ) {
        e.preventDefault();
        setActiveFolder(null);
        return;
      }

      /**
       * Down and Up move the selection to the next message.
       *
       * They were scrolling the list and leaving the selection where it was,
       * which is not what a list with a selection in it does — the reader
       * loses sight of the row they are on and nothing follows the keys.
       */
      if (
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "ArrowDown" || e.key === "ArrowUp")
      ) {
        /*
          In the by-person view the list is people, so the keys walk people.

          They walked threads there too, because this handler knew only one
          kind of list. The rows under the reader's eyes did not move, and a
          thread they could not see opened in the pane beside them.
        */
        if (viewMode === "people") walkPeople(e);
        else walkThreads(e);
        return;
      }

      // Backspace deletes, and Cmd+Shift+A archives. Both are thread
      // shortcuts now, and editable — see lib/mail/shortcuts and ThreadPane.

      // Cmd/Ctrl+Option+F → the mail search box, from anywhere including an
      // open thread. Apple Mail puts mailbox search here and Forward on
      // Cmd+Shift+F, which is where the thread shortcuts put it too. Plain
      // Cmd+F belongs to find-in-thread; see `use-thread-find.ts`.
      //
      // `code` rather than `key`: macOS turns Option+F into "ƒ".
      if (
        (e.metaKey || e.ctrlKey) &&
        e.altKey &&
        !e.shiftKey &&
        e.code === "KeyF"
      ) {
        e.preventDefault();
        const field = searchInputRef.current;
        field?.focus();
        field?.select();
        return;
      }

      if (sizeKey(e)) return;

      // Option+Cmd+L expands the list. The next line used to drop every
      // Option chord, so this has to be read first.
      if (shortcutMatchesEvent(e, shortcuts.expandList)) {
        if (typing || e.repeat) return;
        e.preventDefault();
        toggleListExpanded();
        return;
      }

      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();

      // Cmd/Ctrl+N → Compose (block the browser's New Window).
      if (key === "n") {
        e.preventDefault();
        startCompose();
        return;
      }

      // Cmd/Ctrl+Z → undo one archive/trash (not while typing — editor undo).
      if (key === "z") {
        if (typing || e.repeat || !hasMailUndo()) return;
        e.preventDefault();
        void undoLastMailAction();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    undoLastMailAction,
    hasMailUndo,
    startCompose,
    selected,
    activeFolder,
    adjustZoom,
    shortcuts,
    toggleListExpanded,
    // Which of the two scales Cmd+Plus/Minus moves — see the branch.
    detailOpen,
    uiScale,
    setUiScale,
    // Read to work out the next round size to step to.
    zoom,
    // Which list the arrow keys are walking, and where in it.
    viewMode,
    selectedPersonKey,
    landOnPerson,
    // Stable, or refs: listed because a value from a custom hook is not
    // known to be stable.
    setActiveFolder,
    personRowOrderRef,
    screenThreadOrderRef,
    openThreadRef,
    searchInputRef,
  ]);
}
