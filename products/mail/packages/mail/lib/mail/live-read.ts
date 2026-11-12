/**
 * How far a read of a mailbox's inbox reached: the cut-off of the pause
 * that may follow (lib/mail/pause-cut-off.ts).
 *
 * A list read from the copy holds the mail the copy had, not the mail the
 * server had. The time of the read was used as the cut-off, and that was
 * too late for a copy that was behind (offline before the pause, or
 * between two passes of its worker): mail that came before that time and
 * was stored after it was not in the list, but a search and the open
 * conversation showed it during the pause.
 *
 * So for a mailbox read from the copy, the read reached the copy's newest
 * mail and no further. Every stored message is before that moment, so
 * nothing the list showed is held back. A mailbox the provider answered
 * was read at the time the read began.
 */

import "server-only";

import { localStoreComplete, localStoreServes } from "@/lib/mail/local-store";
import { mailStore } from "@/lib/mail/store";

/** The moment (ms) a read of this mailbox, begun at `readAt`, reached. */
export async function readUpTo(account: string, provider: string, readAt: number): Promise<number> {
  try {
    // An Outlook copy still filling: Graph answers its list (inbox-list.ts).
    const fromCopy =
      provider === "outlook" ? await localStoreComplete(account) : await localStoreServes(account);
    if (!fromCopy) return readAt;
    const page = await mailStore().messages.list({ accounts: [account], view: "all", limit: 1 });
    const newest = page.threads[0]?.lastAt;
    if (typeof newest !== "number" || !Number.isFinite(newest)) return readAt;
    // One past the newest: the cut-off shows what is before it.
    return Math.min(readAt, newest + 1);
  } catch {
    return readAt;
  }
}

/** The same for each of these mailboxes, by address. */
export async function readsUpTo(
  accounts: readonly string[],
  providerOf: (account: string) => string,
  readAt: number
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(
    accounts.map(async (account) => {
      out[account] = await readUpTo(account, providerOf(account), readAt);
    })
  );
  return out;
}
