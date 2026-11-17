"use client";

/*
 * Where a message goes when Send made it: off use-thread-send.ts.
 *
 * In a thread pane and in the floating card, the message waits out its
 * count here, with its bubble and its Undo (`runSendLaunch`).
 *
 * In the reply window, the message goes to the main window, and the window
 * closes at once (Ulrik, 2026-11-17). The count, the bubble and Undo are
 * then in the main window, as for a reply sent from the conversation's own
 * reply box. The steps:
 *
 * 1. The composer stores its words as the thread's draft and empties
 *    (`handOverComposer`). The window says "Sending".
 * 2. The message is offered in the store that the windows share, and the
 *    main window is told (lib/mail/send-handover.ts).
 * 3. If the main window takes the message, this window closes. It sends
 *    nothing: the message is the main window's.
 * 4. If the main window does not take it in three seconds, the offer is
 *    withdrawn and this window sends the message, as before this change.
 *
 * Only one window sends: the store gives the message to the first of
 * "claimed" and "withdrawn", and to no other. The stored draft is for a
 * reply window that goes away between step 1 and step 3: the words are then
 * still the thread's draft.
 *
 * A pane that is not floating also registers as a taker: the main window
 * gives it a handed-over message for its thread.
 *
 * One effect, which registers the taker. It reads no state of the composer.
 */

import * as React from "react";

import {
  putBackDetached,
  registerSendTaker,
  runSendLaunch,
  type SendLaunch,
  type SendLaunchOps,
} from "@/components/mail/send-launch";
import type { ThreadSendInput, useSendOutbox, useSendSchedule } from "@/components/mail/use-thread-send";
import { mailSay } from "@/lib/mail/i18n";
import { getDraft, threadDraftKey } from "@/lib/mail/local-drafts";
import { offerSendHandover, type SendHandoverResult } from "@/lib/mail/send-handover";
import { idbHandoverRows } from "@/lib/mail/send-handover-store";
import { toast } from "@/lib/mail/toast";
import { newMailId } from "@/lib/mail/uuid";
import { notifyMailSendHandover } from "@/lib/native-shell";

/** The message as Send made it. The thread's files are added here. */
export type Deliver = (launch: Omit<SendLaunch, "readableAttachments">) => void;

export function useSendLaunch({
  account,
  closeComposer,
  closeFloatingCardRef,
  dispatchOutboxSend,
  floating,
  handOverComposer,
  handsOverSend,
  loadScheduled,
  mode,
  paneAliveRef,
  putBackFromOutbox,
  readableAttachments,
  setArmedSendAt,
  setOutbox,
  setThread,
  threadId,
}: Pick<ReturnType<typeof useSendOutbox>, "dispatchOutboxSend" | "paneAliveRef" | "putBackFromOutbox" | "setOutbox"> &
  Pick<ReturnType<typeof useSendSchedule>, "setArmedSendAt"> &
  Pick<ThreadSendInput, "account" | "closeComposer" | "closeFloatingCardRef" | "floating" | "handOverComposer" | "handsOverSend" | "loadScheduled" | "mode" | "readableAttachments" | "setThread" | "threadId">) {
  /**
   * How this pane runs a launch.
   *
   * `handed`: the message came from the reply window. Its composer was
   * there, so this pane has none to close. Undo puts the words in this
   * pane's reply box, or, if the pane went away in the count, back through
   * the main window (`putBackDetached`).
   */
  const paneOps = React.useCallback(
    (handed: boolean): SendLaunchOps => ({
      show: (launch) => {
        setOutbox((prev) => ({ ...prev, [launch.localId]: launch.entry }));
        const bubble = launch.bubble;
        if (!bubble) return;
        setThread((current) =>
          current ? { ...current, messages: [...current.messages, bubble] } : current
        );
      },
      closeComposer: handed
        ? () => {}
        : () => {
            setArmedSendAt(null);
            closeComposer();
          },
      dispatch: (launch) => void dispatchOutboxSend(launch.localId, launch.entry),
      putBack: (launch) => {
        if (handed && !paneAliveRef.current) putBackDetached(launch);
        else putBackFromOutbox(launch.localId, launch.entry);
      },
      scheduledChanged: () => void loadScheduled(),
      closeCard: () => closeFloatingCardRef.current(),
    }),
    [closeComposer, closeFloatingCardRef, dispatchOutboxSend, loadScheduled, paneAliveRef, putBackFromOutbox, setArmedSendAt, setOutbox, setThread]
  );

  /* Through a ref: `deliver` is in the dependency list of Send, and the
     list of files is a new one on each render. */
  const readableRef = React.useRef(readableAttachments);
  readableRef.current = readableAttachments;

  const deliver = React.useCallback<Deliver>(
    (made) => {
      const launch: SendLaunch = { ...made, readableAttachments: readableRef.current };
      if (!handsOverSend) {
        runSendLaunch(launch, paneOps(false));
        return;
      }
      // Step 1. The words are the thread's stored draft from here, and the
      // box is empty: nothing more is typed into a message that is offered.
      handOverComposer();
      void (async () => {
        // Behind that save in this window's queue, so the draft is in the
        // store before the main window can take the message and delete it.
        await getDraft(threadDraftKey(account, threadId)).catch(() => null);
        const result: SendHandoverResult = await offerSendHandover<SendLaunch>({
          rows: idbHandoverRows<SendLaunch>(),
          id: newMailId(),
          payload: launch,
          announce: (id) => notifyMailSendHandover({ id }),
        }).catch(() => "unknown" as const);
        if (result === "taken") {
          // Step 3. The shell closes this window and fronts the main one.
          closeFloatingCardRef.current();
          return;
        }
        if (result === "unknown") {
          // Nobody can say who has the message, so this window does not
          // send it. The words go back on screen, with the reason.
          putBackFromOutbox(launch.localId, launch.entry);
          toast.error(mailSay("handedSendUnknown"), { duration: 60_000 });
          return;
        }
        // Step 4. As before: the count is in this window, which closes
        // after the send. `closeComposer` deletes the stored draft.
        runSendLaunch(launch, paneOps(false));
      })();
    },
    [account, closeFloatingCardRef, handOverComposer, handsOverSend, paneOps, putBackFromOutbox, threadId]
  );

  /* The newest of each, for the taker that the effect registers one time. */
  const takerRef = React.useRef({
    take: (_launch: SendLaunch): boolean => false,
    putBack: (_launch: SendLaunch): void => {},
    composerOpen: (): boolean => false,
  });
  takerRef.current = {
    take: (launch) => {
      // A message is being written here. The count runs with no bubble,
      // and this box is not touched (`detachedSendOps`).
      if (mode) return false;
      runSendLaunch(launch, paneOps(true));
      return true;
    },
    putBack: (launch) => putBackFromOutbox(launch.localId, launch.entry),
    composerOpen: () => Boolean(mode),
  };
  React.useEffect(() => {
    // The card and the reply window hold one message. They take no other.
    if (floating) return;
    return registerSendTaker({
      account,
      threadId,
      take: (launch) => takerRef.current.take(launch),
      putBack: (launch) => takerRef.current.putBack(launch),
      composerOpen: () => takerRef.current.composerOpen(),
    });
  }, [account, threadId, floating]);

  return { deliver };
}
