"use client";

/*
 * Where the message being written lives, off the pane component. One
 * message has one place: the composer in this pane, the floating card, or
 * the pop-out window. This hook holds the moves between them and the way
 * out of all three:
 *
 * - the hand-over to the floating card, and the card's own close
 * - the discard, with its Undo and the draft at the provider
 * - the question that Escape asks, and the keys that answer it
 * - whether a pop-out is open, the key that opens it, the hand-back from
 *   it, and the draft that the pane takes up when the pop-out has gone
 *
 * It does not own the composer's state. It writes the composer only through
 * `closeComposer`, `restoreComposer` and `handOverComposer` — see
 * use-thread-composer.ts. Who may save the stored draft is decided there
 * too, by the two refs at the top of `useThreadComposer`.
 *
 * It stands where this code stood, and makes the same hook calls in the
 * same order, so its three effects keep their place. One effect stays in
 * the pane: the focus listener that calls `adoptStoredDraft` always ran
 * lower, after the keyboard effect.
 *
 * `closeFloatingCardRef` stays a ref. A send or a discard closes the card
 * seconds later, from a closure that must reach the newest function.
 *
 * New work on the card, the pop-out or the discard goes in this file, not
 * in ThreadPane.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { htmlToPlainText } from "@/lib/client-email-html";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import {
  getDraft,
  readyAttachmentsForDraft,
  threadDraftKey,
} from "@/lib/mail/local-drafts";
import {
  cancelPendingDiscard,
  DISCARD_UNDO_MS,
  schedulePendingDiscard,
} from "@/lib/mail/pending-discard";
import { openMailChatPopout } from "@/lib/mail/popout";
import {
  focusChatPopout,
  handBackChatPopout,
  isChatPopoutOpen,
} from "@/lib/native-shell";
import type { MailThreadDetail } from "@/lib/mail/types";
import { mailSay } from "@/lib/mail/i18n";
import type { RichTextEditorHandle } from "@/components/ui/RichTextEditor";
import type { ComposerMode } from "@/components/mail/thread-messages";
import type { useDraftAttachments } from "@/components/mail/draft-attachments";
import type { useThreadComposer } from "@/components/mail/use-thread-composer";

/**
 * How long to watch for the pop-out to go after asking it to hand back.
 *
 * The ask returns as soon as it has been made — the saving and the closing
 * happen in the other window a moment later. Three seconds is far longer
 * than that takes and short enough that a window which never goes (it was
 * closed by hand in the meantime) stops being waited for.
 */
const POPOUT_HAND_BACK_POLL_MS = 120;
const POPOUT_HAND_BACK_TRIES = 25;

type Composer = ReturnType<typeof useThreadComposer>;

