import { mailStore } from "@/lib/mail/store";
import {
  filterAccountsForScope,
  type MailAccountScope,
} from "@/lib/mail/account-scope";
import { registerInboxListCacheClear } from "@/lib/mail/inbox-cache";
import { listConnectedMailAccounts } from "@/lib/mail/providers";

const SNOOZE_COUNT_TTL_MS = 30_000;
type SnoozeCountCacheEntry = { value: number; expiresAt: number };
const snoozeCountCache = new Map<string, SnoozeCountCacheEntry>();
registerInboxListCacheClear(() => {
  snoozeCountCache.clear();
});

/** How many active snoozes exist for the visible mailboxes (tab badge). */
export async function countActiveSnoozes(options: {
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
}): Promise<number> {
  const scope = options.scope ?? "all";
  const cacheKey = [
    options.clerkUserId,
    scope,
    options.account ?? "all",
  ].join("\0");
  const cached = snoozeCountCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const allAccounts = filterAccountsForScope(
    await listConnectedMailAccounts(options.clerkUserId),
    scope
  );
  const accountEmails = allAccounts
    .map((a) => a.email)
    .filter((email) => !options.account || email === options.account);
  if (!accountEmails.length) {
    snoozeCountCache.set(cacheKey, {
      value: 0,
      expiresAt: Date.now() + SNOOZE_COUNT_TTL_MS,
    });
    return 0;
  }

  const value = await mailStore().snoozes.countActive(accountEmails);
  snoozeCountCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + SNOOZE_COUNT_TTL_MS,
  });
  return value;
}
