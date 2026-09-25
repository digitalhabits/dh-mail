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
import { SelectionPane } from "@/components/mail/SelectionPane";
import { ArrowLeft } from "lucide-react";
import { toast } from "@/lib/mail/toast";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { threadKey } from "@/lib/mail/thread-copies";
import { MailRestPanel } from "@/components/mail/MailRestPanel";
import { findCachedThread } from "@/lib/mail/list-cache";
import { PersonPane } from "@/components/mail/PersonPane";
import { patchCachedThreads } from "@/components/mail/mail-list-state";
import type { MailPageModel } from "@/components/mail/use-mail-page";
import {
  draftsInView,
  landAfterThreadDraftDiscarded,
  openDraftAfter,
  openDraftRow,
  providerDraftRefFor,
} from "@/components/mail/draft-opening";
import { discardDraftRows } from "@/components/mail/draft-discard-batch";
import {
  clearDraftSelection,
  draftRowKey,
  useDraftSelection,
} from "@/components/mail/draft-selection";
import { DraftsSelectionPane } from "@/components/mail/DraftsSelectionPane";
import { rowAfterSelection, selectedInOrder } from "@/lib/mail/multi-select";
import type { MailDraftRow } from "@/lib/mail/types";

/** What the reading pane holds: a composer, a thread, a person, or the rest picture. */

