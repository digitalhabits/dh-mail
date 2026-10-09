/**
 * The font and size a message is written in, and each account's default.
 *
 * A message goes out in the account's default (the wrapper round the body,
 * see `bodyWrapperStyle`), and the composer shows it the same way. Text the
 * writer gives another font or size carries that as an inline style, from
 * the Aa menu (see TextStyleMenu). Text in the default carries none, so a
 * new default reaches all of it.
 *
 * The default is set from the Aa menu ("Make my default"), one per account:
 * a work account and a private one can differ. Out of the box it is Aptos at
 * 12 pt, Outlook's own, so mail from here reads like mail from Outlook.
 */

import { mailStore } from "@/lib/mail/store";
import { tauriInvoke } from "@/lib/mail/store/tauri";

/**
 * The fonts offered by name. Whole stacks, and no quotation marks: a
 * browser rewrites them when it reads the style back. A reader whose machine
 * has not the first font gets the next.
 */
export const TEXT_FONTS = [
  { id: "aptos", label: "Aptos", stack: "Aptos, Calibri, Helvetica, Arial, sans-serif" },
  { id: "calibri", label: "Calibri", stack: "Calibri, Carlito, Helvetica, Arial, sans-serif" },
  { id: "arial", label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { id: "helvetica", label: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { id: "verdana", label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { id: "georgia", label: "Georgia", stack: "Georgia, Times New Roman, serif" },
  { id: "times", label: "Times New Roman", stack: "Times New Roman, Times, serif" },
  { id: "courier", label: "Courier New", stack: "Courier New, Courier, monospace" },
] as const;

/** The three that are one press away, the default first. */
const QUICK_FONTS = ["aptos", "georgia", "courier"];

/** The sizes in the size grid, in points. */
export const TEXT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
/** The sizes on the row itself. */
export const QUICK_SIZES = [10, 12, 14, 18];

/** A font is the id of one of TEXT_FONTS, or the name of any other font. */
export type TextStyle = { font: string; size: number };

export const TEXT_STYLE_FALLBACK: TextStyle = { font: "aptos", size: 12 };

function knownFont(font: string) {
  return TEXT_FONTS.find((f) => f.id === font);
}

/** A family name as CSS takes it: quoted only when it has to be. */
function cssFamily(name: string): string {
  return /^[A-Za-z][A-Za-z0-9 -]*$/.test(name) ? name : `"${name.replace(/"/g, "")}"`;
}

export function fontStack(font: string): string {
  return knownFont(font)?.stack ?? `${cssFamily(font)}, sans-serif`;
}

export function fontLabel(font: string): string {
  return knownFont(font)?.label ?? font;
}

/** The name on a button of the row, where Courier New is just Courier. */
export function fontShortLabel(font: string): string {
  return font === "courier" ? "Courier" : fontLabel(font);
}

/**
 * The fonts for the row: the default, then the ones picked lately, then
 * Georgia and Courier to fill the three places.
 */
export function quickFonts(defaultFont: string, recent: string[] = []): string[] {
  const out: string[] = [defaultFont];
  for (const font of [...recent, ...QUICK_FONTS]) {
    if (out.length === 3) break;
    if (!out.some((f) => f.toLowerCase() === font.toLowerCase())) out.push(font);
  }
  return out;
}

/**
 * Which font an inline style names: one of ours by its first family, or the
 * family itself. Null when there is none, and the text is in the default.
 * Also reads the stacks of the older menu (Serif was Georgia's stack).
 */
export function fontFromStyle(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const first = value.split(",")[0].replace(/["']/g, "").trim();
  const known = TEXT_FONTS.find((f) => f.label.toLowerCase() === first.toLowerCase());
  return known ? known.id : first;
}

/** The size an inline style names, in points (an older px size is turned). */
export function sizeFromStyle(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^([\d.]+)\s*(pt|px)?$/i.exec(value.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return m[2]?.toLowerCase() === "px" ? Math.round(n * 0.75) : n;
}

/** The style round a message's body, as it is sent. */
export function bodyWrapperStyle(style: TextStyle): string {
  return `font-family:${fontStack(style.font)};font-size:${style.size}pt;line-height:1.6;color:#222`;
}

// ---- the default, per account

const KEY = "mail_text_style";

function keyFor(account: string): string {
  return `${KEY}:${account.trim().toLowerCase()}`;
}

function parse(raw: string | null | undefined): TextStyle {
  if (!raw) return TEXT_STYLE_FALLBACK;
  try {
    const value = JSON.parse(raw) as Partial<TextStyle>;
    const font = typeof value.font === "string" && value.font.trim() ? value.font : TEXT_STYLE_FALLBACK.font;
    const size =
      typeof value.size === "number" && value.size >= 6 && value.size <= 96 ? value.size : TEXT_STYLE_FALLBACK.size;
    return { font, size };
  } catch {
    return TEXT_STYLE_FALLBACK;
  }
}

const listeners = new Set<(account: string, style: TextStyle) => void>();

/** Told when an account's default changes. Returns the way to stop. */
export function onTextStyleDefaultChange(
  listener: (account: string, style: TextStyle) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getTextStyleDefault(account: string | null | undefined): Promise<TextStyle> {
  if (!account) return TEXT_STYLE_FALLBACK;
  try {
    return parse(await mailStore().settings.get(keyFor(account)));
  } catch {
    return TEXT_STYLE_FALLBACK;
  }
}

export async function setTextStyleDefault(account: string, style: TextStyle): Promise<void> {
  await mailStore().settings.set(keyFor(account), JSON.stringify(style));
  for (const listener of listeners) listener(account.trim().toLowerCase(), style);
}

/**
 * Whether this machine has a font, to warn before a name that will not show.
 * A string set in the font, then in two generic families: a font that is not
 * there falls back, and measures the same as one of them.
 */
export function fontIsInstalled(name: string): boolean {
  if (typeof document === "undefined") return true;
  const canvas = document.createElement("canvas").getContext("2d");
  if (!canvas) return true;
  const sample = "mmmmmmmmmmlli1WQ@#";
  const width = (family: string) => {
    canvas.font = `72px ${family}`;
    return canvas.measureText(sample).width;
  };
  return ["monospace", "serif", "sans-serif"].some(
    (generic) => width(`${cssFamily(name)}, ${generic}`) !== width(generic)
  );
}

// ---- the fonts on this computer, and the ones picked lately

let installed: Promise<string[]> | null = null;

/** The fonts installed here, from the app (see mail-native fonts.rs); none in a browser. */
export function listInstalledFonts(): Promise<string[]> {
  if (!installed) {
    const invoke = tauriInvoke();
    installed = invoke
      ? Promise.resolve(invoke("list_system_fonts") as Promise<unknown>)
          .then((names) => (Array.isArray(names) ? names.filter((n): n is string => typeof n === "string") : []))
          .catch(() => [])
      : Promise.resolve([]);
  }
  return installed;
}

/**
 * The fonts picked lately, newest first: one of ours by its id, any other by
 * its name. Kept for the device, not the account: a font is liked by a
 * person, not by a mailbox.
 */
const RECENT_KEY = "mail_recent_fonts";
const RECENT_MAX = 5;
const recentListeners = new Set<(fonts: string[]) => void>();

export async function getRecentFonts(): Promise<string[]> {
  try {
    const raw = await mailStore().settings.get(RECENT_KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(value) ? value.filter((f): f is string => typeof f === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export async function noteRecentFont(font: string): Promise<void> {
  const before = await getRecentFonts();
  const next = [font, ...before.filter((f) => f.toLowerCase() !== font.toLowerCase())].slice(0, RECENT_MAX);
  try {
    await mailStore().settings.set(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* outside the app: the list lasts this visit */
  }
  for (const listener of recentListeners) listener(next);
}

export function onRecentFontsChange(listener: (fonts: string[]) => void): () => void {
  recentListeners.add(listener);
  return () => recentListeners.delete(listener);
}
