/**
 * The two Reader settings, kept in localStorage like the other reading
 * settings (see `useLoadImagesByDefault` in MailBubble):
 *
 * - the line count over which a message gets the Reader button
 *   (Settings > Reading), and
 * - the Reader's text size, which the "Aa" button in the Reader sets.
 *
 * Each change sends an event, so every bubble on screen follows it at once.
 */

import {
  READER_LINES_KEY as LINES_KEY,
  READER_SIZE_KEY as SIZE_KEY,
  READER_WIDTH_KEY as WIDTH_KEY,
} from "@/lib/mail/storage-keys";
import * as React from "react";

const CHANGED_EVENT = "redd-plan-mail-reader-changed";

/** The default line count: a message longer than this gets the button. */
export const READER_LINES_DEFAULT = 10;
export const READER_LINES_MIN = 1;
export const READER_LINES_MAX = 200;

/**
 * The Reader's text sizes, in pixels, smallest first. The default is a
 * little larger than a bubble's 14px; the pane's zoom multiplies both.
 */
export const READER_TEXT_SIZES = [14, 15, 16, 18, 20] as const;
const READER_SIZE_DEFAULT_INDEX = 2;

function readNumber(key: string): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function writeNumber(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* private mode: the change is not kept */
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** A line count kept inside the limits, as a whole number. */
export function clampReaderLines(value: number): number {
  if (!Number.isFinite(value)) return READER_LINES_DEFAULT;
  return Math.min(READER_LINES_MAX, Math.max(READER_LINES_MIN, Math.round(value)));
}

function readLines(): number {
  const stored = readNumber(LINES_KEY);
  return stored == null ? READER_LINES_DEFAULT : clampReaderLines(stored);
}

function readSizeIndex(): number {
  const stored = readNumber(SIZE_KEY);
  if (stored == null) return READER_SIZE_DEFAULT_INDEX;
  return Math.min(READER_TEXT_SIZES.length - 1, Math.max(0, Math.round(stored)));
}

/** The line count over which a message gets the Reader button. */
export function useReaderLineCutoff(): [number, (next: number) => void] {
  const value = React.useSyncExternalStore(subscribe, readLines, () => READER_LINES_DEFAULT);
  const update = React.useCallback((next: number) => writeNumber(LINES_KEY, clampReaderLines(next)), []);
  return [value, update];
}

/** The Reader's text size, as an index into READER_TEXT_SIZES. */
export function useReaderTextSize(): [number, (next: number) => void] {
  const value = React.useSyncExternalStore(subscribe, readSizeIndex, () => READER_SIZE_DEFAULT_INDEX);
  const update = React.useCallback((next: number) => {
    const index = Math.min(READER_TEXT_SIZES.length - 1, Math.max(0, Math.round(next)));
    writeNumber(SIZE_KEY, index);
  }, []);
  return [value, update];
}

/** The Reader's column, in CSS pixels before the pane's zoom. */
export const READER_WIDTH_DEFAULT = 680;
export const READER_WIDTH_MIN = 360;

function readWidth(): number {
  const stored = readNumber(WIDTH_KEY);
  return stored == null ? READER_WIDTH_DEFAULT : Math.max(READER_WIDTH_MIN, Math.round(stored));
}

/** The Reader's column width, which its edges are dragged to set. */
export function useReaderWidth(): [number, (next: number) => void] {
  const value = React.useSyncExternalStore(subscribe, readWidth, () => READER_WIDTH_DEFAULT);
  const update = React.useCallback(
    (next: number) => writeNumber(WIDTH_KEY, Math.max(READER_WIDTH_MIN, Math.round(next))),
    []
  );
  return [value, update];
}
