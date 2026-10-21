"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component reads the page's slices that it needs (see
 * mail-page-slices.tsx). Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import { usePageAccounts, usePageCompose, usePageLayout, usePageList, usePageReader } from "@/components/mail/mail-page-slices";
import { ComposeView } from "@/components/mail/ComposeView";
import { ThreadPane } from "@/components/mail/ThreadPane";

/** The floated reply and the floated new message, over everything. */
export function FloatingCards({
  sendFrom,
}: {
  /** What From offers: every mailbox, the hidden ones too (sendFromAccounts). */
  sendFrom: string[];
}) {
  const { adjustZoom, zoom } = usePageLayout();
  const { floatingCompose, floatingReply, setFloatingCompose, setFloatingReply, startCompose } = usePageCompose();
  const { folders, scheduleSentRefreshForAccount, threads } = usePageList();
  const { mailboxScopeEmails } = usePageAccounts();
  const { setSelected } = usePageReader();
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
          floatingStartsFull={floatingReply.full}
          account={floatingReply.account}
          accounts={sendFrom}
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
          inPeople
          counterpartName=""
          counterpartEmail=""
          onChatPromoted={() => {}}
          onChatThreadChanged={() => {}}
          onRecordsChanged={() => {}}
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
              inPeople: summary?.tab === "people",
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
          accounts={sendFrom}
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
