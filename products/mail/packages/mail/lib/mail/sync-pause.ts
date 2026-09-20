/**
 * What a paused sync means for the reader, from the reason the worker gave.
 *
 * The worker writes its reason for a developer — "the token request failed:
 * error sending request for url (https://oauth2.googleapis.com/token)" — and
 * the list used to show it as it was. Nobody who read that knew whether
 * something was wrong with their account, or whether they had to do anything.
 *
 * Three answers cover it:
 *
 * - "offline": the network did not answer. There is nothing to do; the
 *   worker tries again by itself.
 * - "signIn": Google no longer accepts the sign-in. Only the reader can fix
 *   it, with Reconnect. The worker says "needs reconnect" in every such
 *   reason (see sync.rs).
 * - "other": anything else. The worker still tries again, and the reason is
 *   kept for whoever is asked to look.
 *
 * "reconnecting", which the worker adds after network drops that keep
 * happening, is not "needs reconnect". The list used to read it as one, and
 * offered Reconnect for a dropped Wi-Fi connection.
 */

export type SyncPauseKind = "offline" | "signIn" | "other";

/** The word on its own, so "reconnecting" does not count. */
const SIGN_IN = /\breconnect\b|invalid_grant/i;

const OFFLINE: RegExp[] = [
  /the token request failed/i,
  /error sending request/i,
  // The Outlook worker runs in the web view, and these are a web view's words
  // for a request that got no answer: Chromium's, WebKit's, and Firefox's.
  /failed to fetch|load failed|networkerror/i,
  /\breconnecting\s*$/i,
  /timed out|timeout/i,
  /connection (refused|reset|closed|aborted)/i,
  /network is (down|unreachable)/i,
  /no route to host/i,
  /failed to lookup|could not resolve|dns error|nodename nor servname/i,
  /broken pipe/i,
];

export function syncPauseKind(reason: string | null | undefined): SyncPauseKind {
  const text = (reason ?? "").trim();
  if (!text) return "other";
  if (SIGN_IN.test(text)) return "signIn";
  if (OFFLINE.some((pattern) => pattern.test(text))) return "offline";
  return "other";
}
