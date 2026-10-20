/**
 * Microsoft's safe links: followed as they are, unless they are broken.
 *
 * Outlook rewrites every link in mail it receives as
 * `https://<region>.safelinks.protection.outlook.com/?url=<the real
 * address>&data=…&sdata=<a signature over the rest>`. A click on it goes
 * through Microsoft Defender, which checks the address at that moment: a
 * page can turn bad after the mail arrived. The reader's organisation chose
 * that check, so a click keeps it, as Outlook, Apple Mail and Gmail do.
 *
 * Two things are different:
 *
 * - A safe link whose signature is broken opens the address it wraps. A
 *   client that decodes a forwarded message twice can turn "&sdata=2B2q…"
 *   into "&sdata+2q…". Microsoft then answers "Bad Request" to everybody,
 *   and the check is lost anyway. The signature is 32 bytes in base64: 44
 *   characters, the last one "=". Anything else is taken as broken.
 * - The real address is shown: as the link's hover text, and at the top of
 *   its menu, with a way to copy it. So a reader can see where a link goes.
 *
 * No React here, so a test can read it.
 */

const SAFE_LINKS_HOST = /(^|\.)safelinks\.protection\.outlook\.com$/i;
const SIGNATURE = /^[A-Za-z0-9+/]{43}=$/;

function parse(href: string): URL | null {
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

/** The web address a safe link wraps, or null for any other link. */
export function safeLinkTarget(href: string): string | null {
  const url = parse(href);
  if (!url || !SAFE_LINKS_HOST.test(url.hostname)) return null;
  const inner = url.searchParams.get("url");
  if (!inner || !/^https?:\/\//i.test(inner)) return null;
  return parse(inner)?.href ?? null;
}

/** Whether a safe link's signature is missing or is not of its shape. */
export function safeLinkIsBroken(href: string): boolean {
  if (!safeLinkTarget(href)) return false;
  const signature = parse(href)?.searchParams.get("sdata") ?? "";
  return !SIGNATURE.test(signature);
}

/** The link to follow: a broken safe link's real address, else the link. */
export function repairSafeLink(href: string): string {
  return safeLinkIsBroken(href) ? (safeLinkTarget(href) ?? href) : href;
}
