"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component takes the page's model (`m`, from useMailPage) and reads
 * the names it needs from it. Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import { ComposeView } from "@/components/mail/ComposeView";
import { ThreadPane } from "@/components/mail/ThreadPane";
import type { MailPageModel } from "@/components/mail/use-mail-page";

/** The floated reply and the floated new message, over everything. */
export function FloatingCards({
  m,

}: {
  m: MailPageModel;

}) {
  const {
    accountEmails,
    adjustZoom,
    floatingCompose,
    floatingReply,
    folders,
    mailboxScopeEmails,
    scheduleSentRefreshForAccount,
    setFloatingCompose,
    setFloatingReply,
    setSelected,
    startCompose,
    threads,
    zoom,
  } = m;
  return (
    <>
      {/* The floating reply is the thread pane itself, showing nothing but
          its composer — see `floating` in ThreadPane. The same box that
          docks in the thread, so there is one composer in this app and not
          a copy of one to keep in step. Mounted only while the thread it
          answers is not the thread on screen; on that thread the pane's own
          composer picks the draft up. */}
      {floatingReply ? (
        <ThreadPane
          key={`floating|${floatingReply.account}|${floatingReply.threadId}`}
          floating
          account={floatingReply.account}
          accounts={accountEmails}
          threadId={floatingReply.threadId}
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
          inCrm
          counterpartName=""
          counterpartEmail=""
          onChatPromoted={() => {}}
          onChatThreadChanged={() => {}}
          onCrmChanged={() => {}}
          onSent={scheduleSentRefreshForAccount}
          // The card's own two buttons: open the thread, or put the card
          // away. Both leave the draft where it is, on the thread.
          onUnfloatReply={() => {
            const summary = threads.find(
              (row) =>
                row.account === floatingReply.account &&
                row.threadId === floatingReply.threadId
            );
            setSelected({
              account: floatingReply.account,
              threadId: floatingReply.threadId,
              inCrm: summary?.tab === "people",
            });
            setFloatingReply(null);
          }}
          onFloatReply={() => setFloatingReply(null)}
        />
      ) : null}
      {floatingCompose ? (
        <ComposeView
          key={`floating|${floatingCompose}`}
          floating
          accounts={accountEmails}
          scope={mailboxScopeEmails}
          zoom={zoom}
          onZoomAdjust={adjustZoom}
          focusMode={false}
          onToggleFocus={() => {}}
          onClose={() => setFloatingCompose(null)}
          onSent={scheduleSentRefreshForAccount}
          // Back into the pane, on the same draft — which is what the
          // undo-send path already does with a key.
          onUnfloat={() => {
            const draftKey = floatingCompose;
            setFloatingCompose(null);
            startCompose({
              to: [],
              subject: "",
              continuedFromLabel: "",
              draftKey,
            });
          }}
          onUndoSend={(draftKey) => setFloatingCompose(draftKey)}
          seed={{
            to: [],
            subject: "",
            continuedFromLabel: "",
            draftKey: floatingCompose,
          }}
        />
      ) : null}
    </>
  );
}
