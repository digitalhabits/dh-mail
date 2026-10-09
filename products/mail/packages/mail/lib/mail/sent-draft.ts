/**
 * Did a draft's words already go out?
 *
 * A thread opened on a draft of a reply that had been sent: the reader
 * landed in the composer with the old words in it, and could send them a
 * second time (a tester on a university Exchange, 2026-10-05). Why the draft lived
 * on is not known for certain. This is the net under it: when one of our
 * own messages in the thread carries the draft's words, the draft is
 * spent, whatever kept it.
 *
 * Words, not markup: the draft is the composer's HTML, the message is what
 * the provider stored. Both are cut down to letters, digits and single
 * spaces, in lower case. The draft's opening (its first 160 such
 * characters) must appear in the message. Too little to tell by, under 24,
 * and nothing is decided: "Hi" is in every message ever sent.
 *
 * No React here, on purpose: this is the part a suite reads.
 */

import { draftHtmlToText } from "@/lib/mail/import-provider-draft";

const MIN_CHARS = 24;
const PROBE_CHARS = 160;

/** Letters and digits of any script, single spaces, lower case. */
export function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The draft's words: its HTML (or text) as text. */
function draftWords(body: string): string {
  return wordsOf(/<[a-z][\s\S]*>/i.test(body) ? draftHtmlToText(body) : body);
}

type SentMessage = { own: boolean; bodyText?: string; bodyHtml?: string; isDraft?: boolean };

/**
 * True when a message of ours in `messages` already carries the draft's
 * words. Drafts and other people's messages do not count.
 */
export function draftWordsWentOut(draftBody: string, messages: readonly SentMessage[]): boolean {
  const words = draftWords(draftBody);
  if (words.length < MIN_CHARS) return false;
  const probe = words.slice(0, PROBE_CHARS);
  return messages.some((m) => {
    if (!m.own || m.isDraft) return false;
    const sent = wordsOf(m.bodyText?.trim() ? m.bodyText : draftHtmlToText(m.bodyHtml ?? ""));
    return sent.includes(probe);
  });
}