export function useComposerHome(input: {
  account: string;
  threadId: string;
  thread: MailThreadDetail | null;
  /** This pane IS the floating card. */
  floating?: boolean;
  /** This thread's reply is in the floating card right now. */
  replyFloating?: boolean;
  onFloatReply?: () => void;
  onDraftDiscarded?: () => void;
  /** The provider's draft, from the Drafts list, when the thread did not carry it. */
  draftRef?: string;
  // The composer's fields that this hook reads, one by one.
  mode: ComposerMode | null;
  reply: string;
  replyText: string;
  attachItems: ReturnType<typeof useDraftAttachments>["items"];
  confirmDiscard: boolean;
  setConfirmDiscard: (value: boolean) => void;
  closeComposer: Composer["close"];
  restoreComposer: Composer["restore"];
  handOverComposer: Composer["handOver"];
  composerSnapshotRef: Composer["composerSnapshotRef"];
  discardedKeyRef: Composer["discardedKeyRef"];
  importedDraftRef: Composer["importedDraftRef"];
  importedForThreadRef: Composer["importedForThreadRef"];
  focusReply: (caret?: number | null) => void;
  replyEditorHandle: React.RefObject<RichTextEditorHandle | null>;
}) {
  const {
    account,
    threadId,
    thread,
    floating,
    replyFloating,
    onFloatReply,
    onDraftDiscarded,
    draftRef,
    mode,
    reply,
    replyText,
    attachItems,
    confirmDiscard,
    setConfirmDiscard,
    closeComposer,
    restoreComposer,
    handOverComposer,
    composerSnapshotRef,
    discardedKeyRef,
    importedDraftRef,
    importedForThreadRef,
    focusReply,
    replyEditorHandle,
  } = input;

  /**
   * A pop-out window is open for this thread.
   *
   * One message being written has one place. While the pop-out is that
   * place, the thread shows a strip where the reply box would be, rather
   * than a second box for the same reply.
   */
  const [popoutOpen, setPopoutOpen] = React.useState(false);

  /**
   * Hand the reply to the floating card.
   *
   * The draft is written now — through the per-key queue, so the card's
   * first read lands after it — and the composer closes without deleting
   * it, which is the whole difference from closing: the words survive the
   * handover, and opening this thread again picks the same draft up.
   */
  const floatReply = React.useCallback(
    (
      /* What to store. The default is what is on screen — see `handOver`. */
      snapshot = composerSnapshotRef.current
    ) => {
      handOverComposer(snapshot);
      onFloatReply?.();
    },
    [composerSnapshotRef, handOverComposer, onFloatReply]
  );

  /**
   * The card has said what it was opened to say.
   *
   * The floating card is the message being written and nothing else, so
   * when that message goes — sent, held for later, or thrown away — the
   * card goes with it. `onFloatReply` is what its own X does: put the card
   * away and leave the thread where it is.
   *
   * Never at the press of Send. Undo puts the words back in this box, so
   * the card can only close once the message has genuinely left.
   */
  const closeFloatingCard = React.useCallback(() => {
    if (floating) onFloatReply?.();
  }, [floating, onFloatReply]);
  /* Through a ref: the callbacks that close the card are held for seconds
     after they are made, and one of them outlives its own composer. */
  const closeFloatingCardRef = React.useRef(closeFloatingCard);
  closeFloatingCardRef.current = closeFloatingCard;

  /**
   * This card has held a composer at least once.
   *
   * A card with no composer in it is out of sight — but that is also how
   * it starts, for the frame or two before the handed-over draft arrives.
   * A card that never got one would then be invisible and impossible to
   * close, so the hiding waits until there has been something to hide.
   */
  const cardHadComposer = React.useRef(false);
  React.useEffect(() => {
    if (floating && mode) cardHadComposer.current = true;
  }, [floating, mode]);


  /**
   * Throw the reply away, here and at the provider.
   *
   * The provider's copy is not deleted yet. A Gmail draft cannot be
   * un-deleted, so Undo has to mean the request was never sent — it is held
   * for the length of the toast, outside this component, because this
   * component is gone the moment the composer closes.
   *
   * Everything needed to put the composer back is taken before it is cleared.
   * Undo restores it and takes the request back; letting the toast run out
   * sends it.
   */
  const discardComposer = React.useCallback(() => {
    /*
      Once for one draft.

      Two controls reach this — the bin in the composer and the bin in the
      toolbar above it — and the question the second one asks can be
      answered by a key as well as by its button. Whichever gets here
      first, the draft is gone; a second run would delete nothing and say
      "Draft discarded" over again.
    */
    if (discardedKeyRef.current === threadDraftKey(account, threadId)) return;
    discardedKeyRef.current = threadDraftKey(account, threadId);
    const snapshot = composerSnapshotRef.current;
    /**
     * The draft at the provider, if this thread has one.
     *
     * Not only the one this mount imported. A draft imported from Gmail
     * saves a copy here, and once that copy exists the composer opens from
     * it instead — so a discard after any remount deleted our copy and left
     * the provider's, which the next poll imported again, which saved a new
     * copy, which put the Draft badge back on a thread the reader had just
     * cleared. Discarding a reply means the reply is gone, on both sides.
     */
    const providerRef =
      importedDraftRef.current ?? thread?.providerDraft?.ref ?? draftRef ?? null;
    const restoreAttachments = readyAttachmentsForDraft(snapshot.attachItems);
    const hadSomething =
      Boolean(htmlToPlainText(snapshot.reply).trim()) ||
      restoreAttachments.length > 0;
    const key = threadDraftKey(account, threadId);

    closeComposer();
    /**
     * And this thread's provider draft has now been dealt with.
     *
     * The loaded thread still carries it until the next fetch, and the
     * import runs off what is loaded — so without this the discard was
     * followed straight away by the same draft opening again, from a copy
     * that no longer exists anywhere.
     */
    importedForThreadRef.current = threadId;

    if (providerRef) {
      schedulePendingDiscard(key, () => {
        void apiJson("/api/mail/drafts/discard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, ref: providerRef, threadId }),
        }).catch((err) => {
          console.warn("[mail] could not discard the provider's draft:", err);
        });
      });
    }

    // Whoever opened this pane to look at the draft has nothing to look
    // at now. Said before the early return below: a draft with nothing in
    // it is still a draft that has gone from the list.
    onDraftDiscarded?.();

    // An empty composer being closed is not a discard worth offering back.
    if (!hadSomething && !providerRef) {
      closeFloatingCardRef.current();
      return;
    }

    /* The card waits for the Undo the same way a send does: hidden while
       the toast stands, back with the words if it is pressed, and gone
       once the discard is final. */
    let undone = false;
    const cardDone = () => {
      if (!undone) closeFloatingCardRef.current();
    };
    toast(mailSay("draftDiscarded"), {
      duration: DISCARD_UNDO_MS,
      onAutoClose: cardDone,
      onDismiss: cardDone,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          cancelPendingDiscard(key);
          discardedKeyRef.current = null;
          importedDraftRef.current = providerRef;
          // Not the pick of one message: closing never cleared it, so it
          // is still what it was.
          restoreComposer(
            {
              mode: snapshot.mode,
              reply: snapshot.reply,
              subject: snapshot.subject,
              toList: snapshot.toList,
              ccList: snapshot.ccList,
              showCc: snapshot.showCc,
              editRecipients: snapshot.editRecipients,
              includeSignature: snapshot.includeSignature,
              fromAccount: snapshot.fromAccount,
              replyFocus: snapshot.replyFocus,
              showPreview: false,
            },
            restoreAttachments
          );
        },
      },
    });
  }, [
    account,
    threadId,
    closeComposer,
    thread?.providerDraft?.ref,
    draftRef,
    onDraftDiscarded,
    composerSnapshotRef,
    discardedKeyRef,
    importedDraftRef,
    importedForThreadRef,
    restoreComposer,
  ]);

  const composerHasWords =
    Boolean(replyText.trim()) || attachItems.length > 0;

  /**
   * Ask before throwing away something that was written — on Escape only.
   *
   * The bin does it on the spot. Nothing else on the card throws the reply
   * away, so reaching for it is already the whole of the decision, and a
   * question after it only asks whether you meant the thing you just took
   * aim at.
   *
   * Escape is the other case. It is pressed to get out of a menu, a field,
   * a mode — and if none of those is open it lands here, on the message
   * instead. That one is worth asking about.
   */
  const requestDiscard = React.useCallback(() => {
    if (!composerHasWords) {
      discardComposer();
      return;
    }
    setConfirmDiscard(true);
  }, [composerHasWords, discardComposer, setConfirmDiscard]);

  /**
   * Escape closes the composer.
   *
   * It asks first when there is something written — see above for why this
   * one asks and the bin does not. A second Escape then answers the
   * asking, which is what Escape means the rest of the time.
   *
   * While the asking stands, Enter answers it the other way. The button is
   * focused and would take Enter by itself; this is for the rest of the
   * dialog, where a click on the words leaves focus on nothing a key can
   * reach. `preventDefault` is what keeps the two from both firing.
   */
  React.useEffect(() => {
    if (!mode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Enter") {
        if (!confirmDiscard) return;
        event.preventDefault();
        setConfirmDiscard(false);
        discardComposer();
        return;
      }
      if (event.key !== "Escape") return;
      if (confirmDiscard) {
        event.preventDefault();
        setConfirmDiscard(false);
        return;
      }
      event.preventDefault();
      requestDiscard();
    };
    if (floating) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, confirmDiscard, requestDiscard, discardComposer, floating, setConfirmDiscard]);

  /**
   * Is there a pop-out for this thread? Ask the shell, every time.
   *
   * Asked rather than remembered: the pop-out can be closed from its own
   * title bar or by Escape in it, and neither says anything to this window.
   * The shell answers from the live window list, so it cannot go stale.
   * Outside the desktop app the answer is always no, and the composer
   * behaves as it always did.
   */
  const popoutKeyRef = React.useRef("");
  popoutKeyRef.current = `${account}|${threadId}`;

  const refreshPopoutOpen = React.useCallback(async () => {
    const key = `${account}|${threadId}`;
    const open = await isChatPopoutOpen({ account, threadId });
    // The reader may have moved to another thread while this was in flight.
    if (popoutKeyRef.current === key) setPopoutOpen(open);
    return open;
  }, [account, threadId]);

  /**
   * Ask on arrival, and again whenever this window comes to the front.
   *
   * Focus is the signal: closing the pop-out hands focus back here, which
   * is also how a draft written in it finds its way home.
   */
  React.useEffect(() => {
    // Another thread's answer is not this one's.
    setPopoutOpen(false);
    void refreshPopoutOpen();
    const onFocus = () => void refreshPopoutOpen();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshPopoutOpen]);

  /**
   * The pop-out is where this thread is answered while it is open.
   *
   * So everything that would otherwise open the reply box brings that
   * window forward instead. A second box behind the strip is a box nobody
   * can see, and the key or the button that opened it would look broken.
   *
   * @returns true when the pop-out took the job.
   */
  const answerInPopout = React.useCallback(() => {
    if (!popoutOpen) return false;
    void focusChatPopout({ account, threadId });
    return true;
  }, [popoutOpen, account, threadId]);

  /**
   * A draft written in the pop-out, once that window has gone.
   *
   * The pop-out saves what was typed as this thread's reply draft and closes,
   * which hands focus back here — and the thread is already open, so nothing
   * would otherwise look at the store again until it was reopened.
   *
   * Focus is the signal rather than a message between the windows: the stored
   * pages already showed what a Tauri window can be trusted to tell another
   * one, and this needs no channel at all. Bring back is the one caller that
   * cannot use it, and says why where it asks.
   *
   * Only when there is nothing here to lose. A reply half-written in this
   * window is not something to overwrite with one written somewhere else.
   *
   * And never while the floating card holds the reply. The hand-over saves
   * the draft and empties this box, so the next time the window came to
   * the front this took the draft up again: the same reply open twice, in
   * the card and in the thread. The window regains focus whenever the
   * reader comes back from another app, so it happened only sometimes.
   */
  const replyFloatingRef = React.useRef(replyFloating);
  replyFloatingRef.current = replyFloating;
  const adoptStoredDraft = React.useCallback(() => {
    if (replyText.trim() || replyFloatingRef.current) return;
    void getDraft(threadDraftKey(account, threadId)).then((raw) => {
      // Asked again: the reply can go to the card while the store answers.
      if (replyFloatingRef.current) return;
      if (raw?.kind !== "thread" || !raw.body.trim()) return;
      restoreComposer(
        {
          mode: raw.mode,
          reply: raw.body,
          subject: raw.subject ?? "",
          toList: raw.toList,
          ccList: raw.ccList,
          showCc: raw.showCc,
          editRecipients: raw.editRecipients,
          includeSignature: raw.includeSignature,
          fromAccount: raw.fromAccount,
          quoteMessageId: raw.quoteMessageId ?? null,
        },
        // The files that the pop-out stored with the words. Without them
        // the next save writes an empty strip over the stored draft.
        raw.attachments
      );
      focusReply(raw.caret ?? null);
    });
  }, [account, threadId, replyText, focusReply, restoreComposer]);

  /**
   * Bring the answer back here: the pop-out hands its draft over and goes.
   *
   * Then wait for the window to actually be gone. Focus cannot be the
   * signal this once — the click that asks for it happens in this window,
   * which therefore never loses focus and never regains it — so this is the
   * one place that watches for itself. The draft is taken up the moment the
   * pop-out is no longer there.
   */
  const handingBackRef = React.useRef(false);

  const bringBackPopout = React.useCallback(async () => {
    // Asking twice is one click too many: the second watch would still be
    // running when the draft lands in the box, and would put it there again
    // over whatever had been typed on top of it.
    if (handingBackRef.current) return;
    handingBackRef.current = true;
    const key = `${account}|${threadId}`;
    try {
      await handBackChatPopout({ account, threadId });
      for (let i = 0; i < POPOUT_HAND_BACK_TRIES; i++) {
        await new Promise((resolve) =>
          setTimeout(resolve, POPOUT_HAND_BACK_POLL_MS)
        );
        // The reader has moved on. Whatever came back belongs to a thread
        // this pane is no longer showing.
        if (popoutKeyRef.current !== key) return;
        if (await refreshPopoutOpen()) continue;
        adoptStoredDraft();
        return;
      }
    } finally {
      handingBackRef.current = false;
    }
  }, [account, threadId, refreshPopoutOpen, adoptStoredDraft]);

  const popOutThread = React.useCallback(() => {
    if (!thread) return;
    /*
      The same key both ways.

      A key that shows a window should put it away again — otherwise it is
      one key to remember and another to guess at. Closing goes through the
      hand-back, so whatever was written over there comes home rather than
      being shut in a window that has gone.
    */
    if (popoutOpen) {
      void bringBackPopout();
      return;
    }
    const counterpart = thread.messages.find((m) => !m.own && m.fromEmail);
    const email = counterpart?.fromEmail ?? thread.reply.to[0] ?? "";
    // What is being written travels with the conversation, formatting and
    // all: both boxes hold rich text now, so bold stays bold across the
    // move. It used to go as words only, because the pop-out's box was a
    // plain one.
    //
    // A reply travels. A forward does not: it goes to somebody the pop-out
    // has no picker to name, so it stays in the box that can send it.
    const answering = mode === "reply" || mode === "replyAll";
    // Whether anything has been written is still a question about words:
    // an empty editor is not an empty string, it is an empty paragraph.
    const carried = answering && replyText.trim() ? reply : "";
    // Where in it the writing had got to. Read before the composer closes,
    // because a box that has gone has no caret to ask about.
    const carriedCaret = carried ? replyEditorHandle.current?.getCaret() : null;
    void openMailChatPopout({
      account,
      threadId,
      name: counterpart?.fromName || email,
      email,
      subject: thread.subject,
      seedThread: thread,
      seedDraft: carried || undefined,
      seedCaret: carriedCaret,
    })
      .then(() => {
        // Handed over, not copied. The same words waiting in two boxes is an
        // invitation to send them twice, and Bring back returns them here.
        //
        // An empty box goes with them: the strip stands where it was, and a
        // box behind a strip that says the answer is elsewhere is the very
        // confusion the strip is there to end. A box holding files stays —
        // they were picked here, and the pop-out cannot take them. So does a
        // forward, which was never going to the pop-out in the first place.
        if (answering && (carried || !composerHasWords)) closeComposer();
        void refreshPopoutOpen();
      })
      .catch((err) =>
        toast.error(err instanceof Error ? err.message : "Couldn't pop out")
      );
  }, [
    thread,
    account,
    threadId,
    reply,
    mode,
    composerHasWords,
    closeComposer,
    refreshPopoutOpen,
    // Which way the key goes this time.
    popoutOpen,
    replyText,
    bringBackPopout,
    replyEditorHandle,
  ]);

  return {
    floatReply,
    closeFloatingCardRef,
    cardHadComposer,
    discardComposer,
    requestDiscard,
    popoutOpen,
    answerInPopout,
    adoptStoredDraft,
    bringBackPopout,
    popOutThread,
  };
}
