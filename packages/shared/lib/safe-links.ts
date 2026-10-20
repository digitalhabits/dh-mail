/**
 * Microsoft's safe links, opened at the address they wrap.
 *
 * Outlook rewrites every link in mail it receives as
 * `https://<region>.safelinks.protection.outlook.com/?url=<the real
 * address>&data=…&sdata=<a signature over the rest>`. When the mail is
 * forwarded through a client that mangles one character of that — a
 * second quoted-printable decode turned "&sdata=2B2q…" into "&sdata+2q…"
 * in a forward Mikkel sent (2026-10-20) — the signature fails, and
 * Microsoft answers "Bad Request" to everybody. The address it wraps is
 * still whole, so the link opens that: the same page the safe link sends
 * an Outlook reader to, without the round trip through Microsoft.
 *
 * Unwrapped where links are made (findLinksInText, the HTML cleaner) and
 * where a click ends (followMailLink): a click reaches the browser by more
 * than one way — a plain-text link is opened by the desktop shell itself,
 * without the page's click code — and each way kept the broken safe link.
 *
 * No React here, so a test can read it.
 */

const SAFE_LINKS_HOST = /(^|\.)safelinks\.protection\.outlook\.com$/i;

/** The address a safe link wraps, or the link as it was. */
export function unwrapSafeLink(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (!SAFE_LINKS_HOST.test(url.hostname)) return href;
  const inner = url.searchParams.get("url");
  if (!inner || !/^https?:\/\//i.test(inner)) return href;
  try {
    return new URL(inner).href;
  } catch {
    return href;
  }
}
