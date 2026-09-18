/**
 * The name we put on mail from an account.
 *
 * Read from the provider, and only from the provider. Mail used to offer a
 * name of its own here. It was removed: a name set in Mail would ride on the
 * messages Mail sent and on no others, so the same person would appear under
 * two names depending on which client they happened to use. Nobody wants
 * that, and the provider already owns the answer.
 *
 * See `@/lib/mail/sender-name` for the formatting rules.
 *
 * Kept beside the other per-account settings, with what the provider said and
 * when we last asked. The stored copy is what the send path reads, so the
 * common case costs nothing; the provider is asked again once a day, and an
 * account that answers with an error keeps the name we already had rather
 * than losing it.
 */

import { listGmailSendAs } from "@/lib/gmail/api";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { resolveMailProvider } from "@/lib/mail/providers";
import { mailStore } from "@/lib/mail/store";
import type { MailProvider } from "@/lib/mail/types";
import {
  cleanDisplayName,
  pickSendAsName,
  senderNameIsStale,
} from "@/lib/mail/sender-name";

const SENDER_NAME_KEY = "mail_sender_name";

type StoredSenderName = {
  /** What the provider last said. */
  provider?: string;
  /** When the provider was last asked, epoch ms. */
  fetchedAt?: number;
};

function senderNameKey(account: string): string {
  return `${SENDER_NAME_KEY}:${account.trim().toLowerCase()}`;
}

async function readStored(account: string): Promise<StoredSenderName> {
  const raw = await mailStore().settings.get(senderNameKey(account));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as StoredSenderName;
  } catch {
    return {};
  }
}

async function writeStored(
  account: string,
  value: StoredSenderName
): Promise<void> {
  await mailStore().settings.set(senderNameKey(account), JSON.stringify(value));
}

export type SenderNameSettings = {
  /** What the provider says. Empty when we have not managed to ask. */
  provider: string;
  /**
   * Whether there is a name to report at all.
   *
   * Outlook is false: Graph fills the sender in from the mailbox itself, so
   * there is nothing here to read and nothing worth showing.
   */
  known: boolean;
};

/**
 * The name recipients see, with the provider asked again if the name we hold
 * is a day old.
 *
 * Reported, not offered for editing. Mail has no name of its own to set — see
 * the note at the top of this file.
 */
export async function getSenderNameSettings(
  account: string
): Promise<SenderNameSettings> {
  const provider = await resolveMailProvider(account);
  if (provider === "outlook") {
    return { provider: "", known: false };
  }
  // Failure is not worth an error here. The panel simply says nothing about
  // the name rather than showing a name it is not sure of.
  await refreshProviderName(account);
  const stored = await readStored(account);
  const name = cleanDisplayName(stored.provider);
  return { provider: name, known: Boolean(name) };
}

/**
 * The name to put on mail from this account, or "" when we have none.
 *
 * Never throws. A provider that refuses leaves the name we had, and an
 * account we have never managed to ask sends the way it did before this
 * existed — with the bare address.
 */
export async function senderNameFor(
  account: string,
  options?: { token?: string; provider?: MailProvider }
): Promise<string> {
  // Graph fills the sender in from the mailbox itself, so there is nothing
  // for us to read and nothing to put in the header.
  if (options?.provider === "outlook") return "";

  return refreshProviderName(account, options?.token);
}

/**
 * Ask Gmail what name it puts on this address, and keep the answer.
 *
 * Returns the name we already had when the answer is still fresh, or when
 * asking fails. Never throws: a name we cannot read is a bare address in the
 * header, which is how every send worked before this existed.
 */
async function refreshProviderName(
  account: string,
  token?: string
): Promise<string> {
  let stored: StoredSenderName;
  try {
    stored = await readStored(account);
  } catch (error) {
    console.warn("mail: could not read the stored sender name", error);
    return "";
  }

  const known = cleanDisplayName(stored.provider);
  if (!senderNameIsStale(stored.fetchedAt, Date.now())) return known;

  try {
    // The send path already holds a token; the settings panel does not.
    const accessToken = token ?? (await accessTokenFor(account));
    const name = pickSendAsName(await listGmailSendAs(accessToken), account);
    await writeStored(account, {
      ...stored,
      provider: name,
      fetchedAt: Date.now(),
    });
    return name;
  } catch (error) {
    // Worth saying out loud: a silent catch here is how mail goes out under
    // the wrong name for a month with nothing to show why.
    console.warn(`mail: could not read the sender name for ${account}`, error);
    return known;
  }
}
