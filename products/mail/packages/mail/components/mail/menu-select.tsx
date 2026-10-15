"use client";

/**
 * A dropdown in Mail's own style, for a short list of choices inside a
 * menu or a panel: the box of the language picker in Settings, and a list
 * that opens under it. A native select draws the system's menu, which does
 * not follow the app's look or its dark mode.
 *
 * The keyboard: Enter, Space or Down opens it on the chosen item, Up and
 * Down move, Enter picks, Escape closes and gives the caret back to the box.
 */

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

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
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    const at = Math.max(0, options.findIndex((option) => option.value === value));
    const frame = requestAnimationFrame(() => itemRefs.current[at]?.focus());
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      cancelAnimationFrame(frame);
    };
  }, [open, options, value]);

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
          "flex cursor-pointer items-center gap-1.5 rounded-md border border-stone-200 bg-white py-1 pl-2.5 pr-2 text-xs text-stone-700 outline-none hover:bg-stone-50",
          open && "ring-1 ring-teal-600/40"
        )}
      >
        <span className="tabular-nums">{current?.label}</span>
        <ChevronDown className="h-3.5 w-3.5 text-stone-400" aria-hidden />
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="absolute right-0 top-full z-50 mt-1 max-h-72 min-w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const items = itemRefs.current.filter(Boolean) as HTMLButtonElement[];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = items[Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
            next?.focus();
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
                  "mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 whitespace-nowrap rounded-md py-1.5 pl-2 pr-3 text-left text-sm text-stone-800 outline-none hover:bg-stone-100 focus:bg-stone-100",
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
