"use client";

/**
 * The reader's own colours for the five surfaces of the window (light
 * theme only): the top bar, the folder rail, the mail list, the list's
 * head (account tabs and filters), and the thread reader.
 *
 * Kept per window in localStorage. Each colour the reader set goes on <html>
 * as a `--mail-user-*` variable, and mail.css reads it with the default as
 * the fallback. A colour that is not set is not written, so the defaults
 * stay in one place (mail.css).
 */

import { MAIL_SURFACE_COLORS_KEY } from "@/lib/mail/storage-keys";

export const SURFACES = ["top", "rail", "list", "listHead", "readerHead", "reader"] as const;
export type Surface = (typeof SURFACES)[number];
export type SurfaceColors = Partial<Record<Surface, string>>;

/** What each surface is when the reader has not set it. Keep in step with mail.css. */
export const SURFACE_DEFAULTS: Record<Surface, string> = {
  top: "#f0eae1",
  rail: "#f0eae1",
  list: "#f5f1ea",
  listHead: "#f5f1ea",
  readerHead: "#f5f1ea",
  reader: "#f0eae1",
};

/**
 * The Centre for Digital Habits design system's colours, offered first: its
 * light grounds, its green, the website's own, and the app's navy (Ulrik,
 * 2026-10-30). On the two dark ones a part's words go cream (mail.css,
 * data-mail-dark).
 */
export const DESIGN_SYSTEM_SWATCHES: { name: string; value: string }[] = [
  // Light to dark, white first (Ulrik, 2026-10-31).
  { name: "White", value: "#ffffff" },
  { name: "Cream", value: "#f5f1ea" },
  // Halfway from cream to sand (Ulrik, 2026-10-30).
  { name: "Light sand", value: "#f0eae1" },
  // Mail's own sand, as the released app has it, not the website's #e9e4da
  // (Ulrik, 2026-10-30).
  { name: "Sand", value: "#ebe4d8" },
  { name: "Haze", value: "#e6eff2" },
  { name: "Mist", value: "#d6e5ea" },
  { name: "Green", value: "#005d53" },
  // The app's navy (brandNavy), the dark theme's ground.
  { name: "Navy", value: "#1e2d3e" },
];

/**
 * The colour options for a part: the design system's, then each other
 * colour set on any part, so a colour picked once can be picked again
 * elsewhere (2026-10-30). Named by their hex, in the order of the parts.
 */
export function swatchesFor(colors: SurfaceColors): { name: string; value: string }[] {
  const known = new Set(DESIGN_SYSTEM_SWATCHES.map((s) => s.value));
  const used: { name: string; value: string }[] = [];
  for (const surface of SURFACES) {
    const value = colors[surface];
    if (!value || known.has(value)) continue;
    known.add(value);
    used.push({ name: value.toUpperCase(), value });
  }
  return [...DESIGN_SYSTEM_SWATCHES, ...used];
}

const CSS_VAR: Record<Surface, string> = {
  top: "--mail-user-top",
  rail: "--mail-user-rail",
  list: "--mail-user-list",
  listHead: "--mail-user-list-head",
  readerHead: "--mail-user-reader-head",
  reader: "--mail-user-reader",
};

const EVENT = "redd-plan-mail-surface-colors-changed";
const HEX = /^#[0-9a-f]{6}$/i;

let cachedRaw: string | null | undefined;
let cached: SurfaceColors = {};

export function readSurfaceColors(): SurfaceColors {
  if (typeof window === "undefined") return {};
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(MAIL_SURFACE_COLORS_KEY);
  } catch {
    /* private mode */
  }
  // The same object while nothing changed: useSyncExternalStore needs that.
  if (raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = {};
  try {
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const surface of SURFACES) {
      const value = parsed[surface];
      if (typeof value === "string" && HEX.test(value)) {
        const color = value.toLowerCase();
        // The Sand swatch was the website's #e9e4da for a day: read as Mail's.
        cached[surface] = color === "#e9e4da" ? "#ebe4d8" : color;
      }
    }
  } catch {
    /* a broken value reads as no colours set */
  }
  return cached;
}

