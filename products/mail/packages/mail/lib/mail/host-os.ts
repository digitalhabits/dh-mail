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

/** The character a key makes without AltGr, for keys whose `code` does not name it. */
const PLAIN_MARKS: Record<string, string> = { Equal: "=+", Minus: "-_" };

/** Windows reports AltGr as Ctrl+Alt: Danish AltGr+0 types "}", which is typing, not a shortcut. */
export function typesWithAltGraph(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey"> & { getModifierState?: (key: string) => boolean }
): boolean {
  const plain = PLAIN_MARKS[e.code] ?? /^(?:Key|Digit)(.)$/.exec(e.code)?.[1].toLowerCase();
  const altGr = e.getModifierState?.("AltGraph") || (e.ctrlKey && e.altKey);
  return isWindowsHost() && e.key.length === 1 && altGr && !plain?.includes(e.key.toLowerCase());
}
