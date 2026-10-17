"use client";

/**
 * The two marks of a mailbox's hours, the same wherever its hours are
 * shown: the eye on a muted tile for "shown in Mail", and the Sync mark
 * on a bright tile for "new mail arrives". In row icons and in the week's
 * key, never inside the week's bars.
 *
 * The Sync mark, not a tray with an arrow: nothing is downloaded, mail is
 * fetched, and Sync is the button that does it. Light on the bright tile:
 * dark on it read poorly (Ulrik, 2026-10-17).
 */

import { Eye, RefreshCw } from "lucide-react";

import type { RhythmState } from "@/lib/mail/account-rhythm";
import { cn } from "@/lib/utils";

export function ShownTile({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--mail-shown-tile)] text-[var(--mail-shown-stroke)]", className)}
    >
      <Eye className="h-4 w-4" />
    </span>
  );
}

export function FetchTile({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--mail-fetch-tile)] text-[var(--mail-fetch-stroke)]", className)}
    >
      {/* Turned as the Sync button turns it: arrowheads at 12 and 6. */}
      <RefreshCw className="h-4 w-4 -rotate-45" />
    </span>
  );
}

/** The colour of each state in the week's bars and chart. */
export const WEEK_FILL: Record<RhythmState, string> = {
  fetching: "bg-[var(--mail-week-fetch)]",
  shown: "bg-[var(--mail-week-shown)]",
  hidden: "bg-[var(--mail-week-hidden)]",
};
