"use client";

/*
 * The messages the provider is holding for this thread, off useThreadPane:
 * read when the thread opens, and cancelled, sent now or edited from the
 * end of the thread.
 *
 * One effect, the read. useThreadPane calls this hook where it stood.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";

import { isLeavingScheduled, notifyScheduledChanged, onScheduledChanged } from "@/lib/mail/scheduled-events";
import { deleteHeldWithUndo, unscheduleHeldWithUndo } from "@/components/mail/scheduled-undo";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import type { MailScheduledMessage, MailThreadDetail } from "@/lib/mail/types";
import { mailSay } from "@/lib/mail/i18n";
import { scheduleThreadRefetchAfterSend } from "@/components/mail/thread-messages";

export function useThreadScheduled({
  account,
  setThread,
  threadId,
}: {
  account: string;
  setThread: React.Dispatch<React.SetStateAction<MailThreadDetail | null>>;
  threadId: string;
}) {
  /**
   * Messages the provider is holding for this thread.
   *
   * They live at the end of the thread rather than in Drafts, because that is
   * where the reader left them: a scheduled reply is part of this
   * conversation, and a folder they never open is where it goes to be
   * forgotten about.
   */
  const [scheduled, setScheduled] = React.useState<MailScheduledMessage[]>([]);
  const loadScheduled = React.useCallback(async () => {
    try {
      const json = await apiJson<{ messages?: MailScheduledMessage[] }>(
        `/api/mail/scheduled?account=${encodeURIComponent(
          account
        )}&threadId=${encodeURIComponent(threadId)}`
      );
      setScheduled((json.messages ?? []).filter((m) => !isLeavingScheduled(m)));
    } catch {
      // Nothing held, or the provider would not say. Either way, show none.
      setScheduled([]);
    }
  }, [account, threadId]);
  React.useEffect(() => {
    void loadScheduled();
    // Read again when one changes elsewhere: an Undo of a Delete brings
    // its bubble back here.
    return onScheduledChanged(() => void loadScheduled());
  }, [loadScheduled]);
  const actOnScheduled = React.useCallback(
    async (
      id: string,
      action: "cancel" | "delete" | "unschedule" | "sendNow" | "reschedule",
      sendAt?: string
    ) => {
      const held = scheduled.find((m) => m.id === id);
      // Off the screen first: the reader has decided, and a row that lingers
      // while the provider is asked reads as a button that did nothing. A
      // new time keeps it, with the time.
      setScheduled((current) =>
        action === "reschedule" && sendAt
          ? current.map((m) => (m.id === id ? { ...m, sendAt } : m))
          : current.filter((m) => m.id !== id)
      );
      try {
        if (action === "delete") {
          // Deleted after its Undo (scheduled-delete.ts). Nothing to wait for.
          if (held) deleteHeldWithUndo(held);
          return;
        }
        if (action === "unschedule") {
          // With Undo, as Delete (scheduled-undo.ts).
          if (held) await unscheduleHeldWithUndo(held);
          return;
        } else {
          await apiJson("/api/mail/scheduled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ account, id, action, sendAt }),
          });
        }
        if (action === "sendNow") {
          toast.success(mailSay("sent"));
          scheduleThreadRefetchAfterSend(account, threadId, setThread);
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't change the message"
        );
      }
      // Not straight away. The row is already off the screen, and Graph can
      // still answer with a message it has only just been told to drop —
      // which would put it back, and read as a cancel that did not work.
      window.setTimeout(() => {
        void loadScheduled();
        notifyScheduledChanged();
      }, 1500);
    },
    [account, threadId, loadScheduled, scheduled, setThread]
  );

  // A message being deleted or unscheduled leaves at once (scheduled-undo.ts).
  const [leavingTick, setLeavingTick] = React.useState(0);
  React.useEffect(() => onScheduledChanged(() => setLeavingTick((n) => n + 1)), []);
  const shown = React.useMemo(
    () => scheduled.filter((m) => !isLeavingScheduled(m)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scheduled, leavingTick]
  );

  return {
    actOnScheduled,
    loadScheduled,
    scheduled: shown,
  };
}
