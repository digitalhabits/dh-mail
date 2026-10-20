/**
 * Which addresses a message may keep: an allowlist of URL schemes.
 *
 * The sanitizer (`email-html.ts`) calls these on every attribute that holds
 * an address. An address that fails is taken away, with its attribute.
 *
 *   a link      http, https, mailto, cid, or no scheme at all (a relative
 *               address or a #fragment, which the frame does not open)
 *   a picture   http, https, cid, or a data: URL of a raster image
 *
 * A data: URL is never a link, and an SVG data: URL is never a picture.
 * An SVG can carry script and links of its own.
 *
 * The scheme is read the way a browser reads it. A browser drops tabs and
 * line breaks anywhere in a URL, and spaces and control characters at the
 * start, so `java&#9;script:` is `javascript:`. This takes all of them out
 * before it reads the scheme. No DOM in here, so a test can read it.
 */

/** Characters a browser ignores in a URL, or that a sender can hide in one. */
const IGNORED_IN_URL = /[\u0000-\u0020\u007f-\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u205f\u3000\ufeff]/g;

const LINK_SCHEMES = new Set(["http", "https", "mailto", "cid"]);
const IMAGE_SCHEMES = new Set(["http", "https", "cid"]);

/** Raster image types only. Not image/svg+xml. */
const RASTER_DATA_URL =
  /^data:image\/(?:png|gif|jpe?g|pjpeg|webp|bmp|avif|apng|x-icon|vnd\.microsoft\.icon)[;,]/i;

/** The scheme of an address, lower-case, or null for a relative one. */
export function urlScheme(value: string): string | null {
  const cleaned = value.replace(IGNORED_IN_URL, "");
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(cleaned);
  return match ? match[1].toLowerCase() : null;
}

/** True when a message may keep this address on a link. */
export function isAllowedLinkUrl(value: string): boolean {
  const scheme = urlScheme(value);
  return scheme == null || LINK_SCHEMES.has(scheme);
}

/** True when a message may keep this address on a picture. */
export function isAllowedImageUrl(value: string): boolean {
  const scheme = urlScheme(value);
  if (scheme == null) return false;
  if (scheme === "data") return RASTER_DATA_URL.test(value.replace(IGNORED_IN_URL, ""));
  return IMAGE_SCHEMES.has(scheme);
}

/**
 * The addresses in a `srcset`, in order.
 *
 * Each candidate is an address and then optional descriptors, and a comma
 * ends it. An address is everything up to white space. A comma at its end
 * belongs to the list, not to the address.
 */
export function srcsetUrls(value: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < value.length) {
    while (at < value.length && /[\s,]/.test(value[at])) at += 1;
    if (at >= value.length) break;
    let end = at;
    while (end < value.length && !/\s/.test(value[end])) end += 1;
    let url = value.slice(at, end);
    const endsList = url.endsWith(",");
    url = url.replace(/,+$/, "");
    if (url) out.push(url);
    at = end;
    if (endsList) continue;
    // Skip the descriptors, to the comma that ends this candidate.
    while (at < value.length && value[at] !== ",") at += 1;
  }
  return out;
}

/** True when every address in a `srcset` is one a picture may keep. */
export function isAllowedSrcset(value: string): boolean {
  return srcsetUrls(value).every(isAllowedImageUrl);
}
