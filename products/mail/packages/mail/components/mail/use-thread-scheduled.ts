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

import { notifyScheduledChanged } from "@/lib/mail/scheduled-events";
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
      setScheduled(json.messages ?? []);
    } catch {
      // Nothing held, or the provider would not say. Either way, show none.
      setScheduled([]);
    }
  }, [account, threadId]);
  React.useEffect(() => {
    void loadScheduled();
  }, [loadScheduled]);
  const actOnScheduled = React.useCallback(
    async (id: string, action: "cancel" | "sendNow") => {
      // Off the screen first: the reader has decided, and a row that lingers
      // while the provider is asked reads as a button that did nothing.
      setScheduled((current) => current.filter((m) => m.id !== id));
      try {
        await apiJson("/api/mail/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, id, action }),
        });
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
    [account, threadId, loadScheduled, setThread]
  );

  return {
    actOnScheduled,
    loadScheduled,
    scheduled,
  };
}
