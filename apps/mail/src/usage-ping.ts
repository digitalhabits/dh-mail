/**
 * Anonymous usage count of the standalone Mail app, so we know roughly how
 * many people use it. No other host imports this file.
 *
 * At most once per UTC day the app sends { product, platform, key } to the
 * Digital Habits server's /api/ping, on the first of: the main window is showing when the
 * app starts, the user brings it to the front, or the user accepts the
 * welcome screen. A window left open sends nothing more; the hourly timer
 * only retries a day whose send failed. main.tsx starts this in the main
 * window only, so reader and popout windows never count.
 *
 * Only a release build sends it: the Build workflow and
 * scripts/build-win-store.ps1 set VITE_MAIL_RELEASE, which is also the
 * platform sent. Never in the team's build, never before the welcome screen
 * is accepted, nor when the user turned it off in Settings > General ("Send
 * anonymous usage count"). The key is a random id replaced each calendar
 * month, so two months of one install cannot be joined. Nothing about mail,
 * mailboxes, contacts or accounts is sent. SECURITY.md lists it.
 */
import { isPublicMailProduct } from "@/lib/mail/product-flavor";
import { readUsagePingEnabled, USAGE_PING_URL } from "@/lib/mail/usage-ping";

import { EULA_ACCEPTED_EVENT, eulaAccepted } from "./eula";

// The same key as before, so an install keeps its key for this month.
const PING_STATE_KEY = "mail_usage_ping";
const PING_RETRY_MS = 60 * 60_000;

type Release = "mac" | "windows";
type PingState = { month?: string; key?: string; lastDay?: string };
type TauriWindow = {
  isVisible(): Promise<boolean>;
  onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<unknown>;
};
type PingWindow = {
  __TAURI__?: { window?: { getCurrentWindow?: () => TauriWindow } };
  /** Set in a release build; Settings shows the switch only then. */
  __MAIL_USAGE_PING__?: Release;
};

let release: Release | null = null;
let sentDay: string | null = null;
let triedDay: string | null = null;
let inFlight = false;

const utcToday = () => new Date().toISOString().slice(0, 10);

function readState(): PingState {
  try {
    return (JSON.parse(localStorage.getItem(PING_STATE_KEY) || "{}") as PingState) || {};
  } catch {
    return {};
  }
}

function writeState(state: PingState): boolean {
  try {
    localStorage.setItem(PING_STATE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
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

/** Send today's count, unless it went already or is not allowed. */
async function maybeSendUsagePing(): Promise<void> {
  const today = utcToday();
  if (!release || sentDay === today || inFlight) return;
  if (!eulaAccepted() || !readUsagePingEnabled()) return;

  const stored = readState();
  if (stored.lastDay === today) {
    sentDay = today;
    return;
  }
  const month = today.slice(0, 7);
  const key = stored.month === month && stored.key ? stored.key : randomUuid();
  // Keep the key before sending, so a retry after a lost reply reuses it.
  // An install that cannot keep its key is not counted, not counted twice.
  if (!writeState({ month, key }) || readState().key !== key) return;
  triedDay = today;
  inFlight = true;
  try {
    const res = await fetch(USAGE_PING_URL, {
      method: "POST",
      // text/plain, so the request goes with no preflight.
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ product: "mail", platform: release, key }),
      credentials: "omit",
    });
    if (!res.ok) return;
    writeState({ month, key, lastDay: today });
    sentDay = today;
  } catch {
    // Offline: the hourly retry tries again.
  } finally {
    inFlight = false;
  }
}

/**
 * Count the day when the main window shows at start or comes to the front,
 * or the welcome screen is accepted; retry a failed send hourly. `build` is
 * VITE_MAIL_RELEASE of a production build (main.tsx), else undefined.
 */
export function startUsagePing(build: string | undefined): void {
  if (release || (build !== "mac" && build !== "windows")) return;
  // The team's build is never counted, whatever it was built with.
  if (!isPublicMailProduct()) return;
  release = build;
  const w = window as unknown as PingWindow;
  w.__MAIL_USAGE_PING__ = build;
  const win = w.__TAURI__?.window?.getCurrentWindow?.();
  win?.isVisible().then((shown) => { if (shown) void maybeSendUsagePing(); }, () => {});
  win?.onFocusChanged(({ payload: focused }) => { if (focused) void maybeSendUsagePing(); }).catch(() => {});
  window.addEventListener(EULA_ACCEPTED_EVENT, () => void maybeSendUsagePing());
  window.setInterval(() => { if (triedDay === utcToday()) void maybeSendUsagePing(); }, PING_RETRY_MS);
}

/** For the suite: forget what this page has started and sent. */
export function resetUsagePingForTests(): void {
  release = null;
  sentDay = null;
  triedDay = null;
  inFlight = false;
}
