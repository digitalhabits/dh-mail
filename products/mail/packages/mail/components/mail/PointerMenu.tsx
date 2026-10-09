"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useMailColorMode } from "@/lib/mail/theme";
import { cn } from "@/lib/utils";

/**
 * A menu at the pointer, on <body>: the account tabs' menus and a message's
 * right-click menu. It moves itself inside the window, and goes on a press
 * outside, Escape, a scroll or the window losing focus.
 *
 * A press inside a message counts as outside too. The message is drawn in
 * a frame of its own, whose presses never reach this window, and a menu
 * opened by a right-click in there has the frame focused already, so no
 * blur comes either: the menu stayed up over the message.
 */
export function PointerMenu({
  x,
  y,
  onDismiss,
  children,
  className,
}: {
  x: number;
  y: number;
  onDismiss: () => void;
  children: React.ReactNode;
  /** Padding and width for the rows inside. */
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.min(x, window.innerWidth - box.width - 8),
      top: Math.min(y, window.innerHeight - box.height - 8),
    });
  }, [x, y]);

  React.useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    // A scroll of the page closes it; a scroll inside it (a tall panel) does not.
    const onScroll = (event: Event) => {
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onDismiss);
    // The message frames (same origin), as they are at the open.
    const frameDocs: Document[] = [];
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        const doc = frame.contentDocument;
        if (doc) frameDocs.push(doc);
      } catch {
        /* another origin: its presses blur this window instead */
      }
    }
    for (const doc of frameDocs) {
      doc.addEventListener("mousedown", onDismiss, true);
      doc.addEventListener("scroll", onDismiss, true);
    }
    return () => {
      for (const doc of frameDocs) {
        doc.removeEventListener("mousedown", onDismiss, true);
        doc.removeEventListener("scroll", onDismiss, true);
      }
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onDismiss);
    };
  }, [onDismiss]);

  // A portal: it carries the theme itself, as the popovers do.
  const colorMode = useMailColorMode();

  return createPortal(
    <div
      ref={ref}
      role="menu"
      /* Named, so a Radix popover this menu opens over can tell that a
         press landing here is not a press outside itself — the settings
         panel is one, and it was closing under the pointer before the
         click could land. See MailPage's settings content. */
      data-mail-mark-menu=""
      /*
        `pointerEvents` because a Radix popover turns them off for
        everything outside its own content while it is open, and this menu
        hangs on <body> beside it rather than inside it. It was drawn, and
        it was not clickable: the presses went nowhere.
      */
      style={{ left: placed.left, top: placed.top, pointerEvents: "auto" }}
      data-theme={colorMode}
      className={cn("mail-shell mail-popover fixed z-[70] w-max rounded-lg border border-stone-200 bg-white py-1 shadow-lg", className)}
    >
      {children}
    </div>,
    document.body
  );
}

/** A row of a tab menu. */
export const POINTER_MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100";
export const POINTER_MENU_ICON = "h-3.5 w-3.5 shrink-0 text-stone-400";
