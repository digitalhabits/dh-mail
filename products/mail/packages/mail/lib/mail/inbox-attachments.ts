/*
 * A message's files and its raw source, with a small cache of the bytes
 * so a file opened twice is read once.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */

import "server-only";

import { localStoreServes } from "@/lib/mail/local-store";
import { IMAP_ATTACHMENT_PREFIX } from "@/lib/mail/local-thread";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import { getGmailAttachment, getMessageRaw } from "@/lib/gmail/api";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { fetchOutlookMailAttachment, fetchOutlookMessageSource } from "@/lib/mail/outlook-inbox";
import { resolveMailProvider } from "@/lib/mail/providers";
import { PlanError } from "@/lib/plan/errors";
import { base64ToBytes, base64UrlToBytes } from "@/lib/base64";

/** Streamable attachment bytes for preview/download. */
/*
  Files already read, kept for the life of the window.

  A file in a message never changes, and the same one is asked for again
  and again: once for the small picture in the thread, once more to look
  at it, and once more to save it. Each time was a new read from the
  mailbox — for a four-megabyte photograph, five megabytes of base64 over
  IMAP, after a connection that may have to be opened first. The download
  button therefore took as long as the thumbnail had, to fetch what the
  page was already showing.

  Only in the desktop app, where this memory is the reader's own. A server
  would be keeping people's files in a process they share.

  Newest last. When the sum goes over the cap, the oldest go. A read that is
  still on its way is shared too, so two askers make one request.
*/
const ATTACHMENT_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const attachmentCache = new Map<string, Uint8Array>();
const attachmentReads = new Map<string, Promise<{ bytes: Uint8Array }>>();
let attachmentCacheBytes = 0;
function rememberAttachment(key: string, bytes: Uint8Array): void {
  // One file over the cap would push everything else out and then itself.
  if (bytes.length > ATTACHMENT_CACHE_MAX_BYTES / 2) return;
  const had = attachmentCache.get(key);
  if (had) {
    attachmentCacheBytes -= had.length;
    attachmentCache.delete(key);
  }
  attachmentCache.set(key, bytes);
  attachmentCacheBytes += bytes.length;
  for (const [oldKey, oldBytes] of attachmentCache) {
    if (attachmentCacheBytes <= ATTACHMENT_CACHE_MAX_BYTES) break;
    attachmentCache.delete(oldKey);
    attachmentCacheBytes -= oldBytes.length;
  }
}

export async function fetchMailAttachment(input: {
  account: string;
  messageId: string;
  attachmentId: string;
}): Promise<{ bytes: Uint8Array }> {
  if (!tauriInvoke()) return readMailAttachment(input);
  const key = `${input.account.trim().toLowerCase()}|${input.messageId}|${input.attachmentId}`;
  const kept = attachmentCache.get(key);
  if (kept) {
    // Asked for again: it is the newest once more.
    attachmentCache.delete(key);
    attachmentCache.set(key, kept);
    return { bytes: kept };
  }
  const running = attachmentReads.get(key);
  if (running) return running;
  const read = readMailAttachment(input)
    .then((result) => {
      rememberAttachment(key, result.bytes);
      return result;
    })
    .finally(() => attachmentReads.delete(key));
  attachmentReads.set(key, read);
  return read;
}

async function readMailAttachment(input: {
  account: string;
  messageId: string;
  attachmentId: string;
}): Promise<{ bytes: Uint8Array }> {
  if ((await resolveMailProvider(input.account)) === "outlook") {
    return fetchOutlookMailAttachment(input);
  }
  // A file the copy named by its IMAP section: fetched by that section.
  if (input.attachmentId.startsWith(IMAP_ATTACHMENT_PREFIX)) {
    const invoke = tauriInvoke();
    if (!invoke) throw new PlanError("This file is read from the local copy, which needs the desktop app", 501);
    const part = (await invoke("mail_sync_fetch_part", {
      account: input.account,
      messageId: input.messageId,
      section: input.attachmentId.slice(IMAP_ATTACHMENT_PREFIX.length),
    })) as { bytesBase64: string };
    return { bytes: base64ToBytes(part.bytesBase64) };
  }
  const token = await accessTokenFor(input.account);
  const { data } = await getGmailAttachment(
    token,
    input.messageId,
    input.attachmentId
  );
  const bytes = base64UrlToBytes(data);
  return { bytes };
}

/**
 * The RFC 5322 source of one message, for "Show original" and the .eml.
 *
 * Bytes, not text: a message is not always UTF-8, and the download should
 * be the message as it came, not as it was decoded.
 */
export async function fetchMailMessageSource(input: {
  account: string;
  messageId: string;
}): Promise<{ bytes: Uint8Array }> {
  if ((await resolveMailProvider(input.account)) === "outlook") {
    return fetchOutlookMessageSource(input);
  }
  if (await localStoreServes(input.account)) {
    const invoke = tauriInvoke();
    if (invoke) {
      const encoded = (await invoke("mail_sync_fetch_source", {
        account: input.account,
        messageId: input.messageId,
      })) as string;
      return { bytes: base64ToBytes(encoded) };
    }
  }
  const token = await accessTokenFor(input.account);
  const raw = await getMessageRaw(token, input.messageId);
  return { bytes: base64UrlToBytes(raw) };
}
