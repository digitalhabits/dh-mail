/**
 * Connected Gmail mailboxes.
 *
 * The rules live here: email normalization, the not-found errors, and the
 * cache invalidation. The store moves the data. See `@/lib/mail/store/types`.
 */

import { mailStore } from "@/lib/mail/store";
import { invalidateConnectedMailAccountsCache } from "@/lib/mail/connected-accounts-cache";
import { PlanError } from "@/lib/plan/errors";

import type { MailAccountRecord, MailStoredToken } from "@/lib/mail/store/types";

export type GmailAccount = {
  email: string;
  clerkUserId: string;
  historyId: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** Shown in the unified Mail tab; CRM sync uses the account regardless. */
  inMailTab: boolean;
  /** What Google said it granted, space-separated. Null until recorded. */
  grantedScopes: string | null;
};

/** Mailbox addresses are case-insensitive, and the store expects one form. */
function normalize(email: string): string {
  return email.toLowerCase();
}

function toAccount(record: MailAccountRecord): GmailAccount {
  return {
    email: record.email,
    clerkUserId: record.ownerId,
    historyId: record.historyId,
    lastSyncedAt: record.lastSyncedAt,
    lastSyncError: record.lastSyncError,
    inMailTab: record.inMailTab,
    grantedScopes: record.grantedScopes ?? null,
  };
}

/**
 * List Gmail accounts. Pass `clerkUserId` for the signed-in user's Mail UI;
 * omit it for org-wide CRM sync (every connected mailbox). Several owners may
 * connect the same mailbox, so the org-wide list collapses to one row per
 * email, preferring a row that already has a sync checkpoint.
 */
export async function listGmailAccounts(options?: {
  clerkUserId?: string;
}): Promise<GmailAccount[]> {
  const userId = options?.clerkUserId;
  const records = userId
    ? await mailStore().accounts.listForOwner("gmail", userId)
    : await mailStore().accounts.listAll("gmail");
  return records.map(toAccount);
}

/**
 * Which of these mailboxes this person connected themselves.
 *
 * The org-wide list holds one row per mailbox, chosen for its sync
 * checkpoint rather than for who owns it — so the row a reader sees is
 * often somebody else's even when they connected the mailbox too. Asking
 * the rows directly is the only way to answer "may I disconnect this".
 */
export async function listOwnedGmailEmails(
  clerkUserId: string,
  emails: string[]
): Promise<string[]> {
  return mailStore().accounts.listOwnedEmails(
    "gmail",
    clerkUserId,
    emails.map(normalize)
  );
}

export async function assertGmailAccountOwner(
  email: string,
  clerkUserId: string
): Promise<void> {
  const owned = await mailStore().accounts.listOwnedEmails(
    "gmail",
    clerkUserId,
    [normalize(email)]
  );
  if (!owned.length) {
    throw new PlanError("Gmail account not found", 404);
  }
}

/** Show/hide a mailbox in the Mail tab without disconnecting it. */
export async function setAccountInMailTab(
  email: string,
  inMailTab: boolean,
  clerkUserId: string
): Promise<void> {
  const updated = await mailStore().accounts.setInMailTab(
    "gmail",
    clerkUserId,
    normalize(email),
    inMailTab
  );
  if (!updated) {
    throw new PlanError("Gmail account not found", 404);
  }
  invalidateConnectedMailAccountsCache(clerkUserId);
}

/** Persists a user-defined mailbox order (index in the array = sort position). */
export async function reorderGmailAccounts(
  emails: string[],
  clerkUserId: string
): Promise<void> {
  const normalized = emails.map(normalize);
  const owned = await mailStore().accounts.listOwnedEmails(
    "gmail",
    clerkUserId,
    normalized
  );
  if (owned.length !== normalized.length) {
    throw new PlanError("Gmail account not found", 404);
  }
  await mailStore().accounts.setSortOrder("gmail", clerkUserId, normalized);
  invalidateConnectedMailAccountsCache(clerkUserId);
}

export async function upsertGmailAccount(input: {
  email: string;
  refreshToken: string;
  clerkUserId: string;
  grantedScopes?: string | null;
}): Promise<void> {
  await mailStore().accounts.save("gmail", {
    email: normalize(input.email),
    ownerId: input.clerkUserId,
    refreshToken: input.refreshToken,
    grantedScopes: input.grantedScopes ?? null,
  });
  invalidateConnectedMailAccountsCache(input.clerkUserId);
}

/**
 * Keep what Google reported on a refresh, on the row the token came from.
 *
 * Rows connected before the grant was recorded fill in this way, one refresh
 * each, without anyone reconnecting. Skipped where the store does not keep
 * it.
 */
export async function recordGrantedScopes(
  email: string,
  ownerId: string,
  grantedScopes: string
): Promise<void> {
  const store = mailStore().accounts;
  if (!store.setGrantedScopes) return;
  await store.setGrantedScopes("gmail", normalize(email), ownerId, grantedScopes);
}

export async function deleteGmailAccount(
  email: string,
  clerkUserId: string
): Promise<boolean> {
  const removed = await mailStore().accounts.remove(
    "gmail",
    clerkUserId,
    normalize(email)
  );
  if (removed) {
    invalidateConnectedMailAccountsCache(clerkUserId);
  }
  return removed;
}

/**
 * Refresh token for a mailbox. Any owner's grant reaches the same Gmail data,
 * so this picks the freshest row; per-user authorization is enforced at the
 * route layer before mailbox calls.
 */
export async function getAccountRefreshToken(email: string): Promise<string> {
  return (await getAccountStoredToken(email)).refreshToken;
}

/** The freshest token for a mailbox, with the owner whose row holds it. */
export async function getAccountStoredToken(email: string): Promise<MailStoredToken> {
  const stored = await mailStore().accounts.getToken("gmail", normalize(email));
  if (!stored) throw new Error(`No Gmail account stored for ${email}`);
  return stored;
}

export async function hasGmailAccount(email: string): Promise<boolean> {
  return mailStore().accounts.exists("gmail", normalize(email));
}

/**
 * `historyId` is mailbox-global Gmail state, so this intentionally updates
 * every owner's row for the address to keep their checkpoints in step.
 */
export async function updateAccountSyncState(
  email: string,
  update: { historyId?: string | null; error?: string | null }
): Promise<void> {
  await mailStore().accounts.setSyncState("gmail", normalize(email), update);
}
