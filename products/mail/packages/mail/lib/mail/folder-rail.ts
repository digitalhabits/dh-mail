/**
 * What the folder rail remembers between sessions.
 *
 * Two things, both of them the reader's own arrangement rather than
 * anything about the mail: whether the rail is showing, and which folders
 * they have folded shut. A rail that opened closed every morning, or that
 * unfolded eighty folders again each time, would be a rail nobody pins.
 */

import * as React from "react";
import { startPointerDrag } from "@/lib/pointer-drag";

const OPEN_KEY = "redd-plan-mail-folder-rail-open-v1";
const COLLAPSED_KEY = "redd-plan-mail-folder-rail-collapsed-v1";
const COLLAPSED_ACCOUNTS_KEY =
  "redd-plan-mail-folder-rail-collapsed-accounts-v1";
const WIDTH_KEY = "redd-plan-mail-folder-rail-width-v1";

/**
 * How wide the rail is, and how wide it is allowed to be.
 *
 * The floor is where a nested folder name stops being readable at all —
 * below it the rail is a column of ellipses. The ceiling is about where it
 * stops being a rail and starts being a second list.
 */
export const FOLDER_RAIL_DEFAULT_WIDTH = 240;
export const FOLDER_RAIL_MIN_WIDTH = 160;
export const FOLDER_RAIL_MAX_WIDTH = 460;

function readBool(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function readFolderRailOpen(): boolean {
  return readBool(OPEN_KEY);
}

export function writeFolderRailOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    /* quota / private mode */
  }
}

/**
 * Folded folders, by mailbox and name.
 *
 * Held the wrong way round on purpose: what is remembered is what has been
 * folded shut, so a folder made tomorrow arrives open. Remembering what was
 * open instead would hide every new folder behind a triangle nobody knows
 * to turn.
 */
export function collapsedFolderKey(account: string, name: string): string {
  return `${account.trim().toLowerCase()} ${name.trim().toLowerCase()}`;
}

export function readCollapsedFolders(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function writeCollapsedFolders(keys: Set<string>): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...keys]));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Whole mailboxes folded shut.
 *
 * The same way round as the folders, and for the same reason: a mailbox
 * connected tomorrow arrives open rather than hidden behind a triangle
 * nobody knows to turn. Kept apart from the folder keys so that a mailbox
 * and a folder that happen to share a name cannot fold each other.
 */
export function readCollapsedAccounts(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_ACCOUNTS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

export function writeCollapsedAccounts(keys: Set<string>): void {
  try {
    window.localStorage.setItem(
      COLLAPSED_ACCOUNTS_KEY,
      JSON.stringify([...keys])
    );
  } catch {
    /* quota / private mode */
  }
}

export function collapsedAccountKey(account: string): string {
  return account.trim().toLowerCase();
}

/** The rail's open state, kept where both the button and the rail can see it. */
export function useFolderRailOpen(): [boolean, (next: boolean) => void] {
  // Starts closed on the server and on the first paint, then takes the
  // remembered answer — reading localStorage during render would make the
  // two disagree and React would throw the markup away.
  const [open, setOpenState] = React.useState(false);
  React.useEffect(() => {
    setOpenState(readFolderRailOpen());
  }, []);
  const setOpen = React.useCallback((next: boolean) => {
    setOpenState(next);
    writeFolderRailOpen(next);
  }, []);
  return [open, setOpen];
}

/**
 * The rail's width, dragged from its right edge.
 *
 * Its own hook rather than the thread list's: that one carries a collapse
 * to an avatar rail, a snap to hidden, and an inverted drag for a list on
 * the right, and the folder rail has none of those. It is open at a width,
 * or it is not open.
 *
 * `resizing` is returned because the rail slides open on a width
 * transition, and a width that animates while it is being dragged lags the
 * pointer by the length of the slide.
 */
export function useFolderRailWidth(): {
  width: number;
  resizing: boolean;
  startResize: (
    event: React.PointerEvent,
    options?: { invertDrag?: boolean }
  ) => void;
} {
  const [width, setWidth] = React.useState(FOLDER_RAIL_DEFAULT_WIDTH);
  const [resizing, setResizing] = React.useState(false);
  const widthRef = React.useRef(width);
  widthRef.current = width;

  React.useEffect(() => {
    try {
      const stored = Number.parseInt(
        window.localStorage.getItem(WIDTH_KEY) ?? "",
        10
      );
      if (Number.isFinite(stored)) setWidth(clampFolderRailWidth(stored));
    } catch {
      /* private mode */
    }
  }, []);

  const startResize = React.useCallback((
    event: React.PointerEvent,
    options?: { invertDrag?: boolean }
  ) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = widthRef.current;
    // The rail on the right of the window grows as the pointer goes left.
    const dragSign = options?.invertDrag ? -1 : 1;
    setResizing(true);

    const onMove = (e: PointerEvent) => {
      setWidth(
        clampFolderRailWidth(startWidth + dragSign * (e.clientX - startX))
      );
    };
    const onUp = () => {
      setResizing(false);
      // Written at the end rather than on every frame: a drag is one
      // decision, not sixty.
      try {
        window.localStorage.setItem(WIDTH_KEY, String(widthRef.current));
      } catch {
        /* private mode */
      }
    };

    startPointerDrag(
      { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
      { cursor: "col-resize", onMove, onEnd: onUp }
    );
  }, []);

  return { width, resizing, startResize };
}

function clampFolderRailWidth(size: number): number {
  return Math.min(
    FOLDER_RAIL_MAX_WIDTH,
    Math.max(FOLDER_RAIL_MIN_WIDTH, Math.round(size))
  );
}
