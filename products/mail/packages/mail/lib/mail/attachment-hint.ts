/**
 * "You might have forgotten to attach a file."
 *
 * A message that talks about something attached, sent with nothing on it,
 * is a message that needs sending twice. Every other client asks first,
 * and the way they all do it is the same: read what was written, and look
 * for somebody promising a file.
 *
 * Deliberately dumb, and deliberately quiet. It reads the words only —
 * never the recipients, never anything a person did not type — and it says
 * nothing unless it is fairly sure, because a prompt that cries wolf is
 * one people learn to click through, and then it is worth nothing on the
 * day it is right.
 */

/**
 * What somebody writes when they mean "there is a file with this".
 *
 * Present tense and past, and both halves of the promise: "I attach", "is
 * attached", "please find enclosed". A word on its own is not enough —
 * "attachment" appears in "see my last mail about the attachment" — so
 * each of these carries the shape of the sentence with it.
 */
const PROMISES: RegExp[] = [
  // "attached", "I've attached", "attached is", "see attached"
  /\b(?:attached|attaching)\b/i,
  // "I attach", "please attach" is somebody asking, but "I attach" is not
  /\bi\s+(?:have\s+|'ve\s+)?attach(?:ed)?\b/i,
  // "the attachment", "in the attachment", "as an attachment"
  /\b(?:the|an|this|these|my|our)\s+attachments?\b/i,
  // "enclosed", the older word, and "please find enclosed"
  /\benclosed\b/i,
  // Danish, which half this mailbox is written in.
  /\b(?:vedh(?:æ|ae)ftet|vedlagt|vedh(?:æ|ae)fter)\b/i,
];

/**
 * Somebody saying they will send it later, or talking about one they got.
 *
 * These are the sentences that make the plain word a false alarm, and they
 * are checked first: "I'll attach it tomorrow" promises nothing now, and
 * "thanks for the attached" is about a file somebody else sent.
 */
const NOT_PROMISES: RegExp[] = [
  /\b(?:i(?:'ll| will)|we(?:'ll| will))\s+(?:\w+\s+){0,3}attach/i,
  /\b(?:thanks?|thank you)\s+(?:\w+\s+){0,3}(?:attached|attachment)/i,
  /\byour\s+attachments?\b/i,
  /\bwas\s+attached\b/i,
  // A quoted reply carries somebody else's promise, not this writer's.
  /^\s*>/,
];

/** Strip the quoted tail and any signature, so only new words are read. */
function writtenNow(bodyText: string): string {
  const lines = bodyText.split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*(?:-{2,}|—)\s*$/.test(line)) break;
    if (/^\s*On .*wrote:\s*$/i.test(line)) break;
    if (/^\s*(?:Den|Le|Am) .*(?:skrev|a écrit|schrieb):\s*$/i.test(line)) break;
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Whether this message reads as one that should carry a file.
 *
 * `subject` is read too: "Signed agreement attached" is the whole promise
 * on some messages, and the body says nothing about it.
 */
export function promisesAnAttachment(input: {
  subject: string;
  bodyText: string;
}): boolean {
  const text = `${input.subject}\n${writtenNow(input.bodyText)}`;
  if (!text.trim()) return false;
  if (NOT_PROMISES.some((no) => no.test(text))) return false;
  return PROMISES.some((yes) => yes.test(text));
}
