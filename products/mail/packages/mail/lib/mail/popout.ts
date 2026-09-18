import { loadCachedMailThread } from "@/lib/mail/thread-cache";
import type { MailThreadDetail } from "@/lib/mail/types";
import {
  isNativeShell,
  notifyMailEditAsNew,
  notifyMailForward,
  notifyMailSent,
  openChatPopout,
} from "@/lib/native-shell";

/**
 * Cross-window "a popout sent mail" signal. Browsers get the localStorage
 * `storage` event (fires in every *other* same-origin window); the desktop
 * shells additionally broadcast a Tauri event, since WKWebView is unreliable
 * about cross-window storage events. MailPage listens to both.
 */
export const MAIL_POPOUT_SENT_KEY = "redd-plan-mail-popout-sent";

export function signalPopoutSend(account: string, threadId: string): void {
  try {
    window.localStorage.setItem(
      MAIL_POPOUT_SENT_KEY,
      JSON.stringify({ account, threadId, at: Date.now() })
    );
  } catch {}
  void notifyMailSent({ account, threadId }).catch(() => {});
}

/**
 * Cross-window "forward this message for me" request.
 *
 * The chat popout has no recipient picker and no subject line, so it cannot
 * forward anything itself. It asks the window that can. The same two channels
 * as the sent signal above: localStorage for browsers, a Tauri event for the
 * desktop shells, where cross-window storage events are unreliable.
 */
export const MAIL_FORWARD_REQUEST_KEY = "redd-plan-mail-forward-request";

export type MailForwardRequest = {
  account: string;
  threadId: string;
  messageId: string;
};

export function signalForwardRequest(request: MailForwardRequest): void {
  try {
    window.localStorage.setItem(
      MAIL_FORWARD_REQUEST_KEY,
      JSON.stringify({ ...request, at: Date.now() })
    );
  } catch {}
  void notifyMailForward(request).catch(() => {});
}

/** A request off either channel, or null when it is not one. */
export function readForwardRequest(raw: unknown): MailForwardRequest | null {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return null;
          }
        })()
      : raw;
  if (!value || typeof value !== "object") return null;
  const r = value as Partial<MailForwardRequest>;
  if (!r.account || !r.threadId || !r.messageId) return null;
  return {
    account: r.account,
    threadId: r.threadId,
    messageId: r.messageId,
  };
}

/**
 * A message written elsewhere, for this composer to open.
 *
 * The planner's Facilitators tab writes the joining details for a course,
 * addressed and with a calendar file attached, and hands it to the shell
 * (see notify_mail_compose_seed). The pane hears it as an event, or asks
 * for it on load. Everything here is the message itself; the pane writes
 * the draft and opens the composer on it.
 */
export type MailComposeSeed = {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  attachments: { filename: string; mimeType: string; contentBase64: string }[];
};

function addressList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** A seed off the event or the command, or null when it is not one. */
export function readComposeSeed(raw: unknown): MailComposeSeed | null {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw) as unknown;
          } catch {
            return null;
          }
        })()
      : raw;
  if (!value || typeof value !== "object") return null;
  const seed = value as Record<string, unknown>;
  const subject = typeof seed.subject === "string" ? seed.subject : "";
  const bodyHtml = typeof seed.bodyHtml === "string" ? seed.bodyHtml : "";
  if (!subject.trim() && !bodyHtml.trim()) return null;
  const attachments = Array.isArray(seed.attachments)
    ? seed.attachments
        .filter(
          (a): a is { filename: string; mimeType: string; contentBase64: string } =>
            !!a &&
            typeof a === "object" &&
            typeof (a as { filename?: unknown }).filename === "string" &&
            typeof (a as { contentBase64?: unknown }).contentBase64 === "string"
        )
        .map((a) => ({
          filename: a.filename,
          mimeType: typeof a.mimeType === "string" ? a.mimeType : "application/octet-stream",
          contentBase64: a.contentBase64,
        }))
    : [];
  return {
    to: addressList(seed.to),
    cc: addressList(seed.cc),
    bcc: addressList(seed.bcc),
    subject,
    bodyHtml,
    attachments,
  };
}

/**
 * Cross-window "edit this message as a new one" request.
 *
 * Same reason as a forward: the chat popout has no subject line and no
 * recipient picker, so the window that does is asked. The same two channels.
 */
export const MAIL_EDIT_AS_NEW_REQUEST_KEY =
  "redd-plan-mail-edit-as-new-request";

export type MailEditAsNewRequest = MailForwardRequest;

