export type ConnectedMailAccount = {
  email: string;
  provider: MailProvider;
  inMailTab: boolean;
  clerkUserId: string;
};

const TTL_MS = 30_000;

/** Per local owner — Mail UI must not share another user's mailbox list. */
const cacheByUser = new Map<
  string,
  { at: number; value: ConnectedMailAccount[] }
>();

export function getCachedConnectedMailAccounts(
  clerkUserId: string
): ConnectedMailAccount[] | null {
  const cache = cacheByUser.get(clerkUserId);
  if (!cache) return null;
  if (Date.now() - cache.at >= TTL_MS) {
    cacheByUser.delete(clerkUserId);
    return null;
  }
  return cache.value;
}

export function setCachedConnectedMailAccounts(
  clerkUserId: string,
  value: ConnectedMailAccount[]
): void {
  cacheByUser.set(clerkUserId, { at: Date.now(), value });
}

/**
 * Which provider a mailbox belongs to, by lowercase email.
 *
 * Keyed by mailbox and not by owner: the answer is the same whoever asks.
 * Cleared with the account list, because the same events change both.
 */

import type { MailProvider } from "@/lib/mail/types";

const providerByEmail = new Map<
  string,
  { at: number; value: ConnectedMailAccount["provider"] }
>();

export function getCachedMailProvider(
  email: string
): ConnectedMailAccount["provider"] | null {
  const cache = providerByEmail.get(email);
  if (!cache) return null;
  if (Date.now() - cache.at >= TTL_MS) {
    providerByEmail.delete(email);
    return null;
  }
  return cache.value;
}

export function setCachedMailProvider(
  email: string,
  value: ConnectedMailAccount["provider"]
): void {
  providerByEmail.set(email, { at: Date.now(), value });
}

export function invalidateConnectedMailAccountsCache(
  clerkUserId?: string
): void {
  providerByEmail.clear();
  if (clerkUserId) {
    cacheByUser.delete(clerkUserId);
    return;
  }
  cacheByUser.clear();
}
