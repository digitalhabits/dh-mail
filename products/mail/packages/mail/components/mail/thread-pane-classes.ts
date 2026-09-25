/*
 * The classes of the thread's reply actions, shared by ThreadPane and the
 * parts of its markup in thread-pane-parts.tsx.
 */

import { cn } from "@/lib/utils";

/** The secondary reply actions: a labelled button, or a circle with a name
 *  on hover once there is no room for the label. */
/* No light island: Reply and Forward are our own words on our own buttons,
   with no email in them, so they take the theme like the rest of the chrome.
   As a light island they were two white slabs at the foot of a dark pane.

   Named colours rather than stone classes, because the theme's blanket
   rewrites are what put those white slabs there: `bg-white` inside a light
   subtree stays white however dark the page is. These say what they are,
   and each theme says it once — see --mail-action in mail.css. */
export const threadActionBase =
  "inline-flex shrink-0 items-center gap-2 rounded-full border px-5 py-2.5 text-[15px] font-semibold";
/** Reply: the one pressed nearly every time, and the only one with a fill. */
export const threadActionClass = cn(
  threadActionBase,
  "border-[var(--mail-action-border)] bg-[var(--mail-action)] text-[var(--mail-action-fg)] hover:bg-[var(--mail-action-hover)]"
);
/** An icon on its own in that row: the outline, and a quieter mark in it. */
export const threadActionIconClass =
  "inline-flex shrink-0 items-center justify-center rounded-full border border-[var(--mail-action-2-border)] bg-[var(--mail-action-2)] p-2.5 text-[var(--mail-action-2-icon)] hover:bg-[var(--mail-action-2-hover)] disabled:opacity-50";
/** Reply all and Forward: an outline, so Reply is the one the eye lands on. */
export const threadActionSecondaryClass = cn(
  threadActionBase,
  "border-[var(--mail-action-2-border)] bg-[var(--mail-action-2)] text-[var(--mail-action-2-fg)] hover:bg-[var(--mail-action-2-hover)]"
);
export const circleActionClass = "h-11 w-11 justify-center rounded-full px-0";
