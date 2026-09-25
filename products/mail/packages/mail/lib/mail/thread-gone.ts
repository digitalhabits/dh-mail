/**
 * Whether a thread failed to open because the provider no longer has it.
 *
 * A reply draft kept here can outlive its conversation: the thread is
 * deleted, or emptied, in Gmail or Outlook. Opening the draft then asks for a
 * thread that is not there, and the pane showed the provider's raw answer.
 * Gmail says 404 and "notFound"; Graph says 404 and "ErrorItemNotFound".
 */
export function isThreadGoneError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /\b404\b|notFound|ItemNotFound|not found/i.test(error);
}

/**
 * Whether a thread failed to open because its mailbox is not connected here.
 *
 * A reply draft keeps the mailbox it was written in. When that mailbox is
 * later removed from Mail, the draft stays in the list, and opening it asked
 * for a mailbox that is not there: the pane showed "No connected mailbox for
 * …" and nothing to do about it.
 */
export function isMailboxNotConnectedError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /no connected mailbox/i.test(error);
}

/** Why a reply draft's thread cannot open, when it is one of the two we explain. */
export function draftThreadProblem(
  error: string | null | undefined
): "mailbox" | "gone" | null {
  if (isMailboxNotConnectedError(error)) return "mailbox";
  if (isThreadGoneError(error)) return "gone";
  return null;
}
