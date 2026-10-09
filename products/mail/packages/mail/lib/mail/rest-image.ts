/**
 * The picture in the reading pane, before a conversation is chosen.
 *
 * That space is deliberately empty — opening mail should not put a message in
 * front of you. Empty is not the same as wasted, though, so it can hold one
 * picture and one line of text, both the reader's own.
 *
 * Either can be taken away, and taking both away leaves the pane blank. That
 * is a real choice, not a state to be talked out of, so nothing is put back
 * in its place.
 *
 * Everything is kept in localStorage, including the picture, as a data URL.
 * That is why an imported file is scaled down first: a phone photo is several
 * megabytes and the whole store is about five. See `downscaleTarget`.
 *
 * No React here, so a suite can read it.
 */

import { MAIL_LANGS, mailSay, makeMailT } from "@/lib/mail/i18n-strings";

export type MailRestFilter = "none" | "grayscale" | "warm" | "soft";

export type MailRestState = {
  /**
   * Whether the pane has a picture at all.
   *
   * Three states, and `image` alone can only tell two of them apart: no
   * picture chosen yet, which shows the one we ship; a picture chosen; and no
   * picture wanted, which shows nothing. Removing one clears `image` too, so
   * nothing is kept that the reader thinks is gone.
   */
  hasImage: boolean;
  /** A data URL, or null for the picture the app ships with. */
  image: string | null;
  /** Frame width in pixels. Height follows from the frame's aspect. */
  width: number;
  caption: string;
  captionSize: number;
  filter: MailRestFilter;
  /** Pan as a fraction of the frame, and zoom as a multiple of "fills it". */
  crop: { x: number; y: number; zoom: number };
};

export const MAIL_REST_ASPECT = 16 / 10;

export const MIN_REST_WIDTH = 220;
export const MAX_REST_WIDTH = 900;
export const MIN_CAPTION_SIZE = 14;
export const MAX_CAPTION_SIZE = 64;
export const MAX_REST_ZOOM = 4;

/** The longest edge an imported picture is scaled to before it is stored. */
export const REST_IMAGE_MAX_EDGE = 1600;

/**
 * The caption the app ships with, in the reader's language.
 *
 * A caption is free text, and one the reader wrote is theirs — so the only
 * one that follows the language is the one nobody has rewritten. That is what
 * `isDefaultRestCaption` asks: a caption that still says the shipped line, in
 * any language it has, has never been touched.
 */
export function isDefaultRestCaption(caption: string): boolean {
  const text = caption.trim();
  return MAIL_LANGS.some(
    (lang) => makeMailT(lang)("restDefaultCaption") === text
  );
}

/** What the pane shows: the reader's own words, or the shipped ones. */
export function restCaptionText(caption: string): string {
  return isDefaultRestCaption(caption) ? mailSay("restDefaultCaption") : caption;
}

export const DEFAULT_MAIL_REST: MailRestState = {
  hasImage: true,
  image: null,
  width: 500,
  caption: "One thing at a time.",
  captionSize: 30,
  filter: "none",
  crop: { x: 0, y: 0, zoom: 1 },
};

const STORAGE_KEY = "redd-plan-mail-rest";
export const MAIL_REST_EVENT = "redd-plan-mail-rest-changed";

export function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAIL_REST.width;
  return Math.min(MAX_REST_WIDTH, Math.max(MIN_REST_WIDTH, Math.round(value)));
}

export function clampCaptionSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAIL_REST.captionSize;
  return Math.min(
    MAX_CAPTION_SIZE,
    Math.max(MIN_CAPTION_SIZE, Math.round(value))
  );
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_REST_ZOOM, Math.max(1, value));
}

/**
 * Pan, held inside the picture.
 *
 * At zoom 1 the picture exactly fills the frame and there is nothing to pan.
 * Each further step of zoom frees half of the extra width and height in each
 * direction, which is what keeps an edge from sliding into view.
 */
export function clampPan(x: number, y: number, zoom: number): { x: number; y: number } {
  const room = Math.max(0, (clampZoom(zoom) - 1) / 2);
  return {
    x: Math.min(room, Math.max(-room, Number.isFinite(x) ? x : 0)),
    y: Math.min(room, Math.max(-room, Number.isFinite(y) ? y : 0)),
  };
}

/** The size an imported picture is stored at, keeping its proportions. */
export function downscaleTarget(
  width: number,
  height: number,
  maxEdge = REST_IMAGE_MAX_EDGE
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return { width: 0, height: 0 };
  if (longest <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** The CSS `filter` for a look. */
export function filterCss(filter: MailRestFilter): string {
  switch (filter) {
    case "grayscale":
      return "grayscale(1)";
    case "warm":
      return "sepia(0.35) saturate(1.1)";
    case "soft":
      return "saturate(0.75) contrast(0.95) brightness(1.03)";
    default:
      return "none";
  }
}

export const MAIL_REST_FILTERS: { id: MailRestFilter; label: string }[] = [
  { id: "none", label: "Original" },
  { id: "soft", label: "Soft" },
  { id: "warm", label: "Warm" },
  { id: "grayscale", label: "Grey" },
];

/** A stored value, with anything missing or wrong replaced by the default. */
export function normalizeRestState(value: unknown): MailRestState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_MAIL_REST };
  }
  const raw = value as Partial<MailRestState> & { crop?: Partial<MailRestState["crop"]> };
  const zoom = clampZoom(Number(raw.crop?.zoom ?? 1));
  const pan = clampPan(Number(raw.crop?.x ?? 0), Number(raw.crop?.y ?? 0), zoom);
  const filter = raw.filter;
  return {
    // Anything but a stored `false` means a picture: a value written before
    // this field existed is somebody who has one and has never said otherwise.
    hasImage: raw.hasImage !== false,
    // Only a data URL. A remote address here would fetch on every open, and
    // tell whoever serves it when this reader opened their mail.
    image:
      typeof raw.image === "string" && raw.image.startsWith("data:image/")
        ? raw.image
        : null,
    width: clampWidth(Number(raw.width ?? DEFAULT_MAIL_REST.width)),
    caption:
      typeof raw.caption === "string"
        ? raw.caption.slice(0, 200)
        : DEFAULT_MAIL_REST.caption,
    captionSize: clampCaptionSize(
      Number(raw.captionSize ?? DEFAULT_MAIL_REST.captionSize)
    ),
    filter:
      filter === "grayscale" || filter === "warm" || filter === "soft"
        ? filter
        : "none",
    crop: { x: pan.x, y: pan.y, zoom },
  };
}

let cached: MailRestState | null = null;

export function readMailRest(): MailRestState {
  if (typeof window === "undefined") return DEFAULT_MAIL_REST;
  if (cached) return cached;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    cached = normalizeRestState(raw ? JSON.parse(raw) : null);
  } catch {
    cached = { ...DEFAULT_MAIL_REST };
  }
  return cached;
}

/** Merge a change in and store it. Returns what is now stored. */
export function writeMailRest(patch: Partial<MailRestState>): MailRestState {
  const next = normalizeRestState({ ...readMailRest(), ...patch });
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A picture too big for the store is the likely cause. The change stays
    // on screen for this session rather than failing in front of the reader.
  }
  window.dispatchEvent(new Event(MAIL_REST_EVENT));
  return next;
}

export function subscribeMailRest(onChange: () => void): () => void {
  const listener = () => {
    cached = null;
    onChange();
  };
  window.addEventListener(MAIL_REST_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(MAIL_REST_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
