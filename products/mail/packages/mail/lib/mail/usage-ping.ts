/**
 * The "Send anonymous usage count" setting of the standalone Mail app.
 *
 * Only the release desktop app sends the count, from
 * apps/mail/src/usage-ping.ts, which also sets the flag that shows the
 * switch in Settings > General. Any other host never sends one and
 * never shows the switch. The setting lives in localStorage because it
 * belongs to this install, like the count's own key.
 */

export const USAGE_PING_URL = "https://plan.digitalhabits.org/api/ping";
export const USAGE_PING_ENABLED_KEY = "mail_usage_ping_enabled";

/** On unless the user turned it off. */
export function readUsagePingEnabled(): boolean {
  try {
    return localStorage.getItem(USAGE_PING_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeUsagePingEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(USAGE_PING_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    /* localStorage may be disabled; the count then stays on */
  }
}
