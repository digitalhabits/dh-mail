"use client";

/*
 * Where a message being written lives, off MailPage: in the reading pane
 * (`composing`, with its `composeSeed`), floated out as a card (a reply by
 * its thread, a new message by its draft key), or put away on a phone.
 *
 * Owns: that state, and the one rule about it that is not an action:
 * opening a composer clears the phone's put-away draft.
 *
 * Does not own: opening and closing. `startCompose` and `closeCompose` stay
 * in the page, because they also set the list and the selection. The words
 * themselves live in the local drafts, which the composer and the cards
 * read and write.
 *
 * One effect. The page calls this hook where the first of this state
 * stood; no other effect ran between there and this one.
 */

import * as React from "react";

export function useComposeHome() {
  const [composing, setComposing] = React.useState(false);
  /**
   * A reply floated out of its thread, so it can be written while other
   * threads are read. Only the address: the words live in the thread's
   * local draft, which the card and the pane both read and write. The card
   * shows wherever this thread is not on screen — on the thread itself the
   * pane's own composer picks the draft up, so the reply follows the
   * reader rather than doubling.
   */
  const [floatingReply, setFloatingReply] = React.useState<{
    account: string;
    threadId: string;
  } | null>(null);
  /**
   * A new message floated out of the composer, by its draft key. The words
   * are in that draft, which the card and the composer both read — the same
   * arrangement a floated reply has, and the same card.
   */
  const [floatingCompose, setFloatingCompose] = React.useState<string | null>(
    null
  );
  /** Optional prefill for new compose (e.g. deep-link). */
  const [composeSeed, setComposeSeed] = React.useState<{
    to: string[];
    subject: string;
    continuedFromLabel: string;
    /** Continue this stored draft rather than starting a new one. */
    draftKey?: string;
  } | null>(null);
  /**
   * A composer put away on a phone with its words kept — the sheet swiped
   * down, not discarded. The bar above the footer brings it back on the
   * same draft. Opening any composer clears it. See MailPhoneShell.
   */
  const [phoneDockedDraft, setPhoneDockedDraft] = React.useState<{
    seed: typeof composeSeed;
  } | null>(null);
  React.useEffect(() => {
    if (composing) setPhoneDockedDraft(null);
  }, [composing]);

  return {
    composing,
    setComposing,
    floatingReply,
    setFloatingReply,
    floatingCompose,
    setFloatingCompose,
    composeSeed,
    setComposeSeed,
    phoneDockedDraft,
    setPhoneDockedDraft,
  };
}
