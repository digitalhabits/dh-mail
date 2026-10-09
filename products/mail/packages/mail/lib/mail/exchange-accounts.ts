/**
 * Connected Exchange (EWS) mailboxes.
 *
 * The same shape as `@/lib/outlook/accounts`, for the account list and the
 * settings panel. There is no token here: the password is in the keychain,
 * and only the Rust EWS code reads it. A new account comes from the connect
 * form (`connectExchange` in `exchange-native.ts`), which writes the row
 * after a good sign-in.
 *
 * In both builds (section 18, item 5 of `docs/mail-exchange-ews.md`). The
 * server store has none.
 */

import { mailStore } from "@/lib/mail/store";
import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { PlanError } from "@/lib/plan/errors";

import type { MailAccountRecord } from "@/lib/mail/store/types";

export type ExchangeAccount = {
  email: string;
  clerkUserId: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  inMailTab: boolean;
  ewsUrl: string | null;
  ewsUsername: string | null;
};

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function toAccount(record: MailAccountRecord): ExchangeAccount {
  return {
    email: record.email,
    clerkUserId: record.ownerId,
    lastSyncedAt: record.lastSyncedAt,
    lastSyncError: record.lastSyncError,
    inMailTab: record.inMailTab,
    ewsUrl: record.ewsUrl ?? null,
    ewsUsername: record.ewsUsername ?? null,
  };
}

/** Exchange accounts, for one owner or for all. */
export async function listExchangeAccounts(options?: { clerkUserId?: string }): Promise<ExchangeAccount[]> {
  const userId = options?.clerkUserId;
  const records = userId
    ? await mailStore().accounts.listForOwner("exchange", userId)
    : await mailStore().accounts.listAll("exchange");
  return records.map(toAccount);
}

/** True when this address is a connected Exchange account. */
export async function hasExchangeAccount(email: string): Promise<boolean> {
  return mailStore().accounts.exists("exchange", normalize(email));
}

export async function setExchangeAccountInMailTab(email: string, inMailTab: boolean, clerkUserId: string): Promise<void> {
  const updated = await mailStore().accounts.setInMailTab("exchange", clerkUserId, normalize(email), inMailTab);
  if (!updated) throw new PlanError("Exchange account not found", 404);
  invalidateConnectedMailAccountsCache(clerkUserId);
}

export async function reorderExchangeAccounts(emails: string[], clerkUserId: string): Promise<void> {
  const normalized = emails.map(normalize);
  const owned = await mailStore().accounts.listOwnedEmails("exchange", clerkUserId, normalized);
  if (owned.length !== normalized.length) throw new PlanError("Exchange account not found", 404);
  await mailStore().accounts.setSortOrder("exchange", clerkUserId, normalized);
  invalidateConnectedMailAccountsCache(clerkUserId);
}

/**
 * Remove the account row. When the last row for the address goes, the
 * store removes the password through the EWS code (account_exchange.rs).
 */
export async function deleteExchangeAccount(email: string, clerkUserId: string): Promise<boolean> {
  const removed = await mailStore().accounts.remove("exchange", clerkUserId, normalize(email));
  if (removed) invalidateConnectedMailAccountsCache(clerkUserId);
  return removed;
}
