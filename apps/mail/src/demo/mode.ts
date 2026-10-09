/**
 * Whether this window is showing the invented mailbox.
 *
 * Two ways in, because there are two ways the app is looked at: the build
 * flag for `pnpm app:dev:demo`, which is how the Mac window is opened for
 * screenshots, and `?demo=1` for a browser tab.
 *
 * Read through a function rather than exported as a constant so the check
 * reads the same wherever it is made, and so a test can reason about it.
 */
export function isDemoMode(): boolean {
  if (import.meta.env.VITE_MAIL_DEMO === "1") return true;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("demo") === "1";
}
