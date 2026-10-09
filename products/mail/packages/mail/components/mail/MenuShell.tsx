"use client";

/**
 * The panel a right-click puts up, wherever the pointer was.
 *
 * Held apart from what goes in it: a thread row, a person row and an
 * address all answer a right-click, and only the lines differ. It keeps
 * itself on screen, closes on Escape, on a click outside, on a scroll
 * under it, and on the window losing focus.
 */

import * as React from "react";
import { createPortal } from "react-dom";

import { useMailColorMode } from "@/lib/mail/theme";

/* The menu gives the keyboard its first item when it opens, and the browser
   drew its own blue ring around it. The row is highlighted the way a pointer
   highlights it instead — the same mark, whichever way the reader arrived. */
export const MENU_ITEM =
  "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm text-stone-800 outline-none hover:bg-stone-100 focus-visible:bg-stone-100";
export const MENU_ICON = "h-3.5 w-3.5 shrink-0 text-stone-500";

export function MenuShell({
  x,
  y,
  label,
  onDismiss,
  children,
}: {
  x: number;
  y: number;
  label: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState({ left: x, top: y });
  // A portal is outside the mail window, so it carries the theme itself,
  // as the popovers do (MailPopoverContent).
  const colorMode = useMailColorMode();

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.max(8, Math.min(x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - box.height - 8)),
    });
  }, [x, y]);

  React.useEffect(() => {
    /*
      Inside: this menu, or a panel it opened beside itself, such as the
      folder list of "Move to folder". That panel floats in a layer of its
      own, so it is not in this menu's box; a scroll of its list closed the
      menu and the list with it.
    */
    const inside = (target: EventTarget | null) => {
      if (!(target instanceof Node)) return false;
      if (ref.current?.contains(target)) return true;
      return target instanceof Element && Boolean(target.closest("[data-radix-popper-content-wrapper]"));
    };
    const onDown = (event: MouseEvent) => {
      if (inside(event.target)) return;
      onDismiss();
    };
    const onScroll = (event: Event) => {
      if (inside(event.target)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    // A menu that stays put while the list scrolls under it is pointing at
    // whatever has slid into its place.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onDismiss);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ left: placed.left, top: placed.top }}
      /* A portal's events travel up the React tree, not the DOM one, so a
         click in here reached the row this menu belongs to and opened the
         thread — which marked it read again, and made "Mark as unread"
         look like it did nothing at all. */
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => e.stopPropagation()}
      data-theme={colorMode}
      className="mail-shell mail-popover fixed z-[70] w-max min-w-[11rem] rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
    >
      {children}
    </div>,
    document.body
  );
}
