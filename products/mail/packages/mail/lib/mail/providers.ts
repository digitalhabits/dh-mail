import "server-only";

import {
  getCachedConnectedMailAccounts,
  getCachedMailProvider,
  invalidateConnectedMailAccountsCache,
  setCachedConnectedMailAccounts,
  setCachedMailProvider,
  type ConnectedMailAccount,
} from "@/lib/mail/connected-accounts-cache";
import {
  hasGmailAccount,
  listGmailAccounts,
  type GmailAccount,
} from "@/lib/gmail/accounts";
import {
  hasOutlookAccount,
  listOutlookAccounts,
  type OutlookAccount,
} from "@/lib/outlook/accounts";
import { normalizeEmail } from "@/lib/own-addresses";
import { PlanError } from "@/lib/plan/errors";
import type { MailProvider } from "@/lib/mail/types";

export type { MailProvider };

export type { ConnectedMailAccount };
export { invalidateConnectedMailAccountsCache };

/**
 * Mailboxes the signed-in user connected (Mail UI / inbox / folders).
 * CRM sync continues to call listGmailAccounts() without a user filter.
 */
export async function listConnectedMailAccounts(
  clerkUserId: string
): Promise<ConnectedMailAccount[]> {
  const cached = getCachedConnectedMailAccounts(clerkUserId);
  if (cached) return cached;

  const [gmail, outlook] = await Promise.all([
    listGmailAccounts({ clerkUserId }),
    listOutlookAccounts({ clerkUserId }),
  ]);
  const out: ConnectedMailAccount[] = [
    ...gmail.map((a: GmailAccount) => ({
      email: a.email,
      provider: "gmail" as const,
      inMailTab: a.inMailTab,
      clerkUserId: a.clerkUserId,
    })),
    ...outlook.map((a: OutlookAccount) => ({
      email: a.email,
      provider: "outlook" as const,
      inMailTab: a.inMailTab,
      clerkUserId: a.clerkUserId,
    })),
  ];
  out.sort((a, b) => a.email.localeCompare(b.email));
  setCachedConnectedMailAccounts(clerkUserId, out);
  return out;
}

/** True when this local owner owns the connected mailbox row. */
export async function userOwnsMailAccount(
  email: string,
  clerkUserId: string
): Promise<boolean> {
  const key = normalizeEmail(email);
  const accounts = await listConnectedMailAccounts(clerkUserId);
  return accounts.some((a) => normalizeEmail(a.email) === key);
}

export async function assertUserOwnsMailAccount(
  email: string,
  clerkUserId: string
): Promise<void> {
  if (!(await userOwnsMailAccount(email, clerkUserId))) {
    throw new PlanError("Mail account not found", 404);
  }
}

/**
 * Which provider holds this mailbox.
 *
 * Asked by every operation that takes a bare account email. The answer is
 * remembered for a short while, so a click costs one store lookup and not
 * one per step. The account modules clear it when a mailbox is connected
 * or removed.
 *
 * A mailbox nobody connected is an error, not Gmail. It used to fall
 * through to Gmail, and the failure then surfaced a few calls later as a
 * missing Gmail token — which read as a Gmail problem on a mailbox that
 * was never Gmail.
 */
export async function resolveMailProvider(
  email: string
): Promise<MailProvider> {
  const key = normalizeEmail(email);
  const cached = getCachedMailProvider(key);
  if (cached) return cached;
  /*
    Asked as the address is written, and again as it is spelled out.

    `normalizeEmail` drops the dots from a Gmail local part, because
    `vera.holm@` and `veraholm@` are one mailbox to Google. That is
    right for telling two addresses apart, and wrong for finding a row:
    the account is stored exactly as it was connected — with the dots —
    so the tidied spelling matched nothing, and every operation on that
    mailbox failed with "No connected mailbox" while the mailbox sat in
    the list and its threads sat under it.

    So the address itself is tried first, since that is the form a row is
    keyed by, and the tidied one after it, which finds a mailbox connected
    under the tidier spelling.

    The other way about — asked without the dots for a mailbox connected
    with them — is not answered here, and cannot be by an exact lookup: it
    would take a scan of every connected mailbox comparing both sides
    tidied, and this is asked before every operation on a mailbox. Nothing
    asks that way, because callers pass the address as the account was
    stored. If something ever does, this is the place, and the scan is
    what it needs.
  */
  const asWritten = email.trim().toLowerCase();
  const spellings = asWritten === key ? [asWritten] : [asWritten, key];
  let provider: MailProvider | null = null;
  for (const spelling of spellings) {
    if (await hasOutlookAccount(spelling)) {
      provider = "outlook";
      break;
    }
    if (await hasGmailAccount(spelling)) {
      provider = "gmail";
      break;
    }
  }
  if (!provider) {
    throw new PlanError(`No connected mailbox for ${email}`, 404);
  }
  setCachedMailProvider(key, provider);
  return provider;
}
