"use client";

/*
 * The Sync button, off MailPage: read the list again now, turn the icon
 * for at least one whole turn, and say what came in.
 *
 * Owns: the turn of the icon (`syncTurn`) and the timer that ends it.
 *
 * Does not own: the list read itself. That is `loadThreads` from
 * `use-thread-list-data.ts`, and this hook only asks for a fresh one.
 *
 * One effect: it clears the timer when the page goes. The page calls this
 * hook where that effect always stood.
 */

import * as React from "react";

import { toast } from "@/lib/mail/toast";
import { mailSay } from "@/lib/mail/i18n";
import { invalidateCachedMailThread } from "@/lib/mail/thread-cache";
import { threadKey } from "@/lib/mail/thread-copies";
import type { MailThreadSummary } from "@/lib/mail/types";

export function useSyncNow({
  selected,
  loadThreads,
  threadsRef,
}: {
  /** The open thread, which is read again too. */
  selected: { account: string; threadId: string } | null;
  loadThreads: (options: {
    fresh: boolean;
    incremental: boolean;
    onLoaded: (threads: MailThreadSummary[]) => void;
  }) => Promise<boolean>;
  threadsRef: React.RefObject<MailThreadSummary[]>;
}) {
  /**
   * Sync, as the reader means it: everything, including the thread on screen.
   *
   * Refreshing the list alone was not enough. A thread's body is cached and
   * held fresh while its newest message is unchanged — and a reply written in
   * Gmail is a draft, not a message, so the thread's tip does not move and
   * nothing here had any reason to look again. The draft stayed invisible
   * however many times Sync was pressed.
   */
  /**
   * The button spins for at least one turn.
   *
   * A poll that finds nothing new answers in a moment, and the icon started
   * and stopped inside a fifth of a second — a twitch, in the middle of a
   * rotation, which reads as a sync that failed rather than one that found
   * nothing. A whole turn is a movement, and it ends where it began.
   *
   * `animate-spin` is a one second rotation, so the floor is one second: any
   * other number stops the icon mid-way round.
   */
  const [syncTurn, setSyncTurn] = React.useState(false);
  const syncTurnRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (syncTurnRef.current) clearTimeout(syncTurnRef.current);
    },
    []
  );

  const syncNow = React.useCallback(() => {
    if (selected) {
      invalidateCachedMailThread(selected.account, selected.threadId);
    }
    setSyncTurn(true);
    if (syncTurnRef.current) clearTimeout(syncTurnRef.current);
    syncTurnRef.current = setTimeout(() => {
      syncTurnRef.current = null;
      setSyncTurn(false);
    }, 1000);
    /*
      And say what came in, when something did.

      A poll that finds nothing changes nothing on screen, which is the right
      answer and an easy one to read as "it did not run". The turn of the icon
      says it ran; this says what it found, and stays quiet when the answer is
      nothing — a message saying "no new mail" after every press is a message
      nobody thanks you for.
    */
    /*
      Counted from the rows the read hands over, not from `threadsRef`.
      The ref only holds the new rows after the next render, and the read
      settled before that render: the count was always zero, and this
      toast never showed.
    */
    const before = new Set(threadsRef.current.map((t) => threadKey(t)));
    void loadThreads({
      fresh: true,
      incremental: true,
      onLoaded: (rows) => {
        const arrived = rows.filter((t) => !before.has(threadKey(t))).length;
        if (!arrived) return;
        toast.success(
          arrived === 1
            ? mailSay("syncFoundOne")
            : mailSay("syncFoundMany", { count: arrived })
        );
      },
    });
  }, [loadThreads, selected, threadsRef]);

  return { syncTurn, syncNow };
}
