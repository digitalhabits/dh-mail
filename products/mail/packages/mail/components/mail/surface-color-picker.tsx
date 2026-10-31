"use client";

/**
 * The colour of one part of the window: the design system's light colours
 * first, then any colour. Used in Settings > General > Colours and in the
 * menu a right-click on a background opens. See lib/mail/surface-colors.
 *
 * "Any colour" is a ring with the colours of a colour wheel, the familiar
 * sign for it. A click opens the system's own picker. After you pick a
 * colour, the centre of the ring fills with it and the ring shows as
 * selected. The way back to the default is `SurfaceColorReset`, which the
 * caller puts in its header.
 */

import { Check, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMailT } from "@/lib/mail/i18n";
import type { MailStringKey } from "@/lib/mail/i18n-strings";
import {
  DESIGN_SYSTEM_SWATCHES,
  effectiveSurfaceColor,
  isDarkColor,
  setSurfaceColor,
  swatchesFor,
  type Surface,
} from "@/lib/mail/surface-colors";
import { useSurfaceColors } from "@/lib/mail/use-surface-colors";

export const SURFACE_LABEL: Record<Surface, MailStringKey> = {
  top: "colourTop",
  rail: "colourRail",
  list: "colourList",
  listHead: "colourListHead",
  readerHead: "colourReaderHead",
  reader: "colourReader",
};

const SELECTED_RING = "ring-2 ring-[var(--mail-accent)] ring-offset-1";

/** The colours of a colour wheel, round the ring. */
const WHEEL =
  "conic-gradient(#f43f5e, #f59e0b, #facc15, #4ade80, #22d3ee, #3b82f6, #a855f7, #f43f5e)";

export function SurfaceColorPicker({ surface }: { surface: Surface }) {
  const t = useMailT();
  const colors = useSurfaceColors();
  const current = effectiveSurfaceColor(colors, surface);
  // A colour that is not one of the design system's is shown in the ring,
  // not as a swatch of its own.
  const custom = !DESIGN_SYSTEM_SWATCHES.some((s) => s.value === current);
  const swatches = swatchesFor(colors).filter((s) => !(custom && s.value === current));
  return (
    <span className="flex flex-wrap items-center gap-1.5" data-surface-picker={surface}>
      {swatches.map((swatch) => {
        const on = swatch.value === current;
        return (
          <button
            key={swatch.value}
            type="button"
            aria-label={swatch.name}
            aria-pressed={on}
            title={swatch.name}
            onClick={() => setSurfaceColor(surface, swatch.value)}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(27,61,74,0.16)]",
              on && SELECTED_RING
            )}
            style={{ backgroundColor: swatch.value }}
          >
            {on ? <SwatchCheck color={swatch.value} /> : null}
          </button>
        );
      })}
      <span aria-hidden className="mx-0.5 h-4 w-px bg-stone-200" />
      <span
        className={cn("relative h-6 w-6 shrink-0 rounded-full p-[3px]", custom && SELECTED_RING)}
        style={{ background: WHEEL }}
        title={t("colourCustom")}
      >
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-white"
          style={custom ? { backgroundColor: current } : undefined}
        >
          {custom ? (
            <SwatchCheck color={current} />
          ) : (
            <Plus className="h-3 w-3 text-stone-500" aria-hidden />
          )}
        </span>
        {/* The system's own picker. On top of the ring, but not seen, so a
            click on the ring opens it and the picker shows next to it. */}
        <input
          type="color"
          aria-label={t("colourCustom")}
          value={current}
          onChange={(e) => setSurfaceColor(surface, e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
        />
      </span>
    </span>
  );
}

/** "Reset", for the header over a picker. Shown only when the part has a colour set. */
export function SurfaceColorReset({ surface, className }: { surface: Surface; className?: string }) {
  const t = useMailT();
  const colors = useSurfaceColors();
  if (!colors[surface]) return null;
  return (
    <button
      type="button"
      title={t("colourReset")}
      onClick={() => setSurfaceColor(surface, null)}
      className={cn("text-xs font-normal text-stone-500 hover:text-stone-800 hover:underline", className)}
    >
      {t("colourResetShort")}
    </button>
  );
}

function SwatchCheck({ color }: { color: string }) {
  return (
    <Check
      className={cn("h-3 w-3", isDarkColor(color) ? "text-white" : "text-[#1b3d4a]")}
      aria-hidden
    />
  );
}
