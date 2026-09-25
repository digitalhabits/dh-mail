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

import { startOutlookSync, stopOutlookSync } from "@/lib/mail/outlook-sync";
import { tauriInvoke } from "@/lib/mail/store/tauri";

import type { MailboxRef } from "./mailbox-health";
import {
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_TOKEN_ENDPOINT,
} from "./oauth-config";

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
  const gmail = mailboxes.filter((m) => m.provider === "gmail").map((m) => m.email);
  if (!gmail.length) return outlook;
  await invoke("mail_sync_configure", {
    google: {
      clientId: GOOGLE_CLIENT_ID ?? "",
      clientSecret: GOOGLE_CLIENT_SECRET ?? "",
      tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    },
  });
  const started = (await invoke("mail_sync_start", { accounts: gmail })) as string[];
  return [...outlook, ...started];
}

/**
 * Stop a removed mailbox's sync. The Gmail worker can still be in a batch,
 * so it is told to drop the mailbox's copy itself when it ends, after its
 * last write.
 */
export async function stopLocalStoreSync(account: string): Promise<void> {
  await stopOutlookSync(account);
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("mail_sync_stop", { account, forget: true });
}
