"use client";

/**
 * Font, size, colour, highlight, lists and the marks in between, behind
 * one button.
 *
 * Lists used to sit on the toolbar. They wrapped the row off the pane
 * long before the other marks ran out of room, so they live here with the
 * rest of the less-clicked formats. B, I, U and the link stay on the row.
 *
 * Laid out as labelled rows rather than a column of sections: five headings
 * with their options stacked underneath made a menu taller than the composer
 * it belongs to. A row says the same thing in one line.
 *
 * The controls do not use Quill's own pickers. Quill binds its toolbar from
 * the elements inside the toolbar container at the moment the editor mounts,
 * and a popover is drawn somewhere else and only once it opens, so there is
 * nothing to bind to. They reach the editor through its handle instead.
 */

import * as React from "react";
import { List, ListOrdered } from "lucide-react";

import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import type { RichTextEditorHandle } from "@/components/ui/RichTextEditor";
import { useMailT, type MailStringKey } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/**
 * The shape of a button in the toolbar row that Quill did not draw.
 *
 * Quill sizes its own buttons from `mail.css`. The emoji picker and the Aa
 * menu stand in the same row without being Quill's, so they take their
 * measurements from here instead, and the row keeps one rhythm.
 *
 * No hover color: both sit inside the toolbar element, where `mail.css`
 * turns every button the accent, and a second answer here would only be a
 * second place to change it.
 */
export const COMPOSER_TOOLBAR_BUTTON =
  "flex h-[26px] w-6 shrink-0 items-center justify-center rounded text-stone-500";

/**
 * Whole stacks, not family names, and no quotation marks.
 *
 * The message is read in someone else's mail app, on a machine that may not
 * have the first font named. The stack ends in a family every machine has.
 * Quotation marks are left out because a browser rewrites them when it reads
 * the style back, and the value would no longer match what is on this list.
 */
const FONTS: { id: string; label: MailStringKey; value: string | false }[] = [
  { id: "sans", label: "fontSans", value: false },
  { id: "serif", label: "fontSerif", value: "Georgia, Times New Roman, serif" },
  { id: "mono", label: "fontMono", value: "Menlo, Consolas, monospace" },
];

/** The editor sets 14px, so Normal takes the size off rather than naming it. */
const SIZES: { id: string; label: MailStringKey; value: string | false }[] = [
  { id: "small", label: "sizeSmall", value: "12px" },
  { id: "normal", label: "sizeNormal", value: false },
  { id: "large", label: "sizeLarge", value: "18px" },
  { id: "huge", label: "sizeHuge", value: "24px" },
];

/**
 * The eight of Digital Habits: Blocker, where a block list is given a colour.
 *
 * The same eight hues in the same order — sky, sea, fern, linen, peach,
 * terracotta, rose, lilac — so that choosing a colour is the same act in
 * both apps. The values are Blocker's own, unchanged: pastels at about four
 * fifths lightness, which is what a highlight wants to be.
 */
const HIGHLIGHTS: { value: string; label: MailStringKey }[] = [
  { value: "#B8D1DE", label: "colorSky" },
  { value: "#B3D2C8", label: "colorSeafoam" },
  { value: "#BCD9B6", label: "colorFern" },
  { value: "#EBDCB6", label: "colorLinen" },
  { value: "#EECAAD", label: "colorPeach" },
  { value: "#E7B3A8", label: "colorTerracotta" },
  { value: "#E1BAC3", label: "colorRose" },
  { value: "#C8B9D6", label: "colorLilac" },
];

/**
 * The same eight hues, taken down to where they can be read as words.
 *
 * A pastel is a highlight, not a colour to write in: at four fifths
 * lightness it is all but invisible on the white a message is read on. Each
 * one here keeps its hue and its place in the row, and is deepened until it
 * carries about the same weight as the others — the yellow-greens have to go
 * further down than the blues to get there, which is why these are not one
 * lightness applied eight times.
 */
const TEXT_COLORS: { value: string; label: MailStringKey }[] = [
  { value: "#1C668C", label: "colorSky" },
  { value: "#206F55", label: "colorSeafoam" },
  { value: "#2C771C", label: "colorFern" },
  { value: "#725408", label: "colorLinen" },
  { value: "#964503", label: "colorPeach" },
  { value: "#A2260B", label: "colorTerracotta" },
  { value: "#931B36", label: "colorRose" },
  { value: "#582687", label: "colorLilac" },
];

/** A browser may hand back `rgb(…)`, or a stack it has respaced. */
function sameValue(active: unknown, value: string | false): boolean {
  if (value === false) return active == null || active === false;
  if (typeof active !== "string") return false;
  const tidy = (s: string) =>
    s.toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();
  return tidy(active) === tidy(value);
}

