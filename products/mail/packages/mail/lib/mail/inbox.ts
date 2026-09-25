/*
 * The inbox core, by concern:
 *
 *   inbox-list          the unified list, from every mailbox
 *   inbox-thread        one thread, a page of messages at a time
 *   inbox-send          sending, scheduled messages, Outlook drafts
 *   inbox-drafts        the drafts the providers hold
 *   inbox-attachments   a message's files and its source
 *   inbox-actions       archive, read, junk, trash, delete forever, snooze
 *   inbox-snoozed       the Snoozed tab
 *   inbox-gmail-pages   the Gmail pages kept between polls
 *   inbox-gmail-common  helpers they share
 *
 * The rest of the app imports from here. New inbox work goes in the module
 * of its concern, and is exported here only when a caller outside needs it.
 */
import "server-only";

export { invalidateInboxCache, invalidateMailCaches } from "@/lib/mail/inbox-cache";
export { accessTokenFor } from "@/lib/mail/mail-gmail-token";
export { countActiveSnoozes } from "@/lib/mail/mail-snooze-count";
export type { MailAutoReply } from "@/lib/mail/mail-autoreply";
export {
  listMailAutoReplies,
  setMailAutoReply,
} from "@/lib/mail/mail-autoreply";
export {
  newRfcMessageId,
} from "@/lib/mail/inbox-gmail-common";
export {
  forgetThreadInStoredPages,
} from "@/lib/mail/inbox-gmail-pages";
export {
  encodeMailListCursor,
  decodeMailListCursor,
  listUnifiedInbox,
} from "@/lib/mail/inbox-list";
export {
  getMailThread,
} from "@/lib/mail/inbox-thread";
export {
  MAIL_ATTACHMENT_MAX_TOTAL_BYTES,
  type OutgoingAttachment,
  type ForwardedMessage,
  type QuotedMessage,
  listScheduledMailMessages,
  listAllScheduledMailMessages,
  cancelScheduledMailMessage,
  sendScheduledMailMessageNow,
  draftMailInOutlook,
  sendMailMessage,
} from "@/lib/mail/inbox-send";
export {
  discardProviderDraft,
  listProviderDrafts,
} from "@/lib/mail/inbox-drafts";
export {
  fetchMailAttachment,
  fetchMailMessageSource,
} from "@/lib/mail/inbox-attachments";
export {
  archiveMailThread,
  unarchiveMailThread,
  markMailThreadUnread,
  markMailThreadRead,
  markMailThreadJunk,
  markMailThreadNotJunk,
  trashMailThread,
  untrashMailThread,
  type MailPurgeFolder,
  deleteMailThreadForever,
  snoozeMailThread,
  unsnoozeMailThread,
} from "@/lib/mail/inbox-actions";
export {
  listSnoozedThreads,
} from "@/lib/mail/inbox-snoozed";
