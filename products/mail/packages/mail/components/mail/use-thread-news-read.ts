"use client";

/*
  The open thread reads its newest page again when mail changes, not only
  when the list row's date does.

  A reply sent from another window (a reader window, a pop-out) shows a
  "sending" bubble only there. This window heard that mail was sent and
  read its Sent list again; the open thread read nothing. Its one read (in
  use-thread-stream.ts) waits for the row's date to change, when the sent copy
  reaches the store: a minute later on Gmail, and if that one read was
  lost, never (seen 2026-11-17: sent, and not in the conversation).

  So: after a send in this mailbox, read at 1, 5, 20 and 60 seconds; after
  the store says that the mailbox changed, read once. A read that brings
  nothing new changes nothing.
*/

import * as React from "react";

import { mailApiJson as apiJson } from "@/lib/mail/api";
import { SYNC_CHANGED_WINDOW_EVENT } from "@/lib/mail/local-store";
import { mergeNewestThreadPage } from "@/components/mail/thread-messages";
import type { MailThreadDetail } from "@/lib/mail/types";

export function useThreadNewsRead({
  account,
  threadId,
  messageCount,
  setThread,
}: {
  account: string | null | undefined;
  threadId: string | null | undefined;
  messageCount?: number;
  setThread: React.Dispatch<React.SetStateAction<MailThreadDetail | null>>;
}): void {
  React.useEffect(() => {
    if (!account || !threadId) return;
    let live = true;
    const timers: number[] = [];
    const read = async () => {
      try {
        // Not marked read: this read comes from news, not from the reader.
        // "Mark as unread" is news too, and a read that marked the thread
        // read put the row back to read at once (reported 2026-11-18).
        const params = new URLSearchParams({ account, id: threadId, markRead: "0" });
        if (messageCount) params.set("count", String(messageCount));
        const json = await apiJson<{ thread: MailThreadDetail }>(`/api/mail/thread?${params.toString()}`);
        if (!live) return;
        setThread((current) => {
          if (!current) return json.thread;
          if (current.hasNewer) return current;
          const currentLast = current.messages[current.messages.length - 1];
          const nextLast = json.thread.messages[json.thread.messages.length - 1];
          if (currentLast?.id === nextLast?.id) return current;
          return mergeNewestThreadPage(current, json.thread);
        });
      } catch {
        // Best-effort, as the read above: the pane keeps what it has.
      }
    };
    const readAt = (delays: number[]) => {
      for (const delay of delays) timers.push(window.setTimeout(() => void read(), delay));
    };
    /** Is the news about this mailbox, and this thread when one is named? */
    const forThisThread = (payload: unknown): boolean => {
      const p = (payload ?? {}) as { account?: unknown; threadId?: unknown };
      const named = typeof p.account === "string" ? p.account.trim().toLowerCase() : "";
      if (named && named !== account.trim().toLowerCase()) return false;
      return typeof p.threadId !== "string" || !p.threadId || p.threadId === threadId;
    };
    const AFTER_SEND = [1_000, 5_000, 20_000, 60_000];
    const onWindowChange = (event: Event) => {
      if (forThisThread((event as CustomEvent).detail)) readAt([400]);
    };
    window.addEventListener(SYNC_CHANGED_WINDOW_EVENT, onWindowChange);
    const unlisten: (() => void)[] = [];
    const tauriEvent = (window as unknown as {
      __TAURI__?: { event?: { listen?: (name: string, cb: (event: { payload: unknown }) => void) => Promise<() => void> } };
    }).__TAURI__?.event;
    const hear = (name: string, delays: number[]) => {
      void tauriEvent
        ?.listen?.(name, (event) => {
          if (forThisThread(event.payload)) readAt(delays);
        })
        .then((stop) => (live ? unlisten.push(stop) : stop()))
        .catch(() => undefined);
    };
    hear("mail-sync-changed", [400]);
    hear("mail-sync-sent", AFTER_SEND);
    hear("mail-sent", AFTER_SEND);
    return () => {
      live = false;
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener(SYNC_CHANGED_WINDOW_EVENT, onWindowChange);
      for (const stop of unlisten) stop();
    };
  }, [account, threadId, messageCount, setThread]);
}
