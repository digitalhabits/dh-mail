"use client";

/**
 * The font and size rows of the Aa menu, the font list, and the line that
 * makes a choice the account's default. See TextStyleMenu.
 *
 * Nothing here opens a menu of its own. The font list takes the Aa menu's
 * place (with a way back), and the size grid opens under its row: a menu on
 * a menu is two things to close and two to aim at.
 */

import * as React from "react";
import { ChevronDown, ChevronLeft, Minus, MoreHorizontal, Plus, Search } from "lucide-react";

import { useInstalledFonts, useRecentFonts } from "@/components/mail/use-text-style";
import { useMailT } from "@/lib/mail/i18n";
import {
  QUICK_SIZES,
  TEXT_FONTS,
  TEXT_SIZES,
  fontLabel,
  fontShortLabel,
  fontStack,
  quickFonts,
  setTextStyleDefault,
  type TextStyle,
} from "@/lib/mail/text-style";
import { cn } from "@/lib/utils";

/** A word in a box: the fonts, the sizes, and the three marks. */
export const PILL =
  "rounded-lg border px-2.5 py-1 text-sm transition-colors disabled:opacity-50";
export const PILL_OFF =
  "border-stone-200 text-stone-800 hover:border-stone-300 hover:bg-stone-50";
export const PILL_ON = "border-[var(--mail-chrome-pinned)] bg-stone-100 text-stone-900";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The font row: the default, the fonts picked lately, and "…" for the list.
 * A font that is the default is applied as no font at all, so the text
 * follows the default if it changes.
 */
export function FontRow({
  current,
  defaultFont,
  onPick,
  onMore,
}: {
  current: string;
  defaultFont: string;
  onPick: (font: string) => void;
  onMore: () => void;
}) {
  const t = useMailT();
  const recent = useRecentFonts();
  const quick = quickFonts(defaultFont, recent);
  const inQuick = quick.some((f) => same(f, current));
  return (
    <>
      {quick.map((font) => (
        <button
          key={font}
          type="button"
          aria-pressed={same(current, font)}
          className={cn(PILL, "max-w-[9rem] truncate", same(current, font) ? PILL_ON : PILL_OFF)}
          style={{ fontFamily: fontStack(font) }}
          onClick={() => onPick(font)}
        >
          {fontShortLabel(font)}
        </button>
      ))}
      <button
        type="button"
        title={t("fontMore")}
        aria-label={t("fontMore")}
        aria-pressed={!inQuick}
        className={cn(PILL, "inline-flex max-w-[9rem] items-center gap-1 truncate", inQuick ? PILL_OFF : PILL_ON)}
        style={inQuick ? undefined : { fontFamily: fontStack(current) }}
        onClick={onMore}
      >
        {inQuick ? <MoreHorizontal className="h-4 w-4" aria-hidden /> : fontLabel(current)}
      </button>
    </>
  );
}

/** One font in the list, in its own face. */
function FontItem({
  font,
  current,
  isDefault,
  onPick,
}: {
  font: string;
  current: string;
  isDefault: boolean;
  onPick: (font: string) => void;
}) {
  const t = useMailT();
  const on = same(font, current);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[15px] text-stone-800 hover:bg-stone-100",
        on && "bg-stone-100"
      )}
      style={{ fontFamily: fontStack(font) }}
      onClick={() => onPick(font)}
    >
      <span className="truncate">{fontLabel(font)}</span>
      {isDefault ? <span className="shrink-0 font-sans text-xs text-stone-500">{t("fontDefaultTag")}</span> : null}
    </button>
  );
}

function FontSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-1">
      <p className="px-2.5 pb-0.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-stone-500">{title}</p>
      {children}
    </div>
  );
}

/** Which fonts the list holds: the ones lately picked, ours, and the rest on this computer. */
function fontSections(recent: string[], installed: string[] | null, query: string) {
  const q = query.trim().toLowerCase();
  const hit = (font: string) => !q || fontLabel(font).toLowerCase().includes(q);
  const common = TEXT_FONTS.map((f) => f.id);
  const known = new Set(TEXT_FONTS.map((f) => f.label.toLowerCase()));
  const others = (installed ?? []).filter((name) => !known.has(name.toLowerCase()));
  return {
    recent: recent.filter(hit),
    common: common.filter(hit),
    others: others.filter(hit),
  };
}

/**
 * The font list, in the Aa menu's place: a search box, then the fonts
 * picked lately, ours, and every font on this computer, each in its own
 * face. Picking one goes back to the rows.
 */
export function FontPanel({
  current,
  defaultFont,
  onPick,
  onBack,
}: {
  current: string;
  defaultFont: string;
  onPick: (font: string) => void;
  onBack: () => void;
}) {
  const t = useMailT();
  const [query, setQuery] = React.useState("");
  const recent = useRecentFonts();
  const installed = useInstalledFonts(true);
  const sections = fontSections(recent, installed, query);
  const item = (font: string) => (
    <FontItem key={font} font={font} current={current} isDefault={same(font, defaultFont)} onPick={onPick} />
  );
  const nothing = !sections.recent.length && !sections.common.length && !sections.others.length;
  return (
    <div className="flex flex-col" onKeyDown={(e) => e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), onBack())}>
      <div className="flex items-center gap-1 px-1 pb-1">
        <button
          type="button"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-600 hover:bg-stone-100"
          title={t("fontBack")}
          aria-label={t("fontBack")}
          onClick={onBack}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-stone-200 px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-stone-400" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("fontSearch")}
            aria-label={t("fontSearch")}
            // The browser offered words typed before as a chip over the list.
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-sm text-stone-800 outline-none"
          />
        </label>
      </div>
      {/* A fixed height, not a cap: the list grew and shrank with every
          letter typed, and the menu jumped to the other side of the button
          each time it no longer fitted where it was. */}
      <div role="menu" className="h-80 overflow-y-auto">
        {sections.recent.length ? <FontSection title={t("fontRecent")}>{sections.recent.map(item)}</FontSection> : null}
        {sections.common.length ? <FontSection title={t("fontCommon")}>{sections.common.map(item)}</FontSection> : null}
        {sections.others.length ? <FontSection title={t("fontAll")}>{sections.others.map(item)}</FontSection> : null}
        {installed === null ? <p className="px-2.5 py-2 text-xs text-stone-500">{t("fontLoading")}</p> : null}
        {nothing && installed !== null ? <p className="px-2.5 py-2 text-xs text-stone-500">{t("fontNoMatch")}</p> : null}
      </div>
    </div>
  );
}

