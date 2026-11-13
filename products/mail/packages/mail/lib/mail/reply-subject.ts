/**
 * The subject of a reply: the conversation's subject, with one "Re:".
 *
 * A subject that already has a reply mark keeps it, whatever its case or
 * language: "RE:" from Outlook, "SV:" from a Danish or Swedish Outlook,
 * "AW:" from a German one. The check was for "Re:" as written here, so a
 * reply to "RE: Exam question" went out as "Re: RE: Exam question"
 * (2026-11-12).
 *
 * This is more than looks on an Exchange mailbox. Exchange files mail in a
 * conversation by its subject with the first mark taken off. "RE: Exam
 * question" is "Exam question"; "Re: RE: Exam question" is "RE: Exam
 * question", another conversation. The answer from a phone, which writes
 * "Re: Exam question" again, then came back as a conversation of its own,
 * apart from the mail it answered.
 *
 * A forward mark is not a reply mark: a reply to "FW: Minutes" is
 * "Re: FW: Minutes", as every mail app writes it.
 */

/** Reply marks, in the languages we see. With a counter: "Re[2]:", "RE (3):". */
const REPLY_MARK = /^\s*(?:re|sv|vs|aw|antw|res|odp|rif)\s*(?:\[\d+\]|\(\d+\))?\s*:/i;

export function hasReplyMark(subject: string): boolean {
  return REPLY_MARK.test(subject);
}

export function replySubjectOf(subject: string): string {
  return hasReplyMark(subject) ? subject : `Re: ${subject}`;
}

/** Marks a mail app puts before a subject, reply or forward. The store has the same list (answer_links.rs). */
const ANY_MARK = /^\s*(?:re|fw|fwd|aw|sv|vs|wg|tr|rv|antw|res|ref)\s*(?:\[\d+\]|\(\d+\))?\s*:\s*/i;

/**
 * The subject without its "Re:", "Fwd:", "SV:" marks, in lower case with
 * single spaces: what two messages of one conversation have in common.
 */
export function baseSubject(subject: string): string {
  let rest = subject;
  while (ANY_MARK.test(rest)) rest = rest.replace(ANY_MARK, "");
  return rest.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}
