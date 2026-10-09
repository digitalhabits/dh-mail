/**
 * Whether the interface is on a phone, and what follows from it.
 *
 * Two answers, both read from the document rather than from the window
 * size alone:
 *
 * - The shell says so. The standalone app's phone builds set a user agent
 *   with a marker in it (see `tauri.ios.conf.json` and
 *   `tauri.android.conf.json`), and `main.tsx` puts `data-dh-form="phone"`
 *   on the document from it. A browser can be told the same with
 *   `?mobile=1`, which is how the layout is looked at on a desk.
 * - The window is the shape of a phone: narrow, with a touch pointer. A
 *   narrow desktop window keeps the desktop layout — it has a mouse, and the
 *   Mac and Windows windows cannot be made that narrow anyway.
 *
 * No React here, so the tests run these without a renderer. The hook that
 * subscribes to the answer is `usePhoneLayout` in `use-phone-layout.ts`.
 */

export const PHONE_FORM = "phone";
export const PHONE_FORM_EVENT = "redd-plan-mail-form";

/** Narrow, and driven by a finger. */
export const PHONE_MEDIA = "(max-width: 700px) and (pointer: coarse)";

/**
 * The system a phone build announces in its user agent, or null on
 * anything that is not one. The marker is `dh-mail-mobile/<os>`.
 */
export function hostOsFromUserAgent(userAgent: string): "ios" | "android" | null {
  const match = /dh-mail-mobile\/(ios|android)\b/i.exec(userAgent);
  if (!match) return null;
  return match[1].toLowerCase() as "ios" | "android";
}

/** Say on the document that this is a phone. `main.tsx` calls it once. */
export function markPhoneForm(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.dhForm = PHONE_FORM;
  window.dispatchEvent(new CustomEvent(PHONE_FORM_EVENT));
}

/** True when the shell said this is a phone. */
export function phoneFormRequested(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.dhForm === PHONE_FORM;
}

/** True when the phone layout is wanted: the shell said so, or the window is shaped like one. */
export function readPhoneLayout(): boolean {
  if (phoneFormRequested()) return true;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(PHONE_MEDIA).matches;
}

/** What the search scope chips narrow a search to. */
export type PhoneSearchScope = "everywhere" | "from" | "subject" | "file";

export const PHONE_SEARCH_SCOPES: PhoneSearchScope[] = [
  "everywhere",
  "from",
  "subject",
  "file",
];

/**
 * The query the list gets, from the words typed and the chip chosen.
 *
 * The chips are the search syntax the desktop box already takes — `from:`,
 * `subject:`, `has:attachment` — so nothing about how a search runs
 * changes; the chip only spells the prefix the reader would have typed.
 */
export function phoneSearchQuery(scope: PhoneSearchScope, text: string): string {
  const words = text.trim();
  switch (scope) {
    case "from":
      return words ? `from:${words}` : "";
    case "subject":
      return words ? `subject:${words}` : "";
    case "file":
      return words ? `has:attachment ${words}` : "has:attachment";
    default:
      return words;
  }
}
