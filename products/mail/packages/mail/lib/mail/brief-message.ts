/**
 * Whether a message is short enough to show whole, with no fold offered.
 *
 * A folded message shows two clamped lines of its text and an expand control.
 * For "Jep fixer nu." that control is a lie: there is nothing behind it, and
 * the message was already whole. Offering it on every message, however short,
 * made the control meaningless and the thread noisier than the mail in it.
 *
 * The test is about length and about height. A calendar invite draws a card
 * and an inline picture draws itself, so a short note carrying either is not
 * short on the screen, whatever its word count says.
 *
 * A file is not one of those. It draws a chip, the folded message already
 * shows a paperclip, and folding four lines of text to hide one chip is the
 * noise this rule exists to remove.
 *
 * No React and no DOM here, so a suite can read it.
 */

/** Roughly what one clamped line holds in a narrow window. */
const NARROW_LINE_CHARS = 45;

/**
 * How many lines a message may fill and still be shown whole.
 *
 * Four, not two. Two was the old answer, and it came from the size of the
 * folded preview: fold nothing that the preview would show anyway. That is a
 * lower bar than the one that matters, which is whether a reader wants the
 * control at all. A four-line note is read at a glance, and asking for a
 * click before the last line of it is the noise this rule exists to remove.
 */
export const BRIEF_MESSAGE_MAX_LINES = 4;

/**
 * As much text as those lines hold in a narrow window.
 *
 * The window is the tight case — a reading pane fits far more on a line — so
 * a message under this is whole in either. Above it, err towards folding:
 * a fold that could have been skipped costs a click, and a message cut off
 * with no way to open it costs the message.
 */
export const BRIEF_MESSAGE_MAX = BRIEF_MESSAGE_MAX_LINES * NARROW_LINE_CHARS;

export function messageIsBrief(message: {
  bodyText?: string;
  /** Anything that draws more than the words do: an invite, a picture. */
  hasCalendarInvite?: boolean;
  hasImages?: boolean;
  /** The message carries HTML, whether or not we read any words out of it. */
  hasRichBody?: boolean;
}): boolean {
  if (message.hasCalendarInvite) return false;
  if (message.hasImages) return false;
  // Counted flat, so a short note spaced over several lines stays short. The
  // question is how much there is to read, not how it was typed.
  const words = (message.bodyText ?? "").replace(/\s+/g, " ").trim();
  if (!words) {
    // Nothing to read is not the same as little to read. HTML we took no
    // words out of may still be a page, and folding is the safer answer.
    //
    // With no body at all, there is nothing to be safe about. A message that
    // is only a file draws one chip, and a fold over it hides nothing and
    // costs a click.
    return !message.hasRichBody;
  }
  return words.length <= BRIEF_MESSAGE_MAX;
}
