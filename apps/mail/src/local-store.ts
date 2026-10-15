/**
 * The local copy of the mail: starting its sync workers.
 *
 * The worker lives in Rust and refreshes tokens itself, but it needs the
 * OAuth client the interface was built with, so the interface hands that
 * over once and then names the Gmail mailboxes to sync. Every connected
 * mailbox gets a worker; until its copy has rows, the app reads the
 * provider as it always has.
 *
 * See docs/mail-local-store.md.
 */

import { exchangeSyncRunning, startExchangeSync, stopExchangeSync, wakeExchangeSync } from "@/lib/mail/exchange-sync";
import { outlookSyncRunning, startOutlookSync, stopOutlookSync, wakeOutlookSync } from "@/lib/mail/outlook-sync";
import { tauriInvoke } from "@/lib/mail/store/tauri";

import type { MailboxRef } from "./mailbox-health";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_TOKEN_ENDPOINT,
} from "./oauth-config";

/** The Gmail mailboxes the Rust worker was asked to sync. */
const gmailMailboxes = new Set<string>();

/**
 * Every worker looks at the server now: the Gmail workers in Rust, and the
 * Outlook and Exchange workers here. Each sends its queue of what the reader
 * did offline before it reads.
 */
export async function wakeEverySync(): Promise<void> {
  for (const email of outlookSyncRunning()) wakeOutlookSync(email);
  for (const email of exchangeSyncRunning()) wakeExchangeSync(email);
  const invoke = tauriInvoke();
  if (!invoke) return;
  for (const account of gmailMailboxes) {
    await invoke("mail_sync_wake", { account }).catch(() => undefined);
  }
}

/**
 * Back online: wake every worker. Without this a worker that failed while
 * the network was gone waited out its back-off, up to five minutes, before
 * it sent what the reader had done offline. Answers the function that
 * stops listening.
 */
export function wakeEverySyncWhenOnline(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const wake = () => {
    void wakeEverySync().catch((err: unknown) => console.warn("[mail] could not wake the sync workers:", err));
  };
  target.addEventListener("online", wake);
  return () => target.removeEventListener("online", wake);
}

/**
 * Start a worker for every mailbox.
 *
 * Idempotent: a mailbox with a worker keeps it. Returns the mailboxes
 * that were started this time.
 */
export async function startLocalStoreSync(mailboxes: MailboxRef[]): Promise<string[]> {
  const invoke = tauriInvoke();
  if (!invoke) return [];
  const outlook = mailboxes.filter((m) => m.provider === "outlook").map((m) => m.email);
  for (const email of outlook) startOutlookSync(email);
  // Exchange (EWS): a worker in the interface, as for Outlook. None in the
  // public build (the worker refuses there).
  const exchange = mailboxes.filter((m) => m.provider === "exchange").map((m) => m.email);
  const startedExchange = exchange.filter((email) => startExchangeSync(email));
  const gmail = mailboxes.filter((m) => m.provider === "gmail").map((m) => m.email);
  for (const email of gmail) gmailMailboxes.add(email.trim().toLowerCase());
  if (!gmail.length) return [...outlook, ...startedExchange];
  await invoke("mail_sync_configure", {
    google: {
      clientId: GOOGLE_CLIENT_ID ?? "",
      clientSecret: GOOGLE_CLIENT_SECRET ?? "",
      tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    },
  });
  const started = (await invoke("mail_sync_start", { accounts: gmail })) as string[];
  return [...outlook, ...startedExchange, ...started];
}

/**
 * Stop a removed mailbox's sync. The Gmail worker can still be in a batch,
 * so it is told to drop the mailbox's copy itself when it ends, after its
 * last write.
 */
export async function stopLocalStoreSync(account: string): Promise<void> {
  await stopOutlookSync(account);
  await stopExchangeSync(account);
  gmailMailboxes.delete(account.trim().toLowerCase());
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("mail_sync_stop", { account, forget: true });
}
