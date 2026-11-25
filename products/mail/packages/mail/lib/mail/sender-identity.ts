/**
 * The name we put on mail from an account.
 *
 * Read from the provider, and only from the provider. Mail does not offer a
 * name of its own here. A name set in Mail rides on the messages that Mail
 * sends and on no others. Then the same person shows under two names, by the
 * client that they use. Nobody wants that, and the provider already owns the
 * answer.
 *
 * See `@/lib/mail/sender-name` for the formatting rules.
 *
 * Kept beside the other per-account settings, with what the provider said and
 * when we last asked. The stored copy is what the send path reads, so the
 * common case costs nothing; the provider is asked again once a day, and an
 * account that answers with an error keeps the name we already had rather
 * than losing it.
 */

import {
  getMessageMetadata,
  headerValue,
  listGmailSendAs,
  listMessageIds,
} from "@/lib/gmail/api";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { resolveMailProvider } from "@/lib/mail/providers";
import { mailStore } from "@/lib/mail/store";
import type { MailProvider } from "@/lib/mail/types";
import {
  cleanDisplayName,
  pickNameFromSentMail,
  pickSendAsName,
  senderNameIsStale,
} from "@/lib/mail/sender-name";

const SENDER_NAME_KEY = "mail_sender_name";

type StoredSenderName = {
  /** What the provider last said. */
  provider?: string;
  /** When the provider was last asked, epoch ms. */
  fetchedAt?: number;
  /** Given by the reader, for a mailbox with no provider to ask. Never asked again. */
  byHand?: boolean;
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

/**
 * The name for a mailbox that has no provider to ask: a Gmail on an app
 * password, whose name Google's API cannot be asked for. Kept as if Gmail had
 * said it, and marked, so nothing asks again.
 */
export async function keepSenderNameByHand(account: string, name: string): Promise<void> {
  const cleaned = cleanDisplayName(name);
  if (!cleaned) return;
  await writeStored(account, { provider: cleaned, fetchedAt: Date.now(), byHand: true });
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
  // Graph fills the name in itself. An Exchange mailbox has no Gmail send-as
  // to ask, and the name comes with phase 4.
  if (provider === "outlook" || provider === "exchange") {
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
  if (options?.provider === "outlook" || options?.provider === "exchange") return "";

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
  if (stored.byHand || !senderNameIsStale(stored.fetchedAt, Date.now())) return known;

  try {
    // The send path already holds a token; the settings panel does not.
    const accessToken = token ?? (await accessTokenFor(account));
    const name =
      pickSendAsName(await listGmailSendAs(accessToken), account) ||
      (await nameFromSentMail(accessToken, account));
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

/** At most this many of the newest sent messages are read for a name. */
const SENT_MAIL_LIMIT = 100;
/** Read this many at a time, and stop at the first batch that holds a name. */
const SENT_MAIL_BATCH = 10;

/**
 * The name Gmail wrote on this address's own sent mail, or "".
 *
 * For an address set to "use the account name", Gmail's send-as list has no
 * name (see `pickNameFromSentMail`). Mail from this app carried the bare
 * address, so the newest sent mail can hold no name at all; mail sent from
 * Gmail's page, phone app or auto-reply carries the account name. Once a
 * name is found, this app's own mail carries it too, so later reads stop at
 * the first batch. Read once a day with the rest.
 */
async function nameFromSentMail(accessToken: string, account: string): Promise<string> {
  const { ids } = await listMessageIds(accessToken, `in:sent from:${account}`);
  const froms: string[] = [];
  const wanted = ids.slice(0, SENT_MAIL_LIMIT);
  for (let start = 0; start < wanted.length; start += SENT_MAIL_BATCH) {
    const batch = wanted.slice(start, start + SENT_MAIL_BATCH);
    const messages = await Promise.all(
      batch.map((id) => getMessageMetadata(accessToken, id, ["From"]))
    );
    froms.push(...messages.map((message) => headerValue(message, "From")));
    const name = pickNameFromSentMail(froms, account);
    if (name) return name;
  }
  return "";
}
