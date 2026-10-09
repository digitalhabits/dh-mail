/**
 * Which mailboxes have stopped working, and why.
 *
 * A refresh token does not last forever. An unverified Google app in testing
 * expires them after seven days, a Microsoft one rotates on every refresh, and
 * a user can revoke access at any time. When that happens every request fails,
 * and without this the app just looks broken.
 *
 * Asking for an access token is the test: the core already tells the two cases
 * apart, and only says a mailbox needs reconnecting when the provider refused
 * the grant rather than when the network was down.
 */

import { accessTokenFor } from "@/lib/mail/inbox";
import { outlookAccessTokenFor } from "@/lib/mail/outlook-inbox";
import { exchangeReady } from "@/lib/mail/exchange-native";
import type { MailStoreProvider } from "@/lib/mail/store/types";

/** A connected mailbox, and who it belongs to. */
export type MailboxRef = {
  email: string;
  provider: MailStoreProvider;
  /** Shown in the mail list. A hidden mailbox stays connected and syncing. */
  inMailTab: boolean;
};

/** A mailbox that cannot reach its provider, with the reason to show. */
export type MailboxProblem = {
  email: string;
  provider: MailStoreProvider;
  reason: string;
  /** True when only the user can fix it, by signing in again. */
  needsReconnect: boolean;
};

/**
 * Both providers mark a refused grant this way. Anything else is temporary, and
 * telling a user to reconnect over a dropped network would be wrong.
 */
function isRefusedGrant(message: string): boolean {
  return /invalid_grant|needs reconnect|expired or revoked/i.test(message);
}

/**
 * One mailbox's sign-in, without reading mail. An Exchange mailbox has no
 * token to refresh: its password is in the keychain, and that is the test.
 * Never a Gmail or Graph call for it.
 */
async function checkMailbox(mailbox: MailboxRef): Promise<void> {
  if (mailbox.provider === "exchange") {
    if (!(await exchangeReady(mailbox.email))) {
      throw new Error(`needs reconnect: the Exchange password for ${mailbox.email} is missing or was refused.`);
    }
    return;
  }
  await (mailbox.provider === "outlook" ? outlookAccessTokenFor(mailbox.email) : accessTokenFor(mailbox.email));
}

export async function findMailboxProblems(
  mailboxes: MailboxRef[]
): Promise<MailboxProblem[]> {
  const problems: MailboxProblem[] = [];
  for (const mailbox of mailboxes) {
    try {
      await checkMailbox(mailbox);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      problems.push({
        email: mailbox.email,
        provider: mailbox.provider,
        reason,
        needsReconnect: isRefusedGrant(reason),
      });
    }
  }
  return problems;
}
