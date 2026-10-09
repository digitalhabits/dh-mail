/**
 * Messages short enough to show whole, with no fold offered.
 *
 * A folded message shows two clamped lines and an expand control. For "Jep
 * fixer nu." that control is a lie — there is nothing behind it — and offering
 * it on every message however short made the control meaningless.
 */

import {
  BRIEF_MESSAGE_MAX,
  BRIEF_MESSAGE_MAX_LINES,
  messageIsBrief,
} from "@/lib/mail/brief-message";

import { check, suite } from "./harness.mjs";

suite(async () => {
  check(
    "a one-liner is brief",
    messageIsBrief({ bodyText: "Jep fixer nu." }) === true
  );
  check(
    "a long message is not",
    messageIsBrief({ bodyText: "x".repeat(BRIEF_MESSAGE_MAX + 1) }) === false
  );
  check(
    "the limit itself is brief",
    messageIsBrief({ bodyText: "x".repeat(BRIEF_MESSAGE_MAX) }) === true
  );
  // Counted flat: a short note broken over several lines is still short.
  check(
    "line breaks do not make it long",
    messageIsBrief({ bodyText: "Yes.\n\nDo that.\n\nThanks" }) === true
  );

  // --- Where the line sits ------------------------------------------------
  //
  // Four lines are shown whole; the fold starts above that. These two say so
  // in the units the rule is written in, so a change to either constant has
  // to be meant.

  check("four lines are shown whole", BRIEF_MESSAGE_MAX_LINES === 4);
  check(
    "a four-line message is brief",
    messageIsBrief({ bodyText: "x".repeat(BRIEF_MESSAGE_MAX_LINES * 45) }) ===
      true
  );
  check(
    "a five-line one is not",
    messageIsBrief({
      bodyText: "x".repeat((BRIEF_MESSAGE_MAX_LINES + 1) * 45),
    }) === false
  );

  // --- What draws more than its words -------------------------------------
  //
  // Length is not the whole test. Something that draws its own block is not
  // short on the screen, however few words came with it.

  check(
    "an invite draws a card, so it folds",
    messageIsBrief({ bodyText: "Friday?", hasCalendarInvite: true }) === false
  );
  check(
    "a picture draws itself, so it folds",
    messageIsBrief({ bodyText: "Look", hasImages: true }) === false
  );
  // A file draws a chip, and the folded message already shows a paperclip.
  // Folding a short note to hide one chip is the noise this rule removes.
  check(
    "a file does not fold a short note",
    messageIsBrief({ bodyText: "See attached" }) === true
  );

  // --- Nothing to read ----------------------------------------------------
  //
  // Which is not the same as little to read. HTML we took no words out of may
  // still be a page, and folding is the safer answer. With no body at all
  // there is nothing to be safe about: a message that is only a file draws
  // one chip, and folding over it hides nothing and costs a click.

  check(
    "HTML we could not read folds",
    messageIsBrief({ bodyText: "", hasRichBody: true }) === false
  );
  check(
    "so does HTML with only whitespace in it",
    messageIsBrief({ bodyText: "   \n\t ", hasRichBody: true }) === false
  );
  check(
    "a message that is only a file is shown whole",
    messageIsBrief({ bodyText: "" }) === true
  );
  check("and so is one with no body at all", messageIsBrief({}) === true);

  // The window is the tight case, so the limit has to fit four clamped lines
  // there — a reading pane fits far more.
  check("the limit is about four narrow lines", BRIEF_MESSAGE_MAX <= 240);
});