/** `#b8d1de` from whatever form the browser handed back, or null. */
function asHex(active: unknown): string | null {
  if (typeof active !== "string") return null;
  const value = active.trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (!rgb) return null;
  const hex = [rgb[1], rgb[2], rgb[3]]
    .map((n) => Number(n).toString(16).padStart(2, "0"))
    .join("");
  return `#${hex}`;
}

/** A colour that is set, but is none of the eight offered. */
function customValue(
  active: unknown,
  presets: { value: string }[]
): string | null {
  const hex = asHex(active);
  if (!hex) return null;
  return presets.some((p) => p.value.toLowerCase() === hex) ? null : hex;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-1.5 py-1.5">
      <span className="w-14 shrink-0 pt-1.5 text-xs text-stone-500">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {children}
      </div>
    </div>
  );
}

/**
 * The look of a chosen swatch, taken from Blocker.
 *
 * A two-pixel border that is there whether or not it is chosen — so nothing
 * moves when it is — and a white tick over the colour with a shadow under
 * it, which is what makes the tick readable on a pale fill and a dark one
 * alike. The border colour is the app's own "you are here" navy, which the
 * dark theme turns to cream, exactly as Blocker's does.
 */
const SWATCH =
  "relative h-6 w-6 shrink-0 rounded-md border-2 border-transparent transition-transform hover:scale-110";
const SWATCH_ON = "border-[var(--mail-chrome-pinned)]";

function Tick() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-bold leading-none text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]"
    >
      ✓
    </span>
  );
}