export function signalEditAsNewRequest(request: MailEditAsNewRequest): void {
  try {
    window.localStorage.setItem(
      MAIL_EDIT_AS_NEW_REQUEST_KEY,
      JSON.stringify({ ...request, at: Date.now() })
    );
  } catch {}
  void notifyMailEditAsNew(request).catch(() => {});
}

export function readEditAsNewRequest(
  raw: unknown
): MailEditAsNewRequest | null {
  return readForwardRequest(raw);
}

export const CHAT_POPOUT_WIDTH = 380;
export const CHAT_POPOUT_EXPANDED_HEIGHT = 560;
/**
 * Folded, the window is the naming strip and nothing more.
 *
 * The Rust side holds this number too — it is the window's minimum, and
 * the resize is clamped to it, so a smaller one asked for here alone would
 * be ignored. See CHAT_POPOUT_COLLAPSED_HEIGHT in popout.rs.
 */
export const CHAT_POPOUT_COLLAPSED_HEIGHT = 56;

/**
 * One-shot handoff of an already-loaded thread to the popout window via
 * localStorage (both windows share the origin), so popping out a thread
 * that's open in the reader paints instantly instead of showing "Loading…".
 * The popout deletes the key after reading and refetches in the background.
 */
const SEED_PREFIX = "redd-plan-chat-popout-seed:";
const SEED_TTL_MS = 60_000;

export function popoutSeedKey(account: string, threadId: string): string {
  return `${SEED_PREFIX}${account}|${threadId}`;
}

type PopoutSeed = {
  at: number;
  thread: MailThreadDetail;
  draft?: string;
  /** Where the caret was in that draft, counted from the start. */
  caret?: number;
};

/** The thread handed over, and the half-written reply handed over with it. */
export function readPopoutSeed(
  account: string,
  threadId: string
): { thread: MailThreadDetail; draft: string; caret: number | null } | null {
  try {
    const key = popoutSeedKey(account, threadId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    window.localStorage.removeItem(key);
    const seed = JSON.parse(raw) as PopoutSeed;
    if (!seed?.thread || Date.now() - seed.at > SEED_TTL_MS) return null;
    return {
      thread: seed.thread,
      draft: seed.draft ?? "",
      caret: seed.caret ?? null,
    };
  } catch {
    return null;
  }
}

/** Drop unread seeds (e.g. the popout was already open and never consumed it). */
function sweepStaleSeeds(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(SEED_PREFIX)) continue;
      try {
        const seed = JSON.parse(
          window.localStorage.getItem(key) ?? ""
        ) as PopoutSeed;
        if (!seed?.at || Date.now() - seed.at > SEED_TTL_MS) stale.push(key);
      } catch {
        stale.push(key);
      }
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {}
}

function writePopoutSeed(
  account: string,
  threadId: string,
  thread: MailThreadDetail,
  draft?: string,
  caret?: number | null
): void {
  sweepStaleSeeds();
  try {
    window.localStorage.setItem(
      popoutSeedKey(account, threadId),
      JSON.stringify({
        at: Date.now(),
        thread,
        ...(draft?.trim() ? { draft } : null),
        ...(draft?.trim() && caret != null ? { caret } : null),
      } satisfies PopoutSeed)
    );
  } catch {
    // Quota (huge inline images) — the popout just fetches instead.
  }
}

/**
 * Pop a thread out into a floating chat window from the mail client.
 * Desktop shells get a real always-on-top Tauri window; browsers get a
 * `window.open` popup (a separate OS window, though not always-on-top —
 * no cross-browser API offers that).
 */
