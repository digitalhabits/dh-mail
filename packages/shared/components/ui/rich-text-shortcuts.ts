"use client";

/**
 * The editor's two keys that a host app may change: paste without
 * formatting, and make a link of the selection.
 *
 * The editor keeps its own defaults, so a page with no provider behaves as
 * before. Mail puts a provider over its whole window and fills it from the
 * reader's shortcut settings. Bold, italic and underline are Quill's own and
 * are not here.
 */

import { createContext, useContext } from "react";

/** True when the key press is the shortcut. */
export type KeyMatcher = (event: KeyboardEvent) => boolean;

export type RichTextShortcuts = {
  pastePlain: KeyMatcher;
  link: KeyMatcher;
};

/**
 * Cmd+Option+Shift+V, the Mac's own "Paste and Match Style" and Outlook's
 * (Ctrl+Alt+Shift+V on Windows). Read by `code`: with Option held the Mac
 * types "◊" for V.
 */
const defaultPastePlain: KeyMatcher = (event) =>
  event.shiftKey && event.altKey && (event.metaKey || event.ctrlKey) && event.code === "KeyV";

/** Cmd+K, as every editor with a link button has it. */
const defaultLink: KeyMatcher = (event) =>
  (event.metaKey || event.ctrlKey) &&
  !event.shiftKey &&
  !event.altKey &&
  event.key.toLowerCase() === "k";

export const DEFAULT_RICH_TEXT_SHORTCUTS: RichTextShortcuts = {
  pastePlain: defaultPastePlain,
  link: defaultLink,
};

export const RichTextShortcutsContext = createContext<RichTextShortcuts>(
  DEFAULT_RICH_TEXT_SHORTCUTS
);

export function useRichTextShortcuts(): RichTextShortcuts {
  return useContext(RichTextShortcutsContext);
}
