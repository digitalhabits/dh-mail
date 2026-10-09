/**
 * When the document navigates away (OAuth start, etc.), WebKit cancels
 * in-flight fetch() with TypeError "Load failed" — not AbortError. Those
 * should not surface as error toasts.
 */

let leavingPage = false;

function markLeaving() {
  leavingPage = true;
}

/** Call from OAuth link clicks / location.assign before the navigation. */
export function noteIntentionalNavigation(): void {
  leavingPage = true;
}

export function shouldIgnoreFetchError(): boolean {
  return leavingPage;
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", markLeaving);
  window.addEventListener("beforeunload", markLeaving);
}