export async function openMailChatPopout(input: {
  account: string;
  threadId: string;
  name: string;
  email: string;
  subject: string;
  /** Already-loaded thread detail (e.g. from the open reader) to hand over. */
  seedThread?: MailThreadDetail;
  /**
   * A reply already being written, as HTML — the same as both boxes hold.
   *
   * The window opens on it, so popping out mid-sentence carries the sentence
   * across instead of leaving it behind in a box the reader has walked away
   * from.
   */
  seedDraft?: string;
  /** Where the caret was in it, so the other box opens in the same place. */
  seedCaret?: number | null;
}): Promise<void> {
  const { seedThread, seedDraft, seedCaret, ...target } = input;
  const seed =
    seedThread ??
    (await loadCachedMailThread(input.account, input.threadId))?.thread;
  if (seed) {
    writePopoutSeed(input.account, input.threadId, seed, seedDraft, seedCaret);
  }
  if (isNativeShell()) {
    await openChatPopout(target);
    notePopoutOpened(input.account, input.threadId);
    return;
  }
  const params = new URLSearchParams({
    account: input.account,
    thread: input.threadId,
    name: input.name,
    email: input.email,
    subject: input.subject,
  });
  // Stable name per thread so re-clicking reuses the window instead of
  // stacking duplicates.
  const windowName = `mail-chat-${input.account}-${input.threadId}`.replace(
    /[^\w-]/g,
    "_"
  );
  const left = Math.max(
    0,
    (window.screen?.availWidth ?? 1440) - CHAT_POPOUT_WIDTH - 24
  );
  const popup = window.open(
    `/mail-popout?${params.toString()}`,
    windowName,
    `popup=yes,width=${CHAT_POPOUT_WIDTH},height=${CHAT_POPOUT_EXPANDED_HEIGHT},left=${left},top=96`
  );
  if (!popup) {
    throw new Error("Popup blocked — allow popups for this site");
  }
  popup.focus();
}

/**
 * Which threads have a chat window open, as far as this window knows.
 *
 * The shell's window list is the truth — see `chat_popout_open` — but the
 * list cannot ask it once per row on every repaint. So the threads this
 * window has popped out are kept here, and each one is checked against
 * the shell when the window comes back to the front. A window the reader
 * closed drops out on that pass; nothing is trusted for longer than it
 * takes to look.
 *
 * Kept in localStorage so a reload does not lose a chat that is still on
 * screen, and shared with the reader's other tabs the same way the sent
 * signal is.
 */
const POPOUT_OPEN_KEY = "redd-plan-mail-popout-open";

export function popoutThreadKey(account: string, threadId: string): string {
  return `${account}|${threadId}`;
}

const popoutListeners = new Set<() => void>();
let popoutKeys: ReadonlySet<string> = new Set();
let popoutSnapshot: ReadonlySet<string> = popoutKeys;

function readStoredPopoutKeys(): Set<string> {
  try {
    const raw = window.localStorage.getItem(POPOUT_OPEN_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

function writePopoutKeys(keys: Set<string>): void {
  try {
    window.localStorage.setItem(POPOUT_OPEN_KEY, JSON.stringify([...keys]));
  } catch {}
  popoutKeys = keys;
  // A new object every time, so `useSyncExternalStore` sees the change —
  // but only when the set actually differs, or the list would repaint on
  // every check the focus makes.
  popoutSnapshot = keys;
  for (const listener of popoutListeners) listener();
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/** Note that this thread now has a chat window. */
export function notePopoutOpened(account: string, threadId: string): void {
  const next = new Set(popoutKeys);
  next.add(popoutThreadKey(account, threadId));
  if (!sameKeys(next, popoutKeys)) writePopoutKeys(next);
}

/** Replace the set with what the shell says is actually open. */
export function setOpenPopoutKeys(keys: Set<string>): void {
  if (sameKeys(keys, popoutKeys)) return;
  writePopoutKeys(keys);
}

/**
 * The keys to check against the shell — what we last believed.
 *
 * From memory, not from storage. Storage is where this survives a reload,
 * and it can refuse a write (a private window, a full quota) without
 * saying so; reading it back as the truth then left the set that decides
 * what the list draws disagreeing with the set that decides what is
 * checked, and only on the machines where storage was unavailable.
 */
export function believedPopoutKeys(): string[] {
  return [...popoutKeys];
}

export function subscribeMailPopouts(listener: () => void): () => void {
  popoutListeners.add(listener);
  return () => {
    popoutListeners.delete(listener);
  };
}

export function getPopoutKeysSnapshot(): ReadonlySet<string> {
  return popoutSnapshot;
}

/** Server render, and a host with no storage: nothing is popped out. */
const NO_POPOUTS: ReadonlySet<string> = new Set();
export function getPopoutKeysServerSnapshot(): ReadonlySet<string> {
  return NO_POPOUTS;
}

if (typeof window !== "undefined") {
  popoutKeys = readStoredPopoutKeys();
  popoutSnapshot = popoutKeys;
  // Another window of the same reader popped one out, or closed one.
  window.addEventListener("storage", (event) => {
    if (event.key !== POPOUT_OPEN_KEY) return;
    const next = readStoredPopoutKeys();
    if (!sameKeys(next, popoutKeys)) {
      popoutKeys = next;
      popoutSnapshot = next;
      for (const listener of popoutListeners) listener();
    }
  });
}
