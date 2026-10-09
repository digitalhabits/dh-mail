/**
 * Base64, using the web platform rather than Node.
 *
 * The mail core runs in a webview on the standalone product, and a webview has
 * no `Buffer`. These work in both places: `atob`, `btoa`, `TextEncoder`, and
 * `TextDecoder` are all in Node 16 and later as well.
 *
 * `btoa` takes one character per byte, so text has to become bytes first. Pass
 * it a string holding any character above U+00FF and it throws.
 */

/** Bytes as a base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // In chunks: spreading a large array overflows the call stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** A base64 string as bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

/** Text as base64, through UTF-8. */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

/** Base64 as text, through UTF-8. */
export function base64ToUtf8(base64: string): string {
  return new TextDecoder().decode(base64ToBytes(base64));
}

/** base64url without padding, the way Node's "base64url" encoding writes it. */
export function base64ToBase64Url(base64: string): string {
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url back to base64, restoring the padding that `atob` expects. */
export function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = base64.length % 4;
  return remainder ? base64 + "=".repeat(4 - remainder) : base64;
}

export function utf8ToBase64Url(text: string): string {
  return base64ToBase64Url(utf8ToBase64(text));
}

export function base64UrlToUtf8(value: string): string {
  return base64ToUtf8(base64UrlToBase64(value));
}

/** base64url as bytes. Gmail returns attachment data this way. */
export function base64UrlToBytes(value: string): Uint8Array {
  return base64ToBytes(base64UrlToBase64(value));
}
