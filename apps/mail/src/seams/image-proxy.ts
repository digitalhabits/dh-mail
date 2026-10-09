/**
 * Remote images, for a build with no server.
 *
 * A server host rewrites every remote image to a same-origin proxy route. This
 * build has no server to host one, so images go to a scheme the shell answers,
 * and native code fetches them. See `products/mail/crates/mail-native/src/images.rs`.
 *
 * Doing it natively is not a workaround. It is better than a webview loading
 * the image itself: no cookies and no referrer go out, and a sender's
 * Cross-Origin-Resource-Policy header cannot block it.
 */

import { utf8ToBase64Url } from "@/lib/base64";

/**
 * Where the shell answers — which is not the same address on both systems.
 *
 * A scheme registered with Tauri is reached at `dhmail://localhost/…` on a
 * Mac, and at `http://dhmail.localhost/…` on Windows, where WebView2 can only
 * intercept http. The Mac address was written here for both, so on Windows
 * every remote image asked for a scheme the webview does not know, and drew a
 * broken frame in place of the picture.
 *
 * The shell answers on the path either way — see `address_from_path` in
 * products/mail/crates/mail-native/src/images.rs — so only the address in
 * front of it changes, and the policy that has to admit it.
 *
 * Read the way `main.tsx` reads it: `userAgentData` is separate from the user
 * agent string the window is configured with, and WKWebView does not
 * implement it at all, so a missing answer is a Mac.
 */
const SCHEME = "dhmail";

const onWindows =
  typeof navigator !== "undefined" &&
  (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData?.platform?.toLowerCase() === "windows";

/** What the message frame's `img-src` must allow. */
export const MAIL_IMAGE_CSP_SOURCE = onWindows
  ? `http://${SCHEME}.localhost`
  : `${SCHEME}:`;

const PREFIX = onWindows
  ? `http://${SCHEME}.localhost/`
  : `${SCHEME}://localhost/`;

function toNative(remote: string): string {
  const trimmed = remote.trim();
  // `//host/path` means "same scheme as the page". The page is a srcdoc
  // frame, so the browser resolves it against the app and asks for it over
  // https — which the frame's policy refuses, because it was never rewritten.
  // It is a remote image like any other, so treat it as one.
  const absolute = /^\/\/[^/]/.test(trimmed) ? `https:${trimmed}` : trimmed;
  if (!/^https?:\/\//i.test(absolute)) return remote;
  // base64url, so a sender's query string cannot be read as part of ours.
  return PREFIX + utf8ToBase64Url(absolute);
}

/** `url(...)` inside a style attribute — how a marketing email paints. */
function rewriteStyleUrls(style: string): string {
  return style.replace(
    /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
    (whole, quote: string, address: string) => {
      const next = toNative(address);
      return next === address ? whole : `url(${quote}${next}${quote})`;
    }
  );
}

/** Same job as a server host's, pointed at the shell instead of a route. */
export function rewriteRemoteImagesThroughProxy(
  html: string,
  _origin: string
): string {
  if (!html) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const img of doc.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (src) img.setAttribute("src", toNative(src));
  }

  // The old table-layout way of setting a background, which plenty of mail
  // still uses.
  for (const el of doc.querySelectorAll("[background]")) {
    const src = el.getAttribute("background");
    if (src) el.setAttribute("background", toNative(src));
  }

  for (const el of doc.querySelectorAll("[style]")) {
    const style = el.getAttribute("style");
    if (!style || !style.includes("url(")) continue;
    el.setAttribute("style", rewriteStyleUrls(style));
  }

  for (const el of doc.querySelectorAll("[srcset]")) {
    const srcset = el.getAttribute("srcset");
    if (!srcset) continue;
    el.setAttribute(
      "srcset",
      srcset
        .split(",")
        .map((part) => {
          const bits = part.trim().split(/\s+/);
          if (!bits[0]) return part;
          bits[0] = toNative(bits[0]);
          return bits.join(" ");
        })
        .join(", ")
    );
  }

  return doc.body.innerHTML;
}
