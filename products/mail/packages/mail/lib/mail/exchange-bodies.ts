/**
 * The bodies of the last year of an Exchange (EWS) mailbox, in the
 * background (phase 5, section 14.2 of `docs/mail-exchange-ews.md`).
 *
 * The Gmail worker keeps the bodies of the last year, so search reads whole
 * messages and a thread opens with no wait. For Exchange the same, slowly,
 * so KU's server does not feel it: 10 items in one call, one call at a
 * time, 5 seconds between calls. A busy server stops it until its back-off
 * is over. Rust picks the rows, fetches, and keeps the bodies.
 */

import { exchangeErrorCode, fetchExchangeMissingBodies } from "@/lib/mail/exchange-native";

export const BODY_PAUSE_MS = 5_000;
export const BODY_SINCE_MS = 365 * 24 * 60 * 60 * 1000;
/** After an error that is not a busy server: try again with a later pass. */
const ERROR_WAIT_MS = 10 * 60_000;

type Filler = { running: boolean; waitUntil: number };
const fillers = new Map<string, Filler>();

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How long a busy server said to wait, from its message. */
function busyWait(message: string): number | null {
  if (exchangeErrorCode(message) !== "ews:busy") return null;
  const said = Number(message.match(/after (\d+) ms/)?.[1] ?? NaN);
  return Number.isFinite(said) && said > 0 ? said : 60_000;
}

/**
 * Fill the missing bodies of one mailbox, a batch at a time, until none
 * is left or `stopped()` says so. Does nothing while a fill for the
 * mailbox runs, or while the server asked to wait.
 */
export async function fillExchangeBodies(
  account: string,
  stopped: () => boolean,
  pauseMs = BODY_PAUSE_MS
): Promise<void> {
  const email = account.trim().toLowerCase();
  const filler = fillers.get(email) ?? { running: false, waitUntil: 0 };
  fillers.set(email, filler);
  if (filler.running || Date.now() < filler.waitUntil) return;
  filler.running = true;
  try {
    for (;;) {
      if (stopped()) return;
      const batch = await fetchExchangeMissingBodies(email, Date.now() - BODY_SINCE_MS);
      if (!batch.more) return;
      await wait(pauseMs);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    filler.waitUntil = Date.now() + (busyWait(message) ?? ERROR_WAIT_MS);
    console.warn(`[mail-sync] ${email}: bodies in the background stopped: ${message}`);
  } finally {
    filler.running = false;
  }
}

/** For a suite. */
export function forgetExchangeBodyFill(): void {
  fillers.clear();
}
