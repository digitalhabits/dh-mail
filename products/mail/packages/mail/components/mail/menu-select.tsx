"use client";

/**
 * A dropdown in Mail's own style, for a short list of choices inside a
 * menu or a panel: the box of the language picker in Settings, and a list
 * that opens under it. A native select draws the system's menu, which does
 * not follow the app's look or its dark mode.
 *
 * The keyboard: Enter, Space or Down opens it on the chosen item, Up and
 * Down move, Enter picks, Escape closes and gives the caret back to the box.
 *
 * The list is pinned to the window, not to the panel it sits in. In a short
 * panel that scrolls (the hours menu's "To show it early" page), a list
 * hung below the box was cut off by the panel's edge, and focusing its
 * chosen item scrolled the panel away from everything else (2026-10-24).
 * Now it opens below the box when it fits there and above it when it does
 * not, and moving the caret through it never scrolls the panel. A scroll of
 * the panel closes it, as it would leave it hanging.
 */

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** The list's tallest: max-h-72. */
const LIST_MAX_PX = 288;

/**
 * Focus an item and scroll the list, and only the list, to show it. Plain
 * focus() or scrollIntoView() scroll every box around it too, the panel
 * the dropdown sits in among them.
 */
function focusInList(list: HTMLElement | null, item: HTMLElement | null | undefined): void {
  if (!item) return;
  item.focus({ preventScroll: true });
  if (!list) return;
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

export type MenuSelectOption<T extends string | number> = { value: T; label: string };

export function MenuSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: readonly MenuSelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  // A click anywhere else, or Escape, shuts the list. Escape stops here, so
  // the menu around it stays open.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    // The list stays where it was put, so a scroll under it would leave it
    // hanging. A scroll inside the list itself is the list's own.
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    const at = Math.max(0, options.findIndex((option) => option.value === value));
    const frame = requestAnimationFrame(() => {
      focusInList(listRef.current, itemRefs.current[at]);
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, [open, options, value]);

  // Below the box when the list fits there, else above it, else on the
  // side with more room, cut to fit. Measured, then put right: a parent
  // with a transform (a popover) moves where "fixed" starts from. Set on
  // the element, not through React: a style React kept from the last
  // opening would be measured as if it were this one's.
  React.useLayoutEffect(() => {
    const button = buttonRef.current;
    const list = listRef.current;
    if (!open || !button || !list) return;
    const box = button.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    list.style.minWidth = `${box.width}px`;
    list.style.maxHeight = "";
    const tall = Math.min(list.scrollHeight + list.offsetHeight - list.clientHeight, LIST_MAX_PX);
    const below = window.innerHeight - box.bottom - gap - margin;
    const above = box.top - gap - margin;
    const down = tall <= below || below >= above;
    const height = Math.min(tall, Math.max(0, down ? below : above));
    const width = list.offsetWidth;
    const want = {
      left: Math.max(margin, Math.min(box.right - width, window.innerWidth - width - margin)),
      top: down ? box.bottom + gap : box.top - gap - height,
    };
    list.style.maxHeight = `${height}px`;
    list.style.left = `${want.left}px`;
    list.style.top = `${want.top}px`;
    const landed = list.getBoundingClientRect();
    list.style.left = `${want.left + (want.left - landed.left)}px`;
    list.style.top = `${want.top + (want.top - landed.top)}px`;
    list.style.visibility = "visible";
  }, [open]);

  const pick = (next: T) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (next !== value) onChange(next);
  };

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-inner border border-stone-200 bg-white py-1 pl-2.5 pr-2 text-xs text-stone-700 outline-none hover:bg-stone-50",
          open && "ring-1 ring-teal-600/40"
        )}
      >
        <span className="tabular-nums">{current?.label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-stone-400" aria-hidden />
      </button>
      {open ? (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          style={{ visibility: "hidden" }}
          className="fixed z-[80] max-h-72 overflow-y-auto overscroll-contain rounded-surface border border-stone-200 bg-white py-1 shadow-lg"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = items[Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
            focusInList(listRef.current, next);
          }}
        >
          {options.map((option, index) => {
            const chosen = option.value === value;
            return (
              <button
                key={String(option.value)}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="option"
                aria-selected={chosen}
                onClick={() => pick(option.value)}
                className={cn(
                  "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 whitespace-nowrap rounded-inner py-1.5 pl-2 pr-3 text-left text-sm text-stone-800 outline-none hover:bg-stone-100 focus:bg-stone-100",
                  chosen && "font-medium"
                )}
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0 text-teal-700", !chosen && "invisible")} aria-hidden />
                <span className="tabular-nums">{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
