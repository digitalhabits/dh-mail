/**
 * Hiding a mailbox from Mail, and showing it again, from wherever it is asked:
 * the eye in Settings → Accounts, and the menus of the account tabs. A hidden
 * mailbox stays connected; it only leaves the tabs and the list.
 */

import { mailApiJson } from "@/lib/mail/api";
import { resolveMailProvider } from "@/lib/mail/providers";
import type { MailProvider } from "@/lib/mail/types";
import { tauriInvoke } from "@/lib/mail/store/tauri";

/** Where a provider's mailboxes are listed and changed. */
export function mailboxAccountsPath(provider: MailProvider): string {
  if (provider === "exchange") return "/api/exchange/accounts";
  return provider === "outlook" ? "/api/outlook/accounts" : "/api/gmail/accounts";
}

/** Show the mailbox in Mail (true) or hide it (false). */
export async function setMailboxInMailTab(email: string, inMailTab: boolean): Promise<void> {
  const provider = await resolveMailProvider(email);
  await mailApiJson(mailboxAccountsPath(provider), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, inMailTab }),
  });
}

type Listed = { accounts?: { email: string; inMailTab: boolean }[] };

/**
 * The connected mailboxes hidden from Mail, in the order the providers list
 * them. A provider that does not answer lists none: the others still count.
 * Exchange is asked in the desktop app only, where it is offered.
 */
export async function listHiddenMailboxes(): Promise<string[]> {
  const providers: MailProvider[] = tauriInvoke() ? ["gmail", "outlook", "exchange"] : ["gmail", "outlook"];
  const lists = await Promise.all(
    providers.map((provider) =>
      mailApiJson<Listed>(mailboxAccountsPath(provider)).catch(() => ({ accounts: [] }) as Listed)
    )
  );
  return lists.flatMap((list) => (list.accounts ?? []).filter((a) => !a.inMailTab).map((a) => a.email));
}
