"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { useMailColorMode } from "@/lib/mail/theme";
import { cn } from "@/lib/utils";
import { MAIL_FRAME_PRESS_EVENT } from "@/lib/mail/frame-messages";

/**
 * A menu at the pointer, on <body>: the account tabs' menus and a message's
 * right-click menu. It moves itself inside the window, and goes on a press
 * outside, Escape, a scroll, or focus moving into a message.
 *
 * Not when the window loses focus to another app: a reader who looks
 * something up elsewhere comes back to the menu as they left it, with a
 * half-made change in the hours editor still there.
 *
 * A press inside a message counts as outside too. The message is drawn in
 * a frame of its own, whose presses never reach this window, and a menu
 * opened by a right-click in there has the frame focused already, so no
 * blur comes either. Without this, the menu stays up over the message.
 */
/** The title bar's height, and a little: a shaded menu starts below it. */
const TITLE_BAR_CLEAR = 52;

export function PointerMenu({
  x,
  y,
  onDismiss,
  children,
  className,
  backdrop = false,
}: {
  x: number;
  y: number;
  onDismiss: () => void;
  children: React.ReactNode;
  /** Padding and width for the rows inside. */
  className?: string;
  /**
   * A dark shade over the window behind the menu, for a menu that asks for
   * some thought (the account hours). A press on it closes the
   * menu and reaches nothing under it.
   */
  backdrop?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = React.useState({ left: x, top: y });

  /*
    A menu with a shade keeps clear of the title bar. If it is pushed up to
    fit, it sits behind the window's own buttons. It is then as tall as
    the room under the bar, and scrolls inside past that.
  */
  const topMost = backdrop ? TITLE_BAR_CLEAR : 8;
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setPlaced({
      left: Math.min(x, window.innerWidth - box.width - 8),
      // Never above the window: a panel taller than it starts at the top
      // and scrolls inside (the class below caps its height).
      top: Math.max(topMost, Math.min(y, window.innerHeight - box.height - 8)),
    });
  }, [x, y, topMost]);

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
    // A scroll of the page closes it; a scroll inside it (a tall panel) does
    // not. Under a shade nothing behind can be scrolled, so nothing closes
    // it. A list in the menu that runs to its end can carry the scroll on
    // to the page, and that must not shut the menu.
    const onScroll = (event: Event) => {
      if (backdrop) return;
      if (ref.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    window.addEventListener("scroll", onScroll, true);
    // A blur that lands in a message frame is a press in the message; one
    // that leaves for another app is not. Which is known once it is over.
    const onBlur = () => {
      window.setTimeout(() => {
        const focused = document.activeElement;
        if (!(focused instanceof HTMLIFrameElement)) return;
        if (ref.current?.contains(focused)) return;
        onDismiss();
      }, 0);
    };
    window.addEventListener("blur", onBlur);
    // A press or a scroll in a message frame. The frame has its own origin,
    // so its script tells the page (see EmailHtmlView).
    window.addEventListener(MAIL_FRAME_PRESS_EVENT, onDismiss);
    return () => {
      window.removeEventListener(MAIL_FRAME_PRESS_EVENT, onDismiss);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [onDismiss, backdrop]);

  // A portal: it carries the theme itself, as the popovers do.
  const colorMode = useMailColorMode();

  return createPortal(
    <>
    {/* A light veil of ink, as the design system has no black: the menu is
        the thing in front, and the mail behind it stays readable. */}
    {backdrop ? <div aria-hidden className="fixed inset-0 z-[69] bg-[#1b3d4a]/20" /> : null}
    <div
      ref={ref}
      role="menu"
      /* Named, so a Radix popover this menu opens over can tell that a
         press landing here is not a press outside itself — the settings
         panel is one. Without the name, it closes under the pointer before
         the click can land. See MailPage's settings content. */
      data-mail-mark-menu=""
      /*
        `pointerEvents` because a Radix popover turns them off for
        everything outside its own content while it is open, and this menu
        hangs on <body> beside it rather than inside it. Without this, it is
        drawn but it is not clickable: the presses go nowhere.
      */
      style={{
        left: placed.left,
        top: placed.top,
        pointerEvents: "auto",
        ...(backdrop ? { maxHeight: `calc(100vh - ${placed.top + 8}px)`, overscrollBehavior: "contain" } : null),
      }}
      data-theme={colorMode}
      className={cn("mail-shell mail-popover fixed z-[70] max-h-[calc(100vh-16px)] w-max overflow-y-auto rounded-surface border border-stone-200 bg-white py-1 shadow-lg", className)}
    >
      {children}
    </div>
    </>,
    document.body
  );
}

/** A row of a tab menu. */
export const POINTER_MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100";
export const POINTER_MENU_ICON = "h-3.5 w-3.5 shrink-0 text-stone-400";