export function ReadingPaneContent({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    accountEmails,
    actOnSelection,
    activeFolder,
    adjustZoom,
    archive,
    archivePerson,
    askDeleteForever,
    clearMultiSelection,
    closeCompose,
    composeSeed,
    composing,
    debouncedSearch,
    drafts,
    draftsAccount,
    draftsView,
    editAsNewFromSource,
    floatingReply,
    folders,
    forwardStarted,
    hereNow,
    inJunkView,
    inTrashView,
    listCacheKey,
    listCollapsed,
    mailboxScopeEmails,
    markThreadInCrm,
    markUnread,
    moveToFolder,
    moveToInbox,
    multiSelectedCount,
    openThread,
    pendingForward,
    pendingRowAction,
    phone,
    pinKeySet,
    pins,
    purgeFrom,
    refreshDrafts,
    restoreFromTrash,
    scheduleSentRefreshForAccount,
    selected,
    selectedPerson,
    selectedRow,
    selectedThreadsNow,
    setFloatingCompose,
    setFloatingReply,
    setListCollapsed,
    setPendingRowAction,
    setSelected,
    setSelectedPersonKey,
    setThreadJunk,
    setThreads,
    snooze,
    startCompose,
    t,
    tab,
    threads,
    togglePin,
    toggleRead,
    trash,
    trashPerson,
    unsnooze,
    viewMode,
    viewerId,
    zoom,
  } = m;
  const draftSelection = useDraftSelection();
  // For the Drafts view: a discarded draft opens the next one.
  const draftRows = draftsInView(drafts, draftsAccount, debouncedSearch).filter(
    (row) => !draftSelection.hidden.has(draftRowKey(row))
  );
  const draftOpeners = {
    setSelected,
    setSelectedPersonKey,
    startCompose,
    closeCompose,
  };
  // Several drafts held: they, not a draft, are what the keys act on.
  if (draftsView && draftSelection.keys.size > 1) {
    const isHeld = (row: MailDraftRow) =>
      draftSelection.keys.has(draftRowKey(row));
    return (
      <DraftsSelectionPane
        count={draftSelection.keys.size}
        onClear={clearDraftSelection}
        onDiscard={() => {
          const held = selectedInOrder(
            draftRows,
            new Set(draftSelection.keys),
            draftRowKey
          );
          const next = rowAfterSelection(draftRows, isHeld);
          clearDraftSelection();
          void discardDraftRows(held, refreshDrafts);
          if (next) openDraftRow(next, draftOpeners);
          else {
            closeCompose();
            setSelected(null);
          }
        }}
      />
    );
  }
  return (
    composing ? (
          <ComposeView
            /*
              One composer per message.

              The hydrate that reads the draft runs on mount and nowhere
              else, so without this a second draft clicked in the list set
              a new seed under a composer that never looked at it — the
              first draft stayed on screen and the list appeared to stop
              answering. The key is the message: a different draft is a
              different composer, and every new blank one is the same one,
              so New email twice does not throw away what was typed.

              What was in the old one is not lost — unmounting writes it.
            */
            key={composeSeed?.draftKey ?? "compose-new"}
            accounts={accountEmails}
            scope={mailboxScopeEmails}
            zoom={zoom}
            onZoomAdjust={adjustZoom}
            focusMode={listCollapsed}
            onToggleFocus={phone ? undefined : () => setListCollapsed((v) => !v)}
            onClose={closeCompose}
            onDiscarded={
              draftsView
                ? () => {
                    const key = composeSeed?.draftKey;
                    openDraftAfter(draftRows, (row) => row.id === key, draftOpeners, accountEmails);
                    refreshDrafts();
                  }
                : undefined
            }
            // A floating card is a second window's worth of screen. A
            // phone has none to spare.
            onFloat={
              phone
                ? undefined
                : (draftKey) => {
                    closeCompose();
                    setFloatingCompose(draftKey);
                  }
            }
            onSent={scheduleSentRefreshForAccount}
            onUndoSend={(draftKey) =>
              startCompose({
                to: [],
                subject: "",
                continuedFromLabel: "",
                draftKey,
              })
            }
            seed={composeSeed}
          />
        ) : multiSelectedCount ? (
          <SelectionPane
            count={multiSelectedCount}
            conversations={selectedThreadsNow().length}
            people={viewMode === "people"}
            onArchive={() => void actOnSelection("archive")}
            onDelete={() => void actOnSelection("trash")}
            onDeleteForever={
              askDeleteForever ? () => askDeleteForever(selectedThreadsNow()) : undefined
            }
            inTrash={purgeFrom === "trash"}
            onClear={clearMultiSelection}
          />
        ) : selected ? (
          <>
            {/* The way back to a list worth going back to. With one thread
                open there is nothing behind this but the thread itself —
                which is why that case now opens straight into the reader
                (see openPerson) — so the row is only in the way. */}
            {viewMode === "people" &&
            selectedPerson &&
            selectedPerson.threads.length > 1 ? (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex items-center gap-1.5 border-b border-[var(--mail-thread-chrome-line)] bg-[var(--mail-thread-chrome)] px-8 py-2 text-left text-xs text-[var(--mail-thread-muted)] hover:text-[var(--mail-chrome-fg)]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("allThreadsWith", { name: selectedPerson.name })}
              </button>
            ) : null}
            <ThreadPane
              key={`${threadKey(selected)}|${selected.focusMessageId ?? ""}`}
              account={selected.account}
              accounts={accountEmails}
              threadId={selected.threadId}
              focusMessageId={selected.focusMessageId}
              zoom={zoom}
              onZoomAdjust={adjustZoom}
              focusMode={listCollapsed}
              onToggleFocus={phone ? undefined : () => setListCollapsed((v) => !v)}
              onArchive={() => void archive(selected)}
              onMoveToInbox={() => void moveToInbox(selected)}
              here={hereNow}
              /*
                The pane names what it shows, and it must agree with the row
                the reader can see is selected.

                Backspace in the reader has taken a conversation that was
                neither open nor selected. Until that is understood, the two
                are checked against each other and a delete that does not
                match is refused rather than done: a wrong delete is the one
                mistake here that costs somebody their mail.
              */
              onTrash={(shown) => {
                if (threadKey(shown) !== threadKey(selected)) {
                  console.error(
                    `[mail] refused a delete: the reader named ${threadKey(
                      shown
                    )} but ${threadKey(selected)} is selected`
                  );
                  // The same words the delete's own failure uses. Not a new
                  // i18n key for a state that should never be reached.
                  toast.error("Couldn't delete");
                  return;
                }
                void trash(shown, "reader");
              }}
              inTrash={inTrashView}
              fromDrafts={draftsView}
              // The provider's draft behind this thread, as the list has it.
              draftRef={draftsView ? providerDraftRefFor(draftRows, selected) : undefined}
              /*
                In the Drafts view the draft was the reason this pane was
                open. Once it is gone the pane held either an empty
                conversation — a provider draft has no messages behind it
                — or a thread the reader never asked to read. So the next
                draft opens instead, as a delete in the inbox lands on the
                next conversation.
              */
              onDraftDiscarded={
                draftsView
                  ? () =>
                      landAfterThreadDraftDiscarded({
                        rows: draftRows,
                        thread: selected,
                        open: draftOpeners,
                        refresh: refreshDrafts,
                        accounts: accountEmails,
                      })
                  : undefined
              }
              onRestore={() => void restoreFromTrash(selected)}
              onDeleteForever={
                askDeleteForever
                  ? () =>
                      askDeleteForever([
                        { account: selected.account, threadId: selected.threadId },
                      ])
                  : undefined
              }
              inJunk={inJunkView}
              onJunk={() => void setThreadJunk(selected, true)}
              onNotJunk={() => void setThreadJunk(selected, false)}
              onMoveToFolder={(folderName, create) =>
                moveToFolder(selected, folderName, create)
              }
              folders={folders}
              onSnooze={(untilIso) => void snooze(selected, untilIso)}
              onCancelSnooze={
                selectedRow?.snoozedUntil
                  ? () => void unsnooze(selected)
                  : undefined
              }
              snoozedUntil={selectedRow?.snoozedUntil}
              unread={Boolean(selectedRow?.unread)}
              onToggleUnread={() => {
                // The same rule as the quick action on the row: read becomes
                // unread, unread becomes read. A thread opened from somewhere
                // the list does not hold — a search hit, a deep link — has no
                // row to read a state off, and marking it unread is the only
                // move that makes sense there.
                if (selectedRow) void toggleRead([selectedRow], "it");
                else void markUnread(selected);
              }}
              onTogglePin={() => {
                /*
                  A pin is kept by the list row's summary. A thread opened
                  from a search hit or a deep link has no row here, so
                  there is nothing to pin it as; say so rather than nothing.

                  A thread that is already pinned always has one, though —
                  the summary the pin itself kept — and it is not always in
                  the list. Archive a pinned thread and it leaves the flow
                  list; the band goes on drawing it from that summary. The
                  pin button then had no row to work from and refused,
                  telling the reader to open from the list a thread that was
                  open and in the list. It could not be unpinned, and so it
                  could not be got rid of at all.
                */
                const mine = (t: { account: string; threadId: string }) =>
                  t.account === selected.account &&
                  t.threadId === selected.threadId;
                /*
                  And failing both, any list this viewer has already read.

                  A thread older than the page the list has loaded is in
                  none of them but the cache, so pinning it was refused —
                  and a thread unpinned from there could not be pinned
                  again, because the pin's own summary went with the pin.
                */
                const row =
                  selectedRow ??
                  pins.find(mine)?.summary ??
                  findCachedThread(viewerId, mine);
                if (row) togglePin(row);
                else toast("Open it from the list to pin it");
              }}
              pinned={pinKeySet.has(threadKey(selected))}
              forwardMessageId={
                pendingForward &&
                pendingForward.account === selected.account &&
                pendingForward.threadId === selected.threadId
                  ? pendingForward.messageId
                  : undefined
              }
              onForwardStarted={forwardStarted}
              pendingAction={
                pendingRowAction &&
                pendingRowAction.account === selected.account &&
                pendingRowAction.threadId === selected.threadId
                  ? pendingRowAction.action
                  : undefined
              }
              onPendingActionDone={() => setPendingRowAction(null)}
              refreshToken={selectedRow?.lastAt}
              messageCount={selectedRow?.messageCount}
              inCrm={selected.inCrm}
              showAddToCrm={mailUsesCrmPeople() && !selected.inCrm}
              counterpartName={
                threads.find((t) => threadKey(t) === threadKey(selected))
                  ?.fromName ?? ""
              }
              counterpartEmail={
                threads.find((t) => threadKey(t) === threadKey(selected))
                  ?.fromEmail ?? ""
              }
              onSent={scheduleSentRefreshForAccount}
              onFloatReply={
                phone
                  ? undefined
                  : () =>
                      setFloatingReply({
                        account: selected.account,
                        threadId: selected.threadId,
                      })
              }
              replyFloating={
                floatingReply?.account === selected.account &&
                floatingReply?.threadId === selected.threadId
              }
              onUnfloatReply={() => setFloatingReply(null)}
              onEditAsNew={(message, subject) =>
                void editAsNewFromSource(selected.account, subject, message)
              }
              onChatPromoted={(chat) => {
                setThreads((current) => {
                  const next = current.map((t) =>
                    threadKey(t) === threadKey(selected)
                      ? { ...t, chat }
                      : t
                  );
                  patchCachedThreads(viewerId, listCacheKey, next);
                  return next;
                });
              }}
              onChatThreadChanged={(nextThreadId, chat, focusMessageId) => {
                const prev = selected;
                setThreads((current) => {
                  const next = current.map((t) => {
                    if (
                      t.account === prev.account &&
                      t.threadId === prev.threadId
                    ) {
                      return {
                        ...t,
                        threadId: nextThreadId,
                        chat,
                        subject: chat.subject,
                      };
                    }
                    return t;
                  });
                  // Drop a duplicate row if the new part id was already listed.
                  const seen = new Set<string>();
                  const deduped = next.filter((t) => {
                    const k = threadKey(t);
                    if (seen.has(k)) return false;
                    seen.add(k);
                    return true;
                  });
                  patchCachedThreads(viewerId, listCacheKey, deduped);
                  return deduped;
                });
                // The pane is keyed by thread and focus, so setting the
                // focus is what reopens it at that message. Cleared when
                // there is none: a seam opens its part at the newest
                // message, and a stale focus would drag it elsewhere.
                setSelected((current) =>
                  current
                    ? { ...current, threadId: nextThreadId, focusMessageId }
                    : current
                );
              }}
              onCrmChanged={() => markThreadInCrm(selected)}
            />
          </>
        ) : viewMode === "people" && selectedPerson ? (
          <PersonPane
            row={selectedPerson}
            onOpenThread={openThread}
            zoom={zoom}
            onZoomAdjust={adjustZoom}
            onArchiveAll={() => void archivePerson(selectedPerson)}
            onDeleteAll={() => void trashPerson(selectedPerson)}
            onToggleRead={(rows, label) => void toggleRead(rows, label)}
            onArchiveThread={(t) => void archive(t)}
            onTrashThread={(t) => void trash(t)}
            onDeleteForever={askDeleteForever}
            inTrash={purgeFrom === "trash"}
            place={
              activeFolder
                ? activeFolder.name
                : tab === "trash"
                  ? t("viewTrash")
                  : tab === "junk"
                    ? t("viewJunk")
                    : tab === "archived"
                      ? t("viewArchived")
                      : tab === "sent"
                        ? t("viewSent")
                        : tab === "snoozed"
                          ? t("viewSnoozed")
                          : undefined
            }
          />
        ) : !accountEmails.length ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium text-stone-600">
              {t("noMailboxConnected")}
            </p>
            <p className="max-w-sm text-sm text-stone-400">
              {t("noMailboxHint")}
            </p>
          </div>
        ) : (
          /*
            No spinner here while the list loads.

            This pane holds the message being read, and nothing is being
            read yet — so it was spinning about somebody else's wait. Three
            of them ran at once during a search, and the list is where the
            wait belongs: it is the list that is filling up. What stands
            here instead is the same thing that stands here when nothing is
            open, which is the truth of it.
          */
          <MailRestPanel />
        )
  );
}
