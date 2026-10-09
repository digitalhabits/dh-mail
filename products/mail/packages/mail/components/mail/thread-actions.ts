/**
 * The shared look of the icon-only actions above a thread.
 *
 * A string rather than a component: these sit on buttons that differ in
 * everything except how they look.
 */

/** Shared look for the icon-only actions above a thread. */
export const THREAD_ACTION_CLASS =
  // shrink-0: these sit in a row that runs out of width before it runs out
  // of buttons, and a squashed circle is not a smaller button, it is a
  // broken one. What does not fit goes behind the ellipsis instead.
  //
  // The toolbar row is a `group/toolbar`. When it is short of room it sets
  // `data-tight` and these circles drop one step before anything is hidden.
  "h-9 w-9 shrink-0 rounded-full text-[var(--mail-thread-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-thread-fg)] [&_svg]:size-[19px] group-data-[tight]/toolbar:h-8 group-data-[tight]/toolbar:w-8 group-data-[tight]/toolbar:[&_svg]:size-[17px]";
export const THREAD_ACTION_ACTIVE_CLASS =
  "bg-[var(--mail-chrome-selected)] text-[var(--mail-thread-fg)]";
