/**
 * What, typed at the start of a line and followed by a space, starts a list.
 *
 * Quill's own rule takes any number and a full stop: "13. " started a
 * numbered list. A Quill list always counts from 1, so the 13 became 1. That
 * is a date in Danish and German ("13. december"), and a writer lost it
 * before they saw it go.
 *
 * So only "1. " starts a numbered list: the one number Quill's list shows as
 * it was typed. "- " and "* " start a bullet list and "[ ] " and "[x] " a
 * checklist, as in Quill. Any other number stays text.
 *
 * "1. december" still starts a list. Cmd+Z puts back the text as typed.
 *
 * No React and no DOM here, so a suite can read it. Quill folds this into its
 * own binding (lodash merge), so its handler still does the work.
 */
export const LIST_SHORTCUT_PREFIX = /^\s*?(1\.|-|\*|\[ ?\]|\[x\])$/;