function writeSurfaceColors(next: SurfaceColors): void {
  try {
    if (Object.keys(next).length) {
      localStorage.setItem(MAIL_SURFACE_COLORS_KEY, JSON.stringify(next));
    } else {
      localStorage.removeItem(MAIL_SURFACE_COLORS_KEY);
    }
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The colour a surface is painted in now: its own, or its default. */
export function effectiveSurfaceColor(colors: SurfaceColors, surface: Surface): string {
  return colors[surface] ?? unsetSurfaceColor(colors, surface);
}

/** What a surface falls back to when it has no colour of its own. */
function unsetSurfaceColor(_colors: SurfaceColors, surface: Surface): string {
  return SURFACE_DEFAULTS[surface];
}

/** Sets one surface's colour; the colour it would have anyway, or none, clears it. */
export function setSurfaceColor(surface: Surface, color: string | null): void {
  const next = { ...readSurfaceColors() };
  if (!color || color.toLowerCase() === unsetSurfaceColor(next, surface)) delete next[surface];
  else if (HEX.test(color)) next[surface] = color.toLowerCase();
  writeSurfaceColors(next);
}

export function resetSurfaceColors(): void {
  writeSurfaceColors({});
}

export function subscribeSurfaceColors(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** A colour made a little darker and a little stronger, in its own hue. */
function railStep(color: string, darker: number, stronger: number): string {
  return `oklch(from ${color} calc(l - ${darker}) calc(c * ${stronger}) h)`;
}

/**
 * Puts the reader's colours on <html>, where mail.css reads them. The folder
 * rail's hover and chosen folder follow its colour, a step and two steps
 * darker, as the default sand's do.
 */
export function applySurfaceColors(colors: SurfaceColors, root: HTMLElement = document.documentElement): void {
  for (const surface of SURFACES) {
    const value = colors[surface];
    if (value) root.style.setProperty(CSS_VAR[surface], value);
    else root.style.removeProperty(CSS_VAR[surface]);
  }
  // The parts whose colour is dark, for mail.css to turn their words and
  // icons cream: <html data-mail-dark="top reader">.
  const dark = SURFACES.filter((surface) => isDarkColor(effectiveSurfaceColor(colors, surface)));
  if (dark.length) root.setAttribute?.("data-mail-dark", dark.join(" "));
  else root.removeAttribute?.("data-mail-dark");
  if (colors.rail) {
    // Darker in its own hue, as #ebe4d8 steps to #e4dccd and #dcd3c3. A mix
    // with ink turned a warm sand grey (2026-10-30).
    root.style.setProperty("--mail-user-rail-hover", railStep(colors.rail, 0.025, 1.15));
    root.style.setProperty("--mail-user-rail-active", railStep(colors.rail, 0.05, 1.3));
  } else {
    root.style.removeProperty("--mail-user-rail-hover");
    root.style.removeProperty("--mail-user-rail-active");
  }
}

/** Where a right-click must keep the system's menu: on content, not background. */
const NOT_BACKGROUND = [
  "input",
  "textarea",
  "select",
  "[contenteditable='true']",
  "a",
  "button",
  "img",
  "iframe",
  "[role='menu']",
  "[role='dialog']",
  ".mail-bubble-card",
  "[class*='mail-bubble-own']",
].join(",");

/** Each part of the window, by the element that paints it, inner first. */
const SURFACE_AT: [string, Surface][] = [
  [".mail-titlebar", "top"],
  ["[data-folder-rail]", "rail"],
  [".mail-list-head", "listHead"],
  [".mail-thread-header", "readerHead"],
  [".mail-thread-toolbar", "readerHead"],
  ["[data-list-expanded]", "list"],
  [".mail-reading-pane", "reader"],
];

type ClosestTarget = { closest: (selector: string) => { getAttribute?: (name: string) => string | null } | null };

/**
 * Which part of the window a right-click landed on the background of, or
 * null: on content, outside the mail window, or in the dark theme, where
 * these colours do not apply.
 */
export function surfaceAt(target: EventTarget | null): Surface | null {
  const el = target as ClosestTarget | null;
  if (!el || typeof el.closest !== "function") return null;
  if (el.closest(NOT_BACKGROUND)) return null;
  const shell = el.closest(".mail-shell");
  if (!shell || shell.getAttribute?.("data-theme") === "dark") return null;
  for (const [selector, surface] of SURFACE_AT) {
    if (el.closest(selector)) return surface;
  }
  return null;
}

/**
 * Whether ink text would be hard to read on a colour: its relative
 * luminance (WCAG) under 0.3. The design system's green is 0.08; its mist,
 * the darkest light ground, 0.76.
 */
export function isDarkColor(hex: string): boolean {
  if (!HEX.test(hex)) return false;
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance < 0.3;
}
