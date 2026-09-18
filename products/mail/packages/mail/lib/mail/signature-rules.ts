/**
 * When the signature goes on.
 *
 * The rule and nothing else: no store, no React. The composers ask it while
 * they render, the stored settings are typed by it, and a test can read it
 * without a browser or a database.
 */

/**
 * How much of a conversation carries the signature.
 *
 * "first" is the way people actually sign mail: the message that introduces
 * you carries who you are, and the back and forth after it does not. It is
 * neither of the two things a tick could say, which is why this is three
 * words rather than a checkbox.
 */
export type SignatureOnReplies = "never" | "first" | "every";

export const SIGNATURE_ON_REPLIES_DEFAULT: SignatureOnReplies = "first";

/**
 * Does this reply carry the signature?
 *
 * `alreadyWrote` is whether the reader has already sent something in this
 * conversation. Under "first" that is the whole question: the signature goes
 * on the message that introduces them, and not on the ones after it.
 */
export function signsThisReply(
  onReplies: SignatureOnReplies,
  alreadyWrote: boolean
): boolean {
  if (onReplies === "every") return true;
  if (onReplies === "never") return false;
  return !alreadyWrote;
}

/**
 * The answer a stored settings record holds, whichever build saved it.
 *
 * The tick that came before said only "every reply" or "none of them".
 * Ticked meant every reply and still does. Unticked was the default nobody
 * chose, so it becomes the new default rather than "never" — a reader who
 * wants no signature on any reply says so, and that answer is kept.
 */
export function readOnReplies(saved: {
  onReplies?: SignatureOnReplies;
  includeOnReplies?: boolean;
}): SignatureOnReplies {
  if (
    saved.onReplies === "never" ||
    saved.onReplies === "first" ||
    saved.onReplies === "every"
  ) {
    return saved.onReplies;
  }
  if (saved.includeOnReplies === true) return "every";
  return SIGNATURE_ON_REPLIES_DEFAULT;
}
