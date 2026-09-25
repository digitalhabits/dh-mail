/**
 * Anonymous usage ping of the standalone Mail app, so we know roughly how
 * many people use it. The same ping Focus, Blocker and To-Do send.
 *
 * At most once per UTC day the app sends { product, platform, key } to the
 * planner's /api/ping. The key is a random id that is replaced at the
 * start of each calendar month, so two months of one install cannot be
 * joined. Nothing about mail, mailboxes, contacts or accounts is sent, and
 * the planner stores no address and no user agent with it. The user can
 * turn it off in Settings > General ("Send anonymous usage count").
 *
 * Only the public desktop app sends it: not the team's build, not the
 * planner's mail tab, not a demo session, not a development build, and not
 * a window other than the main one (apps/mail/src/main.tsx starts it).
 * SECURITY.md lists it among the hosts the app talks to.
 */

import { hostOsFromUserAgent } from "@/lib/mail/host-form";
import { isPublicMailProduct } from "@/lib/mail/product-flavor";

export const USAGE_PING_URL = "https://plan.digitalhabits.org/api/ping";
export const USAGE_PING_ENABLED_KEY = "mail_usage_ping_enabled";
const PING_STATE_KEY = "mail_usage_ping";
const PING_CHECK_MS = 60 * 60_000;

export type UsagePingPlatform = "mac" | "windows" | "ios";
type PingState = { month?: string; key?: string; lastDay?: string };

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
    /* localStorage may be disabled; the ping then stays on */
  }
}

/**
 * The system the app runs on, as the ping names it, or null where it sends
 * none.
 *
 * Not from `navigator.userAgent`: the desktop window gives a Safari user
 * agent on every system. `userAgentData` says Windows on Windows; the Mac's
 * web view does not have it, so no answer is a Mac (as in main.tsx). A
 * phone build names itself in the user agent; iOS pings, Android does not,
 * since /api/ping takes no Android.
 */
export function usagePingPlatform(
  nav: { userAgent: string; userAgentData?: { platform?: string } } = navigator
): UsagePingPlatform | null {
  const phone = hostOsFromUserAgent(nav.userAgent);
  if (phone) return phone === "ios" ? "ios" : null;
  const platform = nav.userAgentData?.platform?.toLowerCase() ?? "";
  if (platform.startsWith("win")) return "windows";
  if (!platform || platform.startsWith("mac")) return "mac";
  return null;
}

function inDesktopApp(): boolean {
  const w = window as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

/** This build can send the ping: the public desktop app, on a system /api/ping takes. */
export function usagePingAvailable(): boolean {
  return isPublicMailProduct() && inDesktopApp() && usagePingPlatform() !== null;
}

function readState(): PingState {
  try {
    return (JSON.parse(localStorage.getItem(PING_STATE_KEY) || "{}") as PingState) || {};
  } catch {
    return {};
  }
}

function writeState(state: PingState): void {
  try {
    localStorage.setItem(PING_STATE_KEY, JSON.stringify(state));
  } catch {
    /* localStorage may be disabled; we then ping again tomorrow */
  }
}

// crypto.randomUUID needs a secure context, which a custom-scheme webview
// may not count as. getRandomValues has no such rule.
function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* fall through */
    }
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let sentDay: string | null = null;
let inFlight = false;
let started = false;

/**
 * Send today's ping if it is due and allowed. `now` and `platform` are for
 * the suite; the app passes neither.
 */
export async function maybeSendUsagePing(
  options: { now?: Date; platform?: UsagePingPlatform | null } = {}
): Promise<void> {
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  if (sentDay === today || inFlight) return;
  const where = options.platform !== undefined ? options.platform : usagePingPlatform();
  if (!where || !readUsagePingEnabled()) return;

  const stored = readState();
  if (stored.lastDay === today) {
    sentDay = today;
    return;
  }
  const month = today.slice(0, 7);
  const key = stored.month === month && stored.key ? stored.key : randomUuid();
  inFlight = true;
  try {
    const res = await fetch(USAGE_PING_URL, {
      method: "POST",
      // text/plain, so the request goes with no preflight.
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ product: "mail", platform: where, key }),
      credentials: "omit",
    });
    if (!res.ok) return;
    writeState({ month, key, lastDay: today });
    sentDay = today;
  } catch {
    // Offline: the hourly check tries again.
  } finally {
    inFlight = false;
  }
}

/** Ping now, then check hourly and whenever the window comes back. */
export function startUsagePing(): void {
  if (started || !usagePingAvailable()) return;
  started = true;
  void maybeSendUsagePing();
  window.setInterval(() => void maybeSendUsagePing(), PING_CHECK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void maybeSendUsagePing();
  });
}

/** For the suite: forget what this page has sent. */
export function resetUsagePingForTests(): void {
  sentDay = null;
  inFlight = false;
  started = false;
}
