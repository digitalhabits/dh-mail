/**
 * Whether this is the Windows shell, for the few things that differ.
 *
 * The shell writes `data-dh-os` on the document as it starts, from
 * `navigator.userAgentData` — see `main.tsx` in the standalone app. WebKit
 * has no such thing, so a Mac sets nothing at all and Windows is the only
 * one that announces itself. That is the convention the standalone app's
 * own CSS follows (`html[data-dh-os="windows"]`), and asking the question
 * this way round is what makes a Mac and a browser behave the same.
 */
export function isWindowsHost(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.dhOs === "windows";
}
