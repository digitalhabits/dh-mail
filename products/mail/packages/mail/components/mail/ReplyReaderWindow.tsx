"use client";

/**
 * A reply popped out into a window of its own (Ulrik, 2026-11-05). It was
 * a card over the main window, which covered the very thread it answered.
 * It is an ordinary window: it stood over every other one until
 * 2026-11-09, a focus window of another app too.
 *
 * The window holds the same floating reply the card held: the thread pane
 * showing its composer and nothing else (`floating` in ThreadPane), on the
 * thread's stored draft. It fills the window ("window" in card-window).
 *
 * While it is open, the thread in the main window shows its "answering in
 * the pop-out" strip (popout.rs counts this window with the chat pop-out),
 * so the reply is written in one place. Its Close, a send that has left, a
 * discard and "Bring back" from that strip all close the window. The draft
 * stays on the thread.
 */

import * as React from "react";

import { useMailFolders } from "@/components/mail/MailFolders";
import { ThreadPane } from "@/components/mail/ThreadPane";
import { useMailZoom } from "@/components/mail/use-mail-layout";
import { useZoomKeys } from "@/components/mail/use-zoom-keys";
import { useMailColorMode } from "@/lib/mail/theme";
import { closeMailReaderWindow, isNativeShell, notifyMailSent } from "@/lib/native-shell";

function closeSelf(): void {
  if (isNativeShell()) {
    void closeMailReaderWindow().catch(() => window.close());
    return;
  }
  window.close();
}

/** "Bring back" from the main window's strip: popout.rs sends it here. */
function useHandBack(onHandBack: () => void): void {
  const ref = React.useRef(onHandBack);
  ref.current = onHandBack;
  React.useEffect(() => {
    const listen = (
      window as unknown as {
        __TAURI__?: { event?: { listen?: (name: string, run: () => void) => Promise<() => void> } };
      }
    ).__TAURI__?.event?.listen;
    if (!listen) return;
    let stop: (() => void) | null = null;
    let gone = false;
    void listen("chat-popout-hand-back", () => ref.current()).then((un) => {
      if (gone) un();
      else stop = un;
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
}

export function ReplyReaderWindow({
  account,
  threadId,
  accounts,
  subject,
}: {
  account: string;
  threadId: string;
  /** Every connected mailbox, for the From picker. */
  accounts: string[];
  subject: string;
}) {
  const colorMode = useMailColorMode();
  const [zoom, adjustZoom] = useMailZoom();
  useZoomKeys(zoom, adjustZoom);
  const { folders } = useMailFolders("all", { deferMs: 400 });
  useHandBack(closeSelf);

  /** The window's own title, for the browser popup; the shell sets its own. */
  React.useEffect(() => {
    if (subject) document.title = subject;
  }, [subject]);

  return (
    <div
      className="mail-shell mail-surface-root fixed inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--mail-thread-bg,#fff)]"
      data-theme={colorMode}
    >
      <ThreadPane
        floating
        floatingInWindow
        account={account}
        accounts={accounts}
        threadId={threadId}
        zoom={zoom}
        onZoomAdjust={adjustZoom}
        focusMode={false}
        onToggleFocus={() => {}}
        onArchive={() => {}}
        onTrash={() => {}}
        onMoveToFolder={async () => {}}
        folders={folders}
        onSnooze={() => {}}
        onToggleUnread={() => {}}
        inPeople
        counterpartName=""
        counterpartEmail=""
        onChatPromoted={() => {}}
        onChatThreadChanged={() => {}}
        onRecordsChanged={() => {}}
        // The main window's list hears of it, as from the chat pop-out.
        onSent={(from) => void notifyMailSent({ account: from, threadId }).catch(() => undefined)}
        // The card's ways out, here the window's: the draft stays on the
        // thread, and the main window picks it up when it comes forward.
        onUnfloatReply={closeSelf}
        onFloatReply={closeSelf}
      />
    </div>
  );
}
