/**
 * Per-account thread pins for the Mail tab.
 *
 * Pins are local (this browser): keyed by account + threadId, ordered by
 * pinnedAt (newest first). We keep a summary snapshot so a pin can stay in
 * the Pinned band after the thread is archived out of the inbox list.
 */

import type { MailThreadSummary } from "@/lib/mail/types";

export type MailPinRecord = {
  account: string;
  threadId: string;
  /** ms since epoch — most recently pinned sorts first. */
  pinnedAt: number;
  summary: MailThreadSummary;
};

const STORAGE_KEY = "redd-plan-mail-pins-v1";

const listeners = new Set<() => void>();

/** Stable snapshot for useSyncExternalStore — must not allocate on every read. */
let cachedPins: MailPinRecord[] | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeMailPins(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function readAll(): MailPinRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MailPinRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sorted(pins: MailPinRecord[]): MailPinRecord[] {
  return pins.slice().sort((a, b) => b.pinnedAt - a.pinnedAt);
}

function writeAll(pins: MailPinRecord[]): void {
  cachedPins = sorted(pins);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    /* quota / private mode */
  }
  notify();
}

export function listMailPins(): MailPinRecord[] {
  if (cachedPins) return cachedPins;
  cachedPins = sorted(readAll());
  return cachedPins;
}

export function isMailPinned(account: string, threadId: string): boolean {
  return listMailPins().some(
    (p) => p.account === account && p.threadId === threadId
  );
}

export function pinMailThread(summary: MailThreadSummary): void {
  const pins = readAll().filter(
    (p) =>
      !(p.account === summary.account && p.threadId === summary.threadId)
  );
  pins.push({
    account: summary.account,
    threadId: summary.threadId,
    pinnedAt: Date.now(),
    summary,
  });
  writeAll(pins);
}

export function unpinMailThread(account: string, threadId: string): void {
  writeAll(
    readAll().filter(
      (p) => !(p.account === account && p.threadId === threadId)
    )
  );
}

export function toggleMailPin(summary: MailThreadSummary): boolean {
  if (isMailPinned(summary.account, summary.threadId)) {
    unpinMailThread(summary.account, summary.threadId);
    return false;
  }
  pinMailThread(summary);
  return true;
}

/** Refresh stored summaries when the inbox fetch returns fresher rows. */
export function syncMailPinSummaries(threads: MailThreadSummary[]): void {
  const byKey = new Map(
    threads.map((t) => [`${t.account}|${t.threadId}`, t] as const)
  );
  let changed = false;
  const next = readAll().map((pin) => {
    const fresh = byKey.get(`${pin.account}|${pin.threadId}`);
    if (!fresh) return pin;
    if (
      fresh.lastAt === pin.summary.lastAt &&
      fresh.unread === pin.summary.unread &&
      fresh.snippet === pin.summary.snippet &&
      fresh.subject === pin.summary.subject
    ) {
      return pin;
    }
    changed = true;
    return { ...pin, summary: fresh };
  });
  if (changed) writeAll(next);
}