/** The size row: a stepper, four common sizes, and "▾" for the rest under it. */
export function SizeRow({
  current,
  defaultSize,
  onPick,
}: {
  current: number;
  defaultSize: number;
  onPick: (size: number) => void;
}) {
  const t = useMailT();
  const [grid, setGrid] = React.useState(false);
  const smaller = [...TEXT_SIZES].reverse().find((n) => n < current);
  const larger = TEXT_SIZES.find((n) => n > current);
  const STEP =
    "flex h-full w-7 items-center justify-center text-stone-600 hover:bg-stone-100 disabled:opacity-40";
  return (
    <>
      <div className="flex h-[30px] items-stretch overflow-hidden rounded-lg border border-stone-200">
        <button type="button" className={STEP} disabled={smaller == null} title={t("sizeSmaller")} aria-label={t("sizeSmaller")} onClick={() => smaller != null && onPick(smaller)}>
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <span className="flex min-w-[2.75rem] items-center justify-center gap-0.5 border-x border-stone-200 px-1.5 text-sm tabular-nums text-stone-900">
          {current}
          <span className="text-[11px] text-stone-500">pt</span>
        </span>
        <button type="button" className={STEP} disabled={larger == null} title={t("sizeLarger")} aria-label={t("sizeLarger")} onClick={() => larger != null && onPick(larger)}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {QUICK_SIZES.map((size) => (
        <button key={size} type="button" aria-pressed={current === size} className={cn(PILL, "px-2 tabular-nums", current === size ? PILL_ON : PILL_OFF)} onClick={() => onPick(size)}>
          {size}
        </button>
      ))}
      <button
        type="button"
        title={t("sizeMore")}
        aria-label={t("sizeMore")}
        aria-expanded={grid}
        className={cn(PILL, grid ? PILL_ON : PILL_OFF, "px-1.5")}
        onClick={() => setGrid((v) => !v)}
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", grid && "rotate-180")} aria-hidden />
      </button>
      {grid ? <SizeGrid current={current} defaultSize={defaultSize} onPick={(size) => (onPick(size), setGrid(false))} /> : null}
    </>
  );
}

/** Every size, under the size row: the one in use marked, the default underlined. */
function SizeGrid({ current, defaultSize, onPick }: { current: number; defaultSize: number; onPick: (size: number) => void }) {
  const t = useMailT();
  return (
    <div className="mt-1 w-full rounded-lg border border-stone-200 p-1">
      <div className="grid grid-cols-8 gap-0.5">
        {TEXT_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            aria-pressed={current === size}
            className={cn(
              "rounded-md py-1 text-sm tabular-nums text-stone-800 hover:bg-stone-100",
              current === size && "bg-stone-100 font-medium text-stone-900",
              size === defaultSize && "underline underline-offset-4"
            )}
            onClick={() => onPick(size)}
          >
            {size}
          </button>
        ))}
      </div>
      <p className="px-1 pt-1 text-xs text-stone-500">{t("sizeDefaultNote", { size: defaultSize })}</p>
    </div>
  );
}

/**
 * The line under the size: what the text is in, when that is not the
 * default, with "Make my default"; and, once it is made, whose default it
 * now is, with Undo.
 */
export function DefaultLine({
  account,
  current,
  defaults,
}: {
  account: string;
  current: TextStyle;
  defaults: TextStyle;
}) {
  const t = useMailT();
  const [madeFrom, setMadeFrom] = React.useState<TextStyle | null>(null);
  const differs = !same(current.font, defaults.font) || current.size !== defaults.size;
  const LINK = "font-medium text-[var(--mail-accent,#0d9488)] hover:underline";
  const LINE = "flex flex-wrap items-center gap-x-2 px-1.5 pb-1 pl-[4.75rem] text-xs text-stone-500";
  if (madeFrom) {
    return (
      <p className={LINE}>
        <span className="truncate">{t("textStyleDefaultFor", { account })}</span>
        <button
          type="button"
          className={LINK}
          onClick={() => {
            const back = madeFrom;
            setMadeFrom(null);
            setTextStyleDefault(account, back).catch((err) => console.warn("[mail] could not put the default font back:", err));
          }}
        >
          {t("undo")}
        </button>
      </p>
    );
  }
  if (!differs) return null;
  return (
    <p className={LINE}>
      <span>
        {fontLabel(current.font)} · {current.size} pt
      </span>
      <button
        type="button"
        className={LINK}
        onClick={() => {
          // Said only once it is kept: a default that failed to save would
          // be a promise the next message breaks.
          const before = defaults;
          setTextStyleDefault(account, current).then(
            () => setMadeFrom(before),
            (err) => console.warn("[mail] could not keep the default font:", err)
          );
        }}
      >
        {t("textStyleMakeDefault")}
      </button>
    </p>
  );
}
