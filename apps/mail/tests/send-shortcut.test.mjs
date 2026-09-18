/**
 * Which box the send key sends from.
 *
 * The key is pressed from inside the message it sends, so the thread's own
 * shortcut handler cannot have it — that one stands down wherever a reply is
 * being written. Each composer listens for it instead, which is fine until
 * two of them are open: the thread's box and the floating card. Then the
 * question is whose key it is, and the answer is the caret's.
 *
 * The rule is here as plain logic; the pane asks it what to do with a press.
 */

import {
  DEFAULT_MAIL_SHORTCUTS,
  sendsFromHere,
  shortcutMatchesEvent,
} from "@/lib/mail/shortcuts";

import { check, suite } from "./harness.mjs";

/** The caret is in this pane's reply box: the ordinary case. */
const typingHere = { caretHere: true, caretNowhere: false };
/** The caret is in the other one. */
const typingElsewhere = { caretHere: false, caretNowhere: false };
/** The caret is nowhere: the reader clicked the thread, or the window is back. */
const nowhere = { caretHere: false, caretNowhere: true };

suite(async () => {
  check(
    "the reply being typed in the thread sends on the key — the whole point of it",
    sendsFromHere({ ...typingHere, floating: false }) === true
  );
  check(
    "and the card sends when the caret is in the card",
    sendsFromHere({ ...typingHere, floating: true }) === true
  );
  check(
    "the thread's box does not send while the caret is in the card",
    sendsFromHere({ ...typingElsewhere, floating: false }) === false
  );
  check(
    "and the card does not send while the caret is in the thread",
    sendsFromHere({ ...typingElsewhere, floating: true }) === false
  );
  check(
    "a caret nowhere at all means the box in the thread, which is the one on screen",
    sendsFromHere({ ...nowhere, floating: false }) === true
  );
  check(
    "and never the card, which answers for itself",
    sendsFromHere({ ...nowhere, floating: true }) === false
  );

  /** The key itself, so the rule above is asked of the right press. */
  const press = (init) => ({
    key: "Enter",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    ...init,
  });
  check(
    "Cmd+Enter is the send key",
    shortcutMatchesEvent(press({ metaKey: true }), DEFAULT_MAIL_SHORTCUTS.send) === true
  );
  check(
    "a plain Enter is a new line, not a send",
    shortcutMatchesEvent(press({}), DEFAULT_MAIL_SHORTCUTS.send) === false
  );
});
