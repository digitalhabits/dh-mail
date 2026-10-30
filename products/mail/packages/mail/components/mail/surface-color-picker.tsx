"use client";

/**
 * The colour of one part of the window: the design system's light colours
 * first, then any colour, then the way back to the default. Used in
 * Settings > General > Colours and in the menu a right-click on a
 * background opens. See lib/mail/surface-colors.
 */

import { Check, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useMailT } from "@/lib/mail/i18n";
import type { MailStringKey } from "@/lib/mail/i18n-strings";
import {
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

export function SurfaceColorPicker({ surface }: { surface: Surface }) {
  const t = useMailT();
  const colors = useSurfaceColors();
  const current = effectiveSurfaceColor(colors, surface);
  const swatches = swatchesFor(colors);
  const isSwatch = swatches.some((s) => s.value === current);
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
              on && "ring-2 ring-[var(--mail-accent)] ring-offset-1"
            )}
            style={{ backgroundColor: swatch.value }}
          >
            {on ? (
              <Check
                className={cn("h-3 w-3", isDarkColor(swatch.value) ? "text-white" : "text-[#1b3d4a]")}
                aria-hidden
              />
            ) : null}
          </button>
        );
      })}
      {/* Any other colour: the system's own picker. Ringed when the colour
          is one of its, not a swatch. */}
      <input
        type="color"
        aria-label={t("colourCustom")}
        title={t("colourCustom")}
        value={current}
        onChange={(e) => setSurfaceColor(surface, e.target.value)}
        className={cn(
          "h-6 w-8 cursor-pointer rounded-inner border border-[rgba(27,61,74,0.16)] bg-white p-0.5",
          !isSwatch && "ring-2 ring-[var(--mail-accent)] ring-offset-1"
        )}
      />
      {colors[surface] ? (
        <button
          type="button"
          aria-label={t("colourReset")}
          title={t("colourReset")}
          onClick={() => setSurfaceColor(surface, null)}
          className="rounded-full p-1 text-stone-400 hover:bg-stone-200/70 hover:text-stone-700"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