function Swatches({
  presets,
  active,
  clearLabel,
  onPick,
}: {
  presets: { value: string; label: MailStringKey }[];
  active: unknown;
  clearLabel: string;
  onPick: (value: string | false) => void;
}) {
  const t = useMailT();
  const custom = customValue(active, presets);
  const cleared = sameValue(active, false);

  return (
    <>
      {/*
        Blocker has no clear swatch, because a block list always has a
        colour. Text does not: it starts with none, and there has to be a
        way back to that, so this row is one longer than Blocker's.
      */}
      <button
        type="button"
        title={clearLabel}
        aria-label={clearLabel}
        aria-pressed={cleared}
        onClick={() => onPick(false)}
        className={cn(
          SWATCH,
          // The surface behind it, not white: an empty cell should read as
          // nothing in either theme, and on the dark one a white square
          // reads as a colour you could choose.
          "bg-[var(--mail-u-surface,#ffffff)]",
          cleared ? SWATCH_ON : "border-stone-300"
        )}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] leading-none text-stone-400"
        >
          ✕
        </span>
      </button>
      {presets.map((swatch) => {
        const on = sameValue(active, swatch.value);
        return (
          <button
            key={swatch.value}
            type="button"
            title={t(swatch.label)}
            aria-label={t(swatch.label)}
            aria-pressed={on}
            onClick={() => onPick(swatch.value)}
            style={{ backgroundColor: swatch.value }}
            className={cn(SWATCH, on && SWATCH_ON)}
          >
            {on ? <Tick /> : null}
          </button>
        );
      })}
      {/*
        Any other colour. A native colour input, made invisible and laid over
        a swatch of its own — Blocker's trick, and the reason it is a label
        rather than a button: a click anywhere on it opens the system picker.
        The plus stands where the tick would, and stands down once this is
        the colour in use.
      */}
      <label
        title={t("customColor")}
        className={cn(
          SWATCH,
          "cursor-pointer",
          custom ? SWATCH_ON : "border-stone-300 bg-[var(--mail-u-surface,#ffffff)]"
        )}
        style={custom ? { backgroundColor: custom } : undefined}
      >
        {custom ? (
          <Tick />
        ) : (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-bold leading-none text-stone-400"
          >
            +
          </span>
        )}
        <input
          type="color"
          aria-label={t("customColor")}
          value={custom ?? "#000000"}
          onChange={(e) => onPick(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
    </>
  );
}

/** A word in a box: the fonts, the sizes, and the three marks. */
const PILL =
  "rounded-lg border px-2.5 py-1 text-sm transition-colors disabled:opacity-50";
const PILL_OFF =
  "border-stone-200 text-stone-800 hover:border-stone-300 hover:bg-stone-50";
const PILL_ON = "border-[var(--mail-chrome-pinned)] bg-stone-100 text-stone-900";

export function TextStyleMenu({
  editorHandle,
  className,
}: {
  editorHandle: React.MutableRefObject<RichTextEditorHandle | null>;
  className?: string;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState<Record<string, unknown>>({});

  // Read once on opening. The selection cannot change while the menu is up,
  // and reading it on every render would ask the editor for the caret far
  // more often than the answer can change.
  React.useEffect(() => {
    if (open) setActive(editorHandle.current?.activeFormats() ?? {});
  }, [open, editorHandle]);

  const apply = (name: string, value: string | boolean) => {
    editorHandle.current?.format(name, value);
    setActive(editorHandle.current?.activeFormats() ?? {});
  };

  const striking = active.strike === true;
  /** Quill keeps both under one format, so they take turns rather than stack. */
  const script = active.script;
  /** Same one-at-a-time rule: a line is a bullet list, a numbered list, or neither. */
  const list = active.list;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("textStyle")}
          aria-label={t("textStyle")}
          className={
            className ??
            "flex h-7 w-7 items-center justify-center rounded font-serif text-[15px] leading-none text-stone-500 hover:text-stone-800"
          }
        >
          <span aria-hidden>
            A<span className="text-[11px]">a</span>
          </span>
        </button>
      </PopoverTrigger>
      <MailPopoverContent
        align="start"
        collisionPadding={8}
        // Wide enough for the ten cells of a colour row on one line. The
        // height is capped because the composer can sit in a short window,
        // where the whole menu fits neither above it nor below.
        className="w-[26rem] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto rounded-xl p-1.5"
        // Leave the caret where the writer put it, rather than letting Radix
        // hand focus back to the button when the menu closes.
        onCloseAutoFocus={(e) => e.preventDefault()}
        /*
          Applying a format takes the caret back, which is a focus leaving
          the menu, which Radix reads as "done here" and shuts it. But this
          menu is five rows of choices — a size and then a colour is one
          visit, not two — and every pick was closing it. A press outside
          still closes it; only the focus following the format does not.
        */
        onFocusOutside={(e) => e.preventDefault()}
      >
        <Row label={t("lists")}>
          <button
            type="button"
            aria-pressed={list === "bullet"}
            title={t("bulletList")}
            aria-label={t("bulletList")}
            className={cn(
              PILL,
              "inline-flex items-center gap-1.5",
              list === "bullet" ? PILL_ON : PILL_OFF
            )}
            onClick={() =>
              apply("list", list === "bullet" ? false : "bullet")
            }
          >
            <List className="h-3.5 w-3.5" aria-hidden />
            {t("bulletList")}
          </button>
          <button
            type="button"
            aria-pressed={list === "ordered"}
            title={t("numberedList")}
            aria-label={t("numberedList")}
            className={cn(
              PILL,
              "inline-flex items-center gap-1.5",
              list === "ordered" ? PILL_ON : PILL_OFF
            )}
            onClick={() =>
              apply("list", list === "ordered" ? false : "ordered")
            }
          >
            <ListOrdered className="h-3.5 w-3.5" aria-hidden />
            {t("numberedList")}
          </button>
        </Row>
        <Row label={t("style")}>
          <button
            type="button"
            aria-pressed={striking}
            title={t("strikethrough")}
            aria-label={t("strikethrough")}
            className={cn(PILL, striking ? PILL_ON : PILL_OFF, "line-through")}
            onClick={() => apply("strike", !striking)}
          >
            ab
          </button>
          <button
            type="button"
            aria-pressed={script === "sub"}
            title={t("subscript")}
            aria-label={t("subscript")}
            className={cn(PILL, script === "sub" ? PILL_ON : PILL_OFF)}
            onClick={() => apply("script", script === "sub" ? false : "sub")}
          >
            x<sub className="text-[10px]">2</sub>
          </button>
          <button
            type="button"
            aria-pressed={script === "super"}
            title={t("superscript")}
            aria-label={t("superscript")}
            className={cn(PILL, script === "super" ? PILL_ON : PILL_OFF)}
            onClick={() =>
              apply("script", script === "super" ? false : "super")
            }
          >
            x<sup className="text-[10px]">2</sup>
          </button>
        </Row>
        <Row label={t("highlight")}>
          <Swatches
            presets={HIGHLIGHTS}
            active={active.background}
            clearLabel={t("highlightNone")}
            onPick={(value) => apply("background", value)}
          />
        </Row>
        <Row label={t("textColor")}>
          <Swatches
            presets={TEXT_COLORS}
            active={active.color}
            clearLabel={t("colorDefault")}
            onPick={(value) => apply("color", value)}
          />
        </Row>
        <Row label={t("font")}>
          {FONTS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sameValue(active.font, option.value)}
              className={cn(
                PILL,
                sameValue(active.font, option.value) ? PILL_ON : PILL_OFF
              )}
              style={{ fontFamily: option.value || undefined }}
              onClick={() => apply("font", option.value)}
            >
              {t(option.label)}
            </button>
          ))}
        </Row>
        <Row label={t("size")}>
          {SIZES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={sameValue(active.size, option.value)}
              className={cn(
                PILL,
                sameValue(active.size, option.value) ? PILL_ON : PILL_OFF
              )}
              onClick={() => apply("size", option.value)}
            >
              {t(option.label)}
            </button>
          ))}
        </Row>
      </MailPopoverContent>
    </Popover>
  );
}
