/**
 * The warning when a forward's files are near the sender's limit.
 *
 * Providers refuse a mail past their limit. Said while there are chips to
 * prune, rather than as an error after the send. Base64 makes files a third
 * bigger on the wire, which is why each warning speaks up short of the
 * stated number. The words come from the sender's provider.
 */

import type { MailProvider } from "@/lib/mail/types";

const MB = 1024 * 1024;

/** Of the stated size, what files may take once in base64. */
const BASE64_SHARE = 0.72;

/**
 * Each provider's stated limit for one mail, in MB. Exchange (EWS): the app
 * sends at most 25 MB (`MAX_MIME_BASE64` in `ews_send.rs`), and that is the
 * MIME in base64, whose files are in base64 too. So about 13 MB of files
 * fit, and that is the number said.
 */
const LIMIT: Record<MailProvider, { name: string; statedMb: number; filesMb: number }> = {
  gmail: { name: "Gmail", statedMb: 25, filesMb: 25 * BASE64_SHARE },
  outlook: { name: "Outlook", statedMb: 20, filesMb: 20 * BASE64_SHARE },
  exchange: { name: "Exchange", statedMb: 13, filesMb: 25 * BASE64_SHARE * BASE64_SHARE },
};

/** The warning for these files from this sender, or null when they fit. */
export function forwardSizeWarning(provider: MailProvider, totalBytes: number): string | null {
  const limit = LIMIT[provider];
  if (totalBytes <= limit.filesMb * MB) return null;
  const size = Math.round(totalBytes / MB);
  return provider === "exchange"
    ? `The files together are about ${size} MB. An Exchange mailbox takes about ${limit.statedMb} MB of files in one mail from this app, so it may refuse this. Remove some files.`
    : `The files together are about ${size} MB. ${limit.name} takes about ${limit.statedMb} MB in one mail, so it may refuse this. Remove some files.`;
}
