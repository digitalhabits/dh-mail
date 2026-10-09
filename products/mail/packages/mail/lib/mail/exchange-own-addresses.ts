/**
 * The other addresses of an Exchange mailbox, so mail from them is ours.
 *
 * An Exchange mailbox signs in as one address and sends as another: on KU,
 * `abc123@uni.example` sends as `kim.example@dept.uni.example`. Mail counted
 * as the reader's only when it came
 * from a connected address, so a reply sent from the other address read as
 * somebody else's: on the left of the thread, new in the inbox, and pulling
 * an archived thread back (a tester on a university Exchange, 2026-10-05).
 *
 * The directory knows every address a mailbox has (`mail_ews_own_addresses`
 * in mail-native, ews_directory.rs). It is asked once a launch for each
 * Exchange mailbox, and the answer is kept, so the addresses count while the
 * server cannot be reached. A failed ask keeps the last answer.
 */

import { invoke } from "@/lib/mail/exchange-native";
import { mailStore } from "@/lib/mail/store";

const KEY = "mail_exchange_own_addresses";

type Stored = Record<string, string[]>;

async function read(): Promise<Stored> {
  try {
    const raw = await mailStore().settings.get(KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : {};
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Stored) : {};
  } catch {
    return {};
  }
}

function flat(stored: Stored, accounts: readonly string[]): string[] {
  const keep = new Set(accounts.map((a) => a.trim().toLowerCase()));
  const out = new Set<string>();
  for (const [account, addresses] of Object.entries(stored)) {
    if (!keep.has(account)) continue;
    for (const address of addresses) if (typeof address === "string") out.add(address.toLowerCase());
  }
  return [...out];
}

/** The addresses learned before, for these Exchange mailboxes. */
export async function storedExchangeOwnAddresses(accounts: readonly string[]): Promise<string[]> {
  return flat(await read(), accounts);
}

/** Ask the directory again for each mailbox, keep the answers, and return them all. */
export async function refreshExchangeOwnAddresses(accounts: readonly string[]): Promise<string[]> {
  const stored = await read();
  for (const raw of accounts) {
    const account = raw.trim().toLowerCase();
    try {
      const found = await invoke<string[]>("mail_ews_own_addresses", { account });
      if (Array.isArray(found) && found.length) stored[account] = found.map((a) => a.toLowerCase());
    } catch {
      /* offline, or the directory said no: the last answer stands */
    }
  }
  try {
    await mailStore().settings.set(KEY, JSON.stringify(stored));
  } catch {
    /* kept for this launch only */
  }
  return flat(stored, accounts);
}
