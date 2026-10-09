"use client";

/*
 * The open thread's chat style switch: quote the history, or read the
 * thread as a chat. ThreadPane hands in the thread; what comes back is
 * whether a change is on its way, and the function the switch calls.
 *
 * It has no effects, so its place in the pane changes no effect order.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { chatTitleFromCounterpart, type MailChatRef } from "@/lib/mail/chat-types";
import type { MailThreadDetail } from "@/lib/mail/types";

export function useChatStyle(input: {
  account: string;
  threadId: string;
  /** Null until the thread arrives. The switch does nothing until then. */
  thread: MailThreadDetail | null;
  counterpartName: string;
  counterpartEmail: string;
  onChatPromoted: (chat: MailChatRef) => void;
  setThread: React.Dispatch<React.SetStateAction<MailThreadDetail | null>>;
}) {
  const {
    account,
    threadId,
    thread,
    counterpartName,
    counterpartEmail,
    onChatPromoted,
    setThread,
  } = input;

  const [chatStyleBusy, setChatStyleBusy] = React.useState(false);

  const setChatStyle = async (noQuote: boolean) => {
    if (!thread) return;
    setChatStyleBusy(true);
    try {
      const json = await apiJson<{ chat: MailChatRef }>(
        "/api/mail/chat-style",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account,
            threadId,
            noQuote,
            title: counterpartName || chatTitleFromCounterpart(
              counterpartName,
              counterpartEmail
            ),
            subject: thread.subject,
            counterpartName,
            counterpartEmail: counterpartEmail || undefined,
            participantEmails: [
              ...new Set(
                [
                  counterpartEmail,
                  ...thread.reply.to,
                  ...thread.reply.allTo,
                ].filter(Boolean)
              ),
            ],
            messageCount: thread.messages.length,
          }),
        }
      );
      setThread((current) =>
        current ? { ...current, chat: json.chat } : current
      );
      onChatPromoted(json.chat);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't update chat style"
      );
    } finally {
      setChatStyleBusy(false);
    }
  };

  return { chatStyleBusy, setChatStyle };
}
