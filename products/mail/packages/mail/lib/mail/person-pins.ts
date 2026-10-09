/**
 * Pinned correspondents in the by-person view.
 *
 * Separate from thread pins on purpose. Pinning a person is not pinning their
 * conversations: someone you write to every day has dozens of threads, and
 * pushing all of them into the Pinned band of the thread view would bury the
 * few threads that were pinned deliberately. Unpinning would then take those
 * with it.
 *
 * So this keeps only the row key, and the people list floats those rows to the
 * top. Local to this browser, like thread pins — see `@/lib/mail/pins`, which
 * this deliberately mirrors rather than shares.
 */

export type MailPersonPin = {
  /** The PersonRow key: `person:<email>` or `group:<addresses>`. */
  key: string;
  /** ms since epoch — most recently pinned sorts first. */
  pinnedAt: number;
};

const STORAGE_KEY = "redd-plan-mail-person-pins-v1";

const listeners = new Set<() => void>();

/** Stable snapshot for useSyncExternalStore — must not allocate on every read. */
let cached: MailPersonPin[] | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeMailPersonPins(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function sorted(pins: MailPersonPin[]): MailPersonPin[] {
  return pins.slice().sort((a, b) => b.pinnedAt - a.pinnedAt);
}

function readAll(): MailPersonPin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MailPersonPin[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p) => typeof p?.key === "string" && typeof p?.pinnedAt === "number"
    );
  } catch {
    return [];
  }
}

function writeAll(pins: MailPersonPin[]): void {
  cached = sorted(pins);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    /* quota / private mode */
  }
  notify();
}

export function listMailPersonPins(): MailPersonPin[] {
  if (cached) return cached;
  cached = sorted(readAll());
  return cached;
}

export function isMailPersonPinned(key: string): boolean {
  return listMailPersonPins().some((p) => p.key === key);
}

/** Pin or unpin, and answer whether it is pinned now. */
export function toggleMailPersonPin(key: string): boolean {
  const pins = listMailPersonPins();
  if (pins.some((p) => p.key === key)) {
    writeAll(pins.filter((p) => p.key !== key));
    return false;
  }
  // Strictly above the newest existing pin. Two pins in the same millisecond
  // would otherwise tie, and which one came first would depend on sort
  // stability rather than on what the user did.
  const newest = pins.length ? pins[0].pinnedAt : 0;
  writeAll([...pins, { key, pinnedAt: Math.max(Date.now(), newest + 1) }]);
  return true;
}

/**
 * The order to show rows in: pinned first, newest pin at the top, then the
 * rest as they came.
 *
 * A pinned person with nothing recent still belongs at the top — that is what
 * pinning them was for — so this does not fall back to sorting by time.
 */
export function orderByPersonPin<T extends { key: string }>(rows: T[]): T[] {
  const pins = listMailPersonPins();
  if (!pins.length) return rows;
  const rank = new Map(pins.map((p, index) => [p.key, index]));
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const row of rows) {
    if (rank.has(row.key)) pinned.push(row);
    else rest.push(row);
  }
  pinned.sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
  return [...pinned, ...rest];
}

/**
 * In the people view, the person a pin on the open conversation stands for:
 * the person the reader opened, or else the one whose row holds it.
 *
 * The reader's Pin and the P key pinned the conversation, and a pinned
 * conversation does not move anyone in the people view. So pinning there
 * seemed to do nothing, and the conversation turned up pinned in the other
 * view instead.
 */
export function personOfOpenThread<
  T extends { key: string; threads: { account: string; threadId: string }[] },
>(
  rows: T[],
  openPerson: T | null,
  thread: { account: string; threadId: string }
): T | null {
  if (openPerson) return openPerson;
  const same = (t: { account: string; threadId: string }) =>
    t.threadId === thread.threadId &&
    t.account.toLowerCase() === thread.account.toLowerCase();
  return rows.find((row) => row.threads.some(same)) ?? null;
}
