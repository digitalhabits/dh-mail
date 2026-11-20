/**
 * The words that the reader selects in a message, said to the page.
 *
 * A message says it when a selection is made or goes away. A build can
 * listen and offer something for the selection. This app's own interface
 * does not listen.
 */

export const MAIL_MESSAGE_SELECTION_EVENT = "dh-mail-message-selection";

export type MailMessageSelection = {
  text: string;
  /** Where the selection starts: the left and the top of its first line, in page pixels. */
  x: number;
  y: number;
  /** The message's RFC Message-ID, and who wrote the message. */
  messageId?: string;
  from?: string;
};

/** Say the selection, or with null that there is none now. */
export function announceMessageSelection(detail: MailMessageSelection | null): void {
  window.dispatchEvent(new CustomEvent<MailMessageSelection | null>(MAIL_MESSAGE_SELECTION_EVENT, { detail }));
}
