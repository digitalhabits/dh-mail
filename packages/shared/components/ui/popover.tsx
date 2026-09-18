"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
/**
 * What the content points at, for a popover that something else opens.
 *
 * A trigger both opens the popover and anchors it. Where the opening is
 * done elsewhere — a key, a state change — the button underneath should
 * stay a plain button, and this gives the content its place on screen
 * without taking the click.
 */
const PopoverAnchor = PopoverPrimitive.Anchor;

/**
 * The tile this page is drawn in, when the window is split.
 *
 * A popover keeps clear of the window's edges, and nothing else: in split
 * view the page is one tile, and a popover opened near the tile's edge
 * spilled over the seam into the tile beside it. Where that tile is the
 * mail, the mail pane stood down to let the popover show and went blank.
 * The inline tile is the only one in this document — the others are frames
 * with documents of their own, or the native mail pane — so it is found by
 * the attribute the split shell puts on it.
 */
function splitTile(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>("[data-split-primary-pane]");
}

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      collisionBoundary,
      collisionPadding,
      ...props
    },
    ref
  ) => {
    const tile = collisionBoundary === undefined ? splitTile() : null;
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          ref={ref}
          align={align}
          sideOffset={sideOffset}
          collisionBoundary={collisionBoundary ?? tile ?? undefined}
          // Clear of the seam, not against it: a popover touching the tile
          // beside it still reads as lying over it.
          collisionPadding={collisionPadding ?? (tile ? 8 : undefined)}
          className={cn(
            "z-50 w-56 rounded-md border bg-white p-2 text-popover-foreground shadow-md outline-none",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    );
  }
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverAnchor, PopoverContent };
