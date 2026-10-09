/**
 * Connected Outlook mailboxes.
 *
 * The rules live here: email normalization, the not-found errors, and the
 * cache invalidation. The store moves the data. See `@/lib/mail/store/types`.
 */

import { mailStore } from "@/lib/mail/store";
import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { PlanError } from "@/lib/plan/errors";

import type { MailAccountRecord } from "@/lib/mail/store/types";

export type OutlookAccount = {
  email: string;
  clerkUserId: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  inMailTab: boolean;
};

/** Mailbox addresses are case-insensitive, and the store expects one form. */
function normalize(email: string): string {
  return email.toLowerCase();
}

function toAccount(record: MailAccountRecord): OutlookAccount {
  return {
    email: record.email,
    clerkUserId: record.ownerId,
    lastSyncedAt: record.lastSyncedAt,
    lastSyncError: record.lastSyncError,
    inMailTab: record.inMailTab,
  };
}

/**
 * List Outlook accounts. Pass `clerkUserId` for the signed-in user's Mail UI;
 * omit it for org-wide reads (one row per mailbox even when several owners
 * connected the same address).
 */
export async function listOutlookAccounts(options?: {
  clerkUserId?: string;
}): Promise<OutlookAccount[]> {
  const userId = options?.clerkUserId;
  const records = userId
    ? await mailStore().accounts.listForOwner("outlook", userId)
    : await mailStore().accounts.listAll("outlook");
  return records.map(toAccount);
}

export async function assertOutlookAccountOwner(
  email: string,
  clerkUserId: string
): Promise<void> {
  const owned = await mailStore().accounts.listOwnedEmails(
    "outlook",
    clerkUserId,
    [normalize(email)]
  );
  if (!owned.length) {
    throw new PlanError("Outlook account not found", 404);
  }
}

export async function setOutlookAccountInMailTab(
  email: string,
  inMailTab: boolean,
  clerkUserId: string
): Promise<void> {
  const updated = await mailStore().accounts.setInMailTab(
    "outlook",
    clerkUserId,
    normalize(email),
    inMailTab
  );
  if (!updated) {
    throw new PlanError("Outlook account not found", 404);
  }
  invalidateConnectedMailAccountsCache(clerkUserId);
}

export async function reorderOutlookAccounts(
  emails: string[],
  clerkUserId: string
): Promise<void> {
  const normalized = emails.map(normalize);
  const owned = await mailStore().accounts.listOwnedEmails(
    "outlook",
    clerkUserId,
    normalized
  );
  if (owned.length !== normalized.length) {
    throw new PlanError("Outlook account not found", 404);
  }
  await mailStore().accounts.setSortOrder("outlook", clerkUserId, normalized);
  invalidateConnectedMailAccountsCache(clerkUserId);
}

export async function upsertOutlookAccount(input: {
  email: string;
  refreshToken: string;
  clerkUserId: string;
}): Promise<void> {
  await mailStore().accounts.save("outlook", {
    email: normalize(input.email),
    ownerId: input.clerkUserId,
    refreshToken: input.refreshToken,
  });
  invalidateConnectedMailAccountsCache(input.clerkUserId);
}

export async function deleteOutlookAccount(
  email: string,
  clerkUserId: string
): Promise<boolean> {
  const removed = await mailStore().accounts.remove(
    "outlook",
    clerkUserId,
    normalize(email)
  );
  if (removed) {
    invalidateConnectedMailAccountsCache(clerkUserId);
  }
  return removed;
}

/**
 * Refresh token for a mailbox, plus the owner row it came from. Any owner's
 * grant reaches the same mailbox; the owner is returned so a rotated token can
 * be written back to the row whose grant chain produced it.
 */
export async function getOutlookRefreshToken(
  email: string
): Promise<{ refreshToken: string; clerkUserId: string }> {
  const stored = await mailStore().accounts.getToken(
    "outlook",
    normalize(email)
  );
  if (!stored) throw new Error(`No Outlook account stored for ${email}`);
  return { refreshToken: stored.refreshToken, clerkUserId: stored.ownerId };
}

/** Microsoft sometimes rotates refresh tokens; persist the new one when present. */
export async function updateOutlookRefreshToken(
  email: string,
  clerkUserId: string,
  refreshToken: string
): Promise<void> {
  await mailStore().accounts.replaceToken(
    "outlook",
    normalize(email),
    clerkUserId,
    refreshToken
  );
}

export async function hasOutlookAccount(email: string): Promise<boolean> {
  return mailStore().accounts.exists("outlook", normalize(email));
}
