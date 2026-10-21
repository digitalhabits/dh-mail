/**
 * The other addresses of an Exchange mailbox, so mail from them is ours.
 *
 * An Exchange mailbox signs in as one address and sends as another: on KU,
 * `abc123@uni.example` sends as `kim.example@dept.uni.example`. If mail counts
 * as the reader's only when it comes from a connected address, a reply sent
 * from the other address reads as somebody else's. It shows on the left of
 * the thread, new in the inbox, and it pulls an archived thread back.
 *
 * The directory knows every address a mailbox has (`mail_ews_own_addresses`
 * in mail-native, ews_directory.rs). It is asked once a launch for each
 * Exchange mailbox, and the answer is kept, so the addresses count while the
 * server cannot be reached. A failed ask keeps the last answer.
 *
 * The directory also names the main address: the one the server sends as.
 * It can change after the mailbox was connected (a university can give
 * `abc123@dept.uni.example` the new main address
 * `kim.example@dept.uni.example`). The connected address stays the key
 * everywhere in the store; only From shows the main address
 * (`sendAsLabel`, and `useSendAsLabel` in FromAccountMenu.tsx).
 */

import { invoke } from "@/lib/mail/exchange-native";
import { mailStore } from "@/lib/mail/store";

const KEY = "mail_exchange_own_addresses";
/** The main address of each mailbox. A key of its own, so an older copy of the app still reads `KEY`. */
const MAIN_KEY = "mail_exchange_main_addresses";

type Stored = Record<string, string[]>;
type StoredMain = Record<string, string>;

/** What `mail_ews_own_addresses` gives back (ews_directory.rs, `OwnAddresses`). */
type OwnAddresses = { main: string | null; addresses: string[] };

async function readKey<T extends object>(key: string): Promise<T> {
  try {
    const raw = await mailStore().settings.get(key);
    const value = raw ? (JSON.parse(raw) as unknown) : {};
    return (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as T;
  } catch {
    return {} as T;
  }
}

const read = () => readKey<Stored>(KEY);

/** The main addresses in use now, by the connected address. */
let mains: StoredMain = {};
const listeners = new Set<() => void>();

function publishMains(stored: StoredMain, accounts: readonly string[]) {
  const next: StoredMain = {};
  for (const raw of accounts) {
    const account = raw.trim().toLowerCase();
    const main = stored[account];
    if (typeof main === "string" && main.includes("@")) next[account] = main.toLowerCase();
  }
  mains = next;
  for (const listener of listeners) listener();
}

/** Called when a new answer changes the main addresses. */
export function subscribeMainAddresses(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The main addresses in use now. A new object after each change. */
export function mainAddresses(): Readonly<StoredMain> {
  return mains;
}

/** The address to show for `account` where it is who the mail is from: the main address, else the account itself. */
export function sendAsLabel(account: string, from: Readonly<StoredMain> = mains): string {
  const key = account.trim().toLowerCase();
  const main = from[key];
  return main && main !== key ? main : account;
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
  publishMains(await readKey<StoredMain>(MAIN_KEY), accounts);
  return flat(await read(), accounts);
}

/** Ask the directory again for each mailbox, keep the answers, and return them all. */
export async function refreshExchangeOwnAddresses(accounts: readonly string[]): Promise<string[]> {
  const stored = await read();
  const storedMain = await readKey<StoredMain>(MAIN_KEY);
  for (const raw of accounts) {
    const account = raw.trim().toLowerCase();
    try {
      const found = await invoke<OwnAddresses>("mail_ews_own_addresses", { account });
      const addresses = Array.isArray(found?.addresses) ? found.addresses : [];
      if (!addresses.length) continue;
      stored[account] = addresses.map((a) => a.toLowerCase());
      if (typeof found.main === "string" && found.main.includes("@")) storedMain[account] = found.main.toLowerCase();
    } catch {
      /* offline, or the directory said no: the last answer stands */
    }
  }
  try {
    await mailStore().settings.set(KEY, JSON.stringify(stored));
    await mailStore().settings.set(MAIN_KEY, JSON.stringify(storedMain));
  } catch {
    /* kept for this launch only */
  }
  publishMains(storedMain, accounts);
  return flat(stored, accounts);
}
