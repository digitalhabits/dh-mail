"use client";

/*
 * Parts of the thread list's markup (ThreadListColumn), moved out of
 * mail-thread-list.tsx.
 *
 * Each component reads the page's slices that it needs (see
 * mail-page-slices.tsx). The JSX is the list's own, word for word.
 */

import {
  OPEN_ROW_CARD,
  ROW_LINE,
  ROW_PAD_LEFT,
  FACE_DOT_TOP,
  UnreadGutterDot,
  WIDE_FACE_DOT_TOP,
} from "@/components/mail/list-row-marks";
import { usePageAccounts, usePageActions, usePageCompose, usePageLayout, usePageList, usePageReader, usePageSync } from "@/components/mail/mail-page-slices";
import { isMailboxScopeAll } from "@/components/mail/mail-list-state";
import { isPendingScheduledId } from "@/lib/mail/scheduled-events";
import { openScheduledMessage, useOpenScheduledMessage } from "@/components/mail/ScheduledMessageView";
import { missedWhen } from "@/components/mail/MissedScheduledDialog";
import { HiddenAccountMark } from "@/components/mail/hidden-account-mark";
import { isScheduledDraftId } from "@/lib/mail/scheduled-drafts";
import * as React from "react";

import { isMailPersonPinned } from "@/lib/mail/person-pins";
import { mailProviderFor, mailProviderLabel } from "@/lib/mail/use-outlook-accounts";
import { syncPauseKind } from "@/lib/mail/sync-pause";
import { formatSnoozeWakeLabel, SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { ListNotice, ListNoticeButton } from "@/components/mail/ListNotice";
import { MailFirstReadLine } from "@/components/mail/MailFirstReadLine";
import { OfflineLine } from "@/components/mail/OfflineLine";
import { useOffline } from "@/lib/mail/use-offline";
import { AlertTriangle, Clock, Loader2, Pin, Paperclip } from "lucide-react";
import { MAIL_RECONNECT_REQUEST, toast, type MailReconnectRequest } from "@/lib/mail/toast";
import { mailHasTeamRecords } from "@/lib/mail/product-flavor";
import { teamWord } from "@/lib/mail/i18n-team";
import { unpinMailThread } from "@/lib/mail/pins";
import { threadDraftKey } from "@/lib/mail/local-drafts";
import { rowStandsFor, threadKey } from "@/lib/mail/thread-copies";
import { cn } from "@/lib/utils";
import { rowTime } from "@/lib/mail/date-format";
import { type MailStringKey, useMailT } from "@/lib/mail/i18n";
import { PersonAvatar } from "@/components/mail/PersonAvatar";
import { PersonRowActions } from "@/components/mail/PersonRowActions";
import { Highlighted } from "@/components/mail/Highlighted";
import { ConfirmPurgeDialog } from "@/components/mail/ConfirmPurgeDialog";
import { OutboxRowMenu, type OutboxMenuAt } from "@/components/mail/OutboxRowMenu";
import type { MailScheduledMessage, MailThreadSummary } from "@/lib/mail/types";
import { ThreadListRow, ThreadRowMenu, PersonRowMenu, DraftBadge } from "@/components/mail/ThreadListRow";
import { rowInSelection, SelectionRowMenu, type SelectionMenuAt } from "@/components/mail/mail-selection-menu";
import { PersonCount, PersonWideBody, StackThreads } from "@/components/mail/person-stack";
import type { PersonRow } from "@/lib/mail/person-participants";


/** The thread view's rows: the pinned band, then the list by day. */
export function ThreadRows() {
  const t = useMailT();
  const { archive, capturePinFlip, rowMenuActions, snooze, togglePin, toggleRead, trash, unsnooze } = usePageActions();
  const { chromeDark, listDensity, listExpanded, listNarrow, listRowWide, phone } = usePageLayout();
  const { clickThreadRow, expandThreadRow, selected: selectedThread } = usePageReader();
  const { debouncedSearch, groups, highlightTerms, inTrashView, multiKeys, pinKeySet, pinnedThreads, showPinnedBand } = usePageList();
  /*
    A scheduled message open in the reader is what is selected: its row in
    the Scheduled group is lit, and the thread or person behind it is not.
  */
  const scheduledOpen = Boolean(useOpenScheduledMessage());
  const selected = scheduledOpen ? null : selectedThread;
  const [selectionMenu, setSelectionMenu] = React.useState<SelectionMenuAt | null>(null);
  return (
    <>
      <>
        {showPinnedBand && pinnedThreads.length ? (
            <div className="relative">
              {/* No rule under the band. The teal bar down its side
                  already marks where it ends, and the heading over the
                  list below says the same thing again. */}
              <div
                aria-hidden
                className="absolute bottom-0 left-0 top-0 w-0.5 bg-teal-400"
              />
              <PinnedHeading
                listNarrow={listNarrow}
                listExpanded={listExpanded}
                label={t("pinned")}
              />
              <div className="max-h-[18rem] overflow-y-auto overscroll-contain">
                {pinnedThreads.map((t) => (
                  <ThreadListRow
                    highlight={highlightTerms}
                    key={`pin|${threadKey(t)}`}
                    thread={t}
                    /* Expanding hides the reader. A fill would mark
                       a thread that is not on screen to be read. */
                    selected={
                      !listExpanded &&
                      ((selected != null &&
                        rowStandsFor(t, selected)) ||
                        multiKeys.has(threadKey(t)))
                    }
                    withYear={Boolean(debouncedSearch)}
                    pinned
                    onNavy={chromeDark}
                    density={listDensity}
                    narrow={listNarrow}
                    wide={listRowWide}
                    onOpen={(e) => clickThreadRow(t, e)}
                    onExpand={() => expandThreadRow(t)}
                    onTogglePin={() => togglePin(t)}
                    onToggleRead={() => void toggleRead([t], "it")}
                    onSnooze={(untilIso) => void snooze(t, untilIso)}
                    onCancelSnooze={
                      t.snoozedUntil ? () => void unsnooze(t) : undefined
                    }
                    // Not in Trash: there is nothing to archive out of
                    // it and nothing left to delete.
                    onArchive={
                      inTrashView ? undefined : () => void archive(t)
                    }
                    onTrash={
                      inTrashView ? undefined : () => void trash(t)
                    }
                    {...rowMenuActions(t)}
                    dragKind="pin"
                    touch={phone}
                    onSelectionMenu={
                      rowInSelection(multiKeys, threadKey(t))
                        ? (x, y) => setSelectionMenu({ x, y })
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
        ) : null}
        <div
          // The same room above the first heading as the stacked list has
          // (its wrapper's pt-2), so the list does not shift when Stacks
          // is switched.
          className={listExpanded ? undefined : "pt-2"}
          onDragOver={(e) => {
            // Accept drops from the pinned band to unpin.
            if (
              e.dataTransfer.types.includes("application/x-redd-mail-pin")
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(e) => {
            const raw = e.dataTransfer.getData(
              "application/x-redd-mail-pin"
            );
            if (!raw) return;
            e.preventDefault();
            try {
              const { account, threadId } = JSON.parse(raw) as {
                account: string;
                threadId: string;
              };
              capturePinFlip(`${account}|${threadId}`);
              unpinMailThread(account, threadId);
              toast("Unpinned");
            } catch {
              /* ignore */
            }
          }}
        >
          {groups.map((group) => (
              <div key={group.label || "results"}>
                {group.label && !listNarrow ? (
                  <p className={cn(
                    "px-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-list-muted)]",
                    listExpanded ? "pt-2" : "pt-4"
                  )}>
                    {t(group.label as MailStringKey)}
                  </p>
                ) : (
                  <div
                    className={
                      listNarrow
                        ? "pt-0.5"
                        : listExpanded
                          ? "pt-0"
                          : "pt-2"
                    }
                  />
                )}
                {group.items.map((t) => (
                  <ThreadListRow
                    highlight={highlightTerms}
                    key={threadKey(t)}
                    thread={t}
                    selected={
                      !listExpanded &&
                      ((selected != null &&
                        rowStandsFor(t, selected)) ||
                        multiKeys.has(threadKey(t)))
                    }
                    withYear={Boolean(debouncedSearch)}
                    pinned={pinKeySet.has(threadKey(t))}
                    onNavy={chromeDark}
                    density={listDensity}
                    narrow={listNarrow}
                    wide={listRowWide}
                    onOpen={(e) => clickThreadRow(t, e)}
                    onExpand={() => expandThreadRow(t)}
                    onTogglePin={() => togglePin(t)}
                    onToggleRead={() => void toggleRead([t], "it")}
                    onSnooze={(untilIso) => void snooze(t, untilIso)}
                    onCancelSnooze={
                      t.snoozedUntil ? () => void unsnooze(t) : undefined
                    }
                    onArchive={
                      inTrashView ? undefined : () => void archive(t)
                    }
                    onTrash={
                      inTrashView ? undefined : () => void trash(t)
                    }
                    {...rowMenuActions(t)}
                    dragKind="folder"
                    touch={phone}
                    onSelectionMenu={
                      rowInSelection(multiKeys, threadKey(t))
                        ? (x, y) => setSelectionMenu({ x, y })
                        : undefined
                    }
                  />
                ))}
              </div>
            ))}
        </div>
      </>
      <SelectionRowMenu at={selectionMenu} onClose={() => setSelectionMenu(null)} />
    </>
  );
}

/** The people view's rows: one per correspondent, pinned people first, then by day, with the person menu and its snooze times. */
export function PeopleRows() {
  const { archive, archivePerson, askDeleteForever, askPersonSnooze, chromeDark, clickStack, debouncedSearch, draftKeys, expandThreadRow, highlightTerms, inTrashView, isOpenThread, listDensity, listExpanded, listNarrow, listRowWide, multiKeys, onPersonSnoozeOpenChange, openFromStack, openPersonWindow, pendingTokens, personGroups, personMenuAt, personRows, personSnooze, personSnoozeSignal, purgeFrom, rowMenuActions, scheduledOpen, search, selectionMenu, setPersonMenuAt, setPersonSnooze, setSelectionMenu, snooze, stackState, t, togglePersonPin, toggleRead, trash, trashPerson, unsnooze } = usePeopleRowsState();
  return (
    <>
      <div className={listExpanded ? "pt-0" : "pt-2"}>
        <div>
          {!personRows.length ? (
            <p
              className={cn(
                "py-6 text-sm text-[var(--mail-chrome-muted)]",
                listNarrow
                  ? "px-1 text-center text-[10px] leading-tight"
                  : "px-5"
              )}
            >
              {/* Waiting is `pendingTokens`, not `refreshing` — the
                  latter is also true for a background poll, which would
                  call a finished search "Looking…" forever. */}
              {listNarrow
                ? search.trim()
                  ? pendingTokens.length
                    ? "…"
                    : "None"
                  : "Empty"
                : search.trim()
                  ? pendingTokens.length
                    ? `Looking for “${search.trim()}”…`
                    : `No people matching “${search.trim()}”.`
                  : (mailHasTeamRecords() && teamWord(t, "peopleEmpty")) ||
                    "No mail from your contacts right now."}
            </p>
          ) : null}
          {personGroups.map((group) => (
          <div
            key={group.pinned ? "pinned" : group.label || "people"}
            className={group.pinned ? "relative" : undefined}
          >
            {group.pinned ? (
              <>
                <div
                  aria-hidden
                  className="absolute bottom-0 left-0 top-0 w-0.5 bg-teal-400"
                />
                <PinnedHeading
                  listNarrow={listNarrow}
                  listExpanded={listExpanded}
                  label={t("pinned")}
                />
              </>
            ) : group.label && !listNarrow ? (
              <p
                className={cn(
                  "px-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-list-muted)]",
                  listExpanded ? "pt-2" : "pt-4"
                )}
              >
                {t(group.label as MailStringKey)}
              </p>
            ) : (
              <div
                className={
                  listNarrow
                    ? "pt-0.5"
                    : listExpanded
                      ? "pt-0"
                      : "pt-2"
                }
              />
            )}
          {group.items.map((row) => {
            const newest = row.threads[0];
            const personHasDraft = row.threads.some((t) =>
              draftKeys.has(threadDraftKey(t.account, t.threadId))
            );
            /* A clip when any conversation in the pile carries a file, as the
               thread rows show it; the pile hid it, and has:attachment looked wrong. */
            const personHasFile = row.threads.some((th) => th.hasAttachments);
            const personTitle = [
              row.name,
              newest.subject || newest.snippet,
              personHasDraft ? t("draft") : null,
              row.unread ? t("unread") : null,
            ]
              .filter(Boolean)
              .join(" — ");
            const { open: stackOpen, painted: paintedNow } = stackState(row);
            const painted = paintedNow && !scheduledOpen;
            return (
              <React.Fragment key={row.key}>
              <PersonListRow archivePerson={archivePerson} chromeDark={chromeDark} clickStack={clickStack} debouncedSearch={debouncedSearch} highlightTerms={highlightTerms} listDensity={listDensity} listExpanded={listExpanded} listNarrow={listNarrow} listRowWide={listRowWide} multiKeys={multiKeys} newest={newest} openPersonWindow={openPersonWindow} painted={painted} personHasDraft={personHasDraft} personHasFile={personHasFile} personTitle={personTitle} purgeFrom={purgeFrom} row={row} setPersonMenuAt={setPersonMenuAt} setSelectionMenu={setSelectionMenu} stackOpen={stackOpen} t={t} togglePersonPin={togglePersonPin} toggleRead={toggleRead} />
              {stackOpen ? (
                <StackThreads
                  threads={row.threads}
                  isOpen={isOpenThread}
                  onOpen={(th) => openFromStack(row, th)}
                  onExpand={expandThreadRow}
                  onNavy={chromeDark}
                  highlight={highlightTerms}
                  withYear={Boolean(debouncedSearch)}
                />
              ) : null}
              </React.Fragment>
            );
          })}
          </div>
          ))}
        </div>
        {/*
          What a right-click on a person offers.

          Drawn once for the list, not once per row: one menu is up at
          a time, and the row it belongs to is looked up here so a
          list that reloads under it cannot leave it pointing at a
          pile that has changed.
        */}
        {(() => {
          if (!personMenuAt) return null;
          const row = personRows.find((r) => r.key === personMenuAt.key);
          if (!row) return null;
          const newest = row.threads[0];
          const close = () => setPersonMenuAt(null);
          // One thread is one conversation, and the conversation's own
          // menu answers everything about it. No second menu that says
          // "all" about a pile of one.
          if (row.threads.length === 1) {
            return (
              <ThreadRowMenu
                account={newest.account}
                x={personMenuAt.x}
                y={personMenuAt.y}
                unread={Boolean(newest.unread)}
                // Pin here is the person, as on the hover pin: a pinned
                // conversation would not move anyone in this view.
                pinned={isMailPersonPinned(row.key)}
                snoozed={Boolean(newest.snoozedUntil)}
                canReplyAll={(newest.externalParticipants?.length ?? 0) > 1}
                onSnooze={() =>
                  askPersonSnooze(newest, personMenuAt.x, personMenuAt.y)
                }
                onCancelSnooze={
                  newest.snoozedUntil ? () => void unsnooze(newest) : undefined
                }
                onToggleRead={() => void toggleRead([newest], "it")}
                onTogglePin={() => togglePersonPin(row)}
                onArchive={inTrashView ? undefined : () => void archive(newest)}
                onTrash={inTrashView ? undefined : () => void trash(newest)}
                {...rowMenuActions(newest)}
                onDismiss={close}
              />
            );
          }
          return (
            <PersonRowMenu
              x={personMenuAt.x}
              y={personMenuAt.y}
              name={row.name}
              count={row.threads.length}
              unread={row.threads.some((th) => th.unread)}
              pinned={isMailPersonPinned(row.key)}
              snoozed={row.threads.some((th) => th.snoozedUntil)}
              onToggleRead={() => void toggleRead(row.threads, row.name)}
              // Every conversation in the pile, as the line says.
              onSnooze={() =>
                askPersonSnooze(newest, personMenuAt.x, personMenuAt.y, row.threads)
              }
              onCancelSnooze={() => {
                for (const th of row.threads) if (th.snoozedUntil) void unsnooze(th);
              }}
              onTogglePin={() => togglePersonPin(row)}
              onPopOut={() => rowMenuActions(newest).onAction("popOut")}
              // In Trash the mail is deleted already: only "forever" is left.
              onArchiveAll={
                purgeFrom === "trash" ? undefined : () => void archivePerson(row)
              }
              onDeleteAll={
                purgeFrom === "trash" ? undefined : () => void trashPerson(row)
              }
              onDeleteForever={
                askDeleteForever ? () => askDeleteForever(row.threads) : undefined
              }
              onDismiss={close}
            />
          );
        })()}
        {/*
          The times, hung where the menu was.

          The menu closes as it opens this, so the picker cannot live
          inside it. Its trigger is a point rather than a button: the
          thing the reader pressed has already gone.
        */}
        {personSnooze ? (
          <SnoozeMenu
            key={threadKey(personSnooze.thread)}
            onSnooze={(untilIso) => {
              for (const th of personSnooze.threads) void snooze(th, untilIso);
              setPersonSnooze(null);
            }}
            onCancelSnooze={
              personSnooze.threads.some((th) => th.snoozedUntil)
                ? () => {
                    for (const th of personSnooze.threads) if (th.snoozedUntil) void unsnooze(th);
                    setPersonSnooze(null);
                  }
                : undefined
            }
            // One time to show only when there is one conversation.
            currentUntil={personSnooze.threads.length === 1 ? personSnooze.thread.snoozedUntil : undefined}
            openSignal={personSnoozeSignal}
            onOpenChange={onPersonSnoozeOpenChange}
            trigger={
              <span
                aria-hidden
                className="fixed h-px w-px"
                style={{ left: personSnooze.x, top: personSnooze.y }}
              />
            }
          />
        ) : null}
      </div>
      <SelectionRowMenu at={selectionMenu} onClose={() => setSelectionMenu(null)} />
    </>
  );
}

/** One person in the people view: the stack of their conversations, and the row that opens them. */
function PersonListRow({
  archivePerson,
  chromeDark,
  clickStack,
  debouncedSearch,
  highlightTerms,
  listDensity,
  listExpanded,
  listNarrow,
  listRowWide,
  multiKeys,
  newest,
  openPersonWindow,
  painted,
  personHasDraft,
  personHasFile,
  personTitle,
  purgeFrom,
  row,
  setPersonMenuAt,
  setSelectionMenu,
  stackOpen,
  t,
  togglePersonPin,
  toggleRead,
}: {
  archivePerson: ReturnType<typeof usePeopleRowsState>["archivePerson"];
  chromeDark: ReturnType<typeof usePeopleRowsState>["chromeDark"];
  clickStack: ReturnType<typeof usePeopleRowsState>["clickStack"];
  debouncedSearch: ReturnType<typeof usePeopleRowsState>["debouncedSearch"];
  highlightTerms: ReturnType<typeof usePeopleRowsState>["highlightTerms"];
  listDensity: ReturnType<typeof usePeopleRowsState>["listDensity"];
  listExpanded: ReturnType<typeof usePeopleRowsState>["listExpanded"];
  listNarrow: ReturnType<typeof usePeopleRowsState>["listNarrow"];
  listRowWide: ReturnType<typeof usePeopleRowsState>["listRowWide"];
  multiKeys: ReturnType<typeof usePeopleRowsState>["multiKeys"];
  newest: MailThreadSummary;
  openPersonWindow: ReturnType<typeof usePeopleRowsState>["openPersonWindow"];
  painted: boolean;
  personHasDraft: boolean;
  personHasFile: boolean;
  personTitle: string;
  purgeFrom: ReturnType<typeof usePeopleRowsState>["purgeFrom"];
  row: PersonRow;
  setPersonMenuAt: ReturnType<typeof usePeopleRowsState>["setPersonMenuAt"];
  setSelectionMenu: ReturnType<typeof usePeopleRowsState>["setSelectionMenu"];
  stackOpen: boolean;
  t: ReturnType<typeof usePeopleRowsState>["t"];
  togglePersonPin: ReturnType<typeof usePeopleRowsState>["togglePersonPin"];
  toggleRead: ReturnType<typeof usePeopleRowsState>["toggleRead"];
}) {
  return (
    <div
                // The threads this row holds, newest first, for the glide
                // when Stacks is switched (lib/mail/stack-glide).
                data-glide-keys={row.threads.map((th) => threadKey(th)).join(" ")}
                onDoubleClick={(e) => {
                  // The row's own control is the button that fills
                  // it, so that is the container; a double click on
                  // the actions beside it is two presses of those.
                  const control =
                    e.currentTarget.querySelector<HTMLElement>(
                      "[data-person-key]"
                    );
                  if (isInteractiveDoubleClickTarget(e.target, control)) {
                    return;
                  }
                  e.preventDefault();
                  openPersonWindow(row);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // One of a selection: the menu acts on all of it.
                  if (rowInSelection(multiKeys, row.key)) {
                    setSelectionMenu({ x: e.clientX, y: e.clientY });
                    return;
                  }
                  setPersonMenuAt({
                    key: row.key,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                className={cn(
                  // Relative: the hover actions float over its right end.
                  "group relative flex w-full transition-colors",
                  ROW_LINE,
                  listNarrow
                    ? "items-center justify-center px-1 py-1.5"
                    : listRowWide && listDensity !== "compact"
                      ? cn("items-start pr-[18px] py-2", ROW_PAD_LEFT)
                    : listRowWide
                      ? cn("items-center pr-[18px] py-1.5", ROW_PAD_LEFT)
                    : listDensity !== "compact"
                      ? cn("items-start pr-[18px] py-2.5", ROW_PAD_LEFT)
                      : cn("items-center pr-[18px] py-1.5", ROW_PAD_LEFT),
                  /* No fill for a stack only because it is open. A fill
                     reads as selected beside the row that is selected.
                     The open threads under it say it is open. */
                  !listExpanded && (painted || multiKeys.has(row.key))
                    ? // The open person, marked as an open thread is: a card.
                      OPEN_ROW_CARD
                    : "hover:bg-[var(--mail-chrome-hover)] hover:[--mail-person-stack-ring:var(--mail-chrome-hover)]"
                )}
              >
              <button
                type="button"
                data-person-key={row.key}
                title={listNarrow ? personTitle : undefined}
                aria-label={listNarrow ? personTitle : undefined}
                onClick={(e) => clickStack(row, e)}
                className={cn(
                  "flex min-w-0 flex-1 text-left",
                  listNarrow
                    ? "items-center justify-center"
                    : listRowWide && listDensity !== "compact"
                      ? "items-start gap-3"
                      : listRowWide
                        ? "items-center gap-3"
                      : listDensity !== "compact"
                        ? "items-start gap-3"
                        : "items-center gap-2.5"
                )}
              >
                {/* Unread in the gutter, as on a thread row; narrow, on the face. */}
                {listNarrow ? null : (
                  <UnreadGutterDot
                    unread={row.unread}
                    top={listDensity === "compact" ? undefined : listRowWide ? WIDE_FACE_DOT_TOP : FACE_DOT_TOP}
                  />
                )}
                <PersonAvatar
                  row={row}
                  unreadDot={listNarrow}
                  onNavy={chromeDark}
                  size={
                    listNarrow
                      ? 36
                      : listRowWide || listDensity !== "compact"
                        ? 36
                        : 28
                  }
                />
                {listNarrow ? null : listRowWide ? (
                listDensity !== "compact" ? (
                <PersonWideBody
                  name={row.name}
                  threads={row.threads}
                  open={stackOpen}
                  hasDraft={personHasDraft}
                  hasFile={personHasFile}
                  highlight={highlightTerms}
                  onNavy={chromeDark}
                  time={
                    <>
                      <HiddenAccountMark accounts={row.threads.map((th) => th.account)} />
                      {rowTime(row.lastAt, { withYear: Boolean(debouncedSearch) })}
                    </>
                  }
                />
                ) : (
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex w-[14rem] shrink-0 items-center gap-2">
                      <span className={cn("min-w-0 truncate text-sm text-[var(--mail-chrome-fg)]", row.unread && "font-semibold")}>
                        <Highlighted text={row.name} terms={highlightTerms} onNavy={chromeDark} />
                      </span>
                    </span>
                    {personHasDraft ? <DraftBadge /> : null}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="text-[var(--mail-chrome-fg)]">
                        <Highlighted text={newest.subject} terms={highlightTerms} onNavy={chromeDark} />
                      </span>
                      {listDensity === "compact" && newest.snippet ? (
                        <span className="text-[var(--mail-chrome-muted)]">
                          {" — "}
                          {personHasFile ? (
                        <Paperclip
                          className="mr-1 inline h-3 w-3 shrink-0 -translate-y-px stroke-[1.5] text-[var(--mail-chrome-muted)] opacity-80"
                          aria-label={t("hasAttachments")}
                        />
                      ) : null}
                          <Highlighted text={newest.snippet} terms={highlightTerms} onNavy={chromeDark} />
                        </span>
                      ) : null}
                    </span>
                    {/* Invisible on hover, not gone: it keeps its room, and
                        the actions float over it (PersonRowActions), so
                        nothing in the row moves when they show. The
                        count goes with the time. */}
                    <PersonCount threads={row.threads} open={stackOpen} />
                    <span className="min-w-[4.5rem] shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-[var(--mail-list-muted)] group-hover:invisible">
                      <HiddenAccountMark accounts={row.threads.map((th) => th.account)} />
                      {rowTime(row.lastAt, {
                        withYear: Boolean(debouncedSearch),
                      })}
                    </span>
                  </span>
                  {listDensity === "compact" || !newest.snippet ? null : (
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="w-[14rem] shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-xs text-[var(--mail-chrome-muted)]">
                        {personHasFile ? (
                        <Paperclip
                          className="mr-1 inline h-3 w-3 shrink-0 -translate-y-px stroke-[1.5] text-[var(--mail-chrome-muted)] opacity-80"
                          aria-label={t("hasAttachments")}
                        />
                      ) : null}
                        <Highlighted text={newest.snippet} terms={highlightTerms} onNavy={chromeDark} />
                      </span>
                      <span className="w-[4.5rem] shrink-0 group-hover:hidden" aria-hidden />
                    </span>
                  )}
                </span>
                )
                ) : (
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className={cn("min-w-0 truncate text-sm text-[var(--mail-chrome-fg)]", row.unread && "font-semibold")}>
                        <Highlighted text={row.name} terms={highlightTerms} onNavy={chromeDark} />
                      </span>
                      <PersonCount threads={row.threads} open={stackOpen} />
                      {personHasDraft ? <DraftBadge /> : null}
                    </span>
                    {/* The time, away on hover for the actions. As wide a
                        slot as a thread row keeps for them, so a name is as
                        long with Stacks on as off. */}
                    <span className="flex min-w-[5rem] shrink-0 items-center justify-end gap-2 group-hover:invisible">
                      <span className="text-xs text-[var(--mail-list-muted)]">
                        <HiddenAccountMark accounts={row.threads.map((th) => th.account)} />
                        {rowTime(row.lastAt, {
                          withYear: Boolean(debouncedSearch),
                        })}
                      </span>
                    </span>
                  </span>
                  {listDensity === "compact" ? null : (
                    // The newest thread's subject, as a thread row shows it.
                    <span
                      className={cn(
                        "block truncate text-sm",
                        row.unread && "font-semibold",
                        chromeDark ? "text-white/85" : "text-stone-700"
                      )}
                    >
                      <Highlighted text={newest.subject} terms={highlightTerms} onNavy={chromeDark} />
                    </span>
                  )}
                  {listDensity === "compact" || !newest.snippet ? null : (
                    <span className="mt-px flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs text-[var(--mail-chrome-muted)]">
                        {personHasFile ? (
                        <Paperclip
                          className="mr-1 inline h-3 w-3 shrink-0 -translate-y-px stroke-[1.5] text-[var(--mail-chrome-muted)] opacity-80"
                          aria-label={t("hasAttachments")}
                        />
                      ) : null}
                        <Highlighted text={newest.snippet} terms={highlightTerms} onNavy={chromeDark} />
                      </span>
                    </span>
                  )}
                </span>
                )}
              </button>
              {listNarrow ? null : (
                <PersonRowActions
                  // On the name's line: its middle is the row's padding and half a line down.
                  className={
                    listDensity === "compact"
                      ? undefined
                      : listRowWide
                        ? "top-[18px]"
                        : "top-5"
                  }
                  row={row}
                  pinned={isMailPersonPinned(row.key)}
                  onNavy={chromeDark}
                  onTogglePin={() => togglePersonPin(row)}
                  onArchive={
                    purgeFrom === "trash" ? undefined : () => void archivePerson(row)
                  }
                  onToggleRead={() =>
                    void toggleRead(row.threads, row.name)
                  }
                />
              )}
              </div>
  );
}


/** What stands above the rows: the search still running, first reads, stopped syncs, mailboxes the list is missing, the delete-forever question, and search notes. */
export function ListNotices() {
  const t = useMailT();
  const { cancelPurge, purgeAsk, runPurge } = usePageActions();
  const { debouncedSearch, loadingList, pinnedThreads, searchingMailboxCount, threads, unreadable } = usePageList();
  const { firstReads, loadThreads, refreshing, syncPaused } = usePageSync();
  const { isOutlookAccount } = usePageAccounts();
  const { listNarrow } = usePageLayout();
  const { offline, waiting } = useOffline();
  return (
    <>
      {/*
        While a search is actually running, whatever is already on screen.
        Not only when the list is empty, which is the one time a reader
        does not need telling. With rows from the last query still
        showing, a new one looks like nothing is happening.

        `refreshing`, not `loadingList`: a search typed over rows already
        on screen keeps those rows and never sets loadingList at all. With
        loadingList, the banner misses exactly the common case. The reader
        sees a plausible list and no sign that anything is still out. Then
        a slow mailbox's answer lands in one late lump as if from nowhere.
        `refreshing` holds until the last mailbox has answered.

        A search is not a page loading: it is every mailbox being asked on
        its own, over the network, by its own provider. That is why it
        takes as long as it does and why rows land in bursts.
      */}
      {/* Not before the first row. Until then the list below is saying
          the same thing in more words — one wait, said once. This one
          is for what is still out *while* there is something to read. */}
      {/* The first read of a mailbox, for as long as it is not complete.
          It takes hours, across many sittings, and the list grows as it
          goes. The line stays up in every state — reading, waiting to try
          again, stopped — and says which, at every width of the list. If
          it shows only while the phase is "full" and the list is wide, a
          reader sees it go and takes the read for finished. */}
      {firstReads.map((line) => (
        <MailFirstReadLine
          key={`${line.account}|${line.folder}`}
          line={line}
          narrow={listNarrow}
          onReconnect={() =>
            window.dispatchEvent(
              new CustomEvent<MailReconnectRequest>(MAIL_RECONNECT_REQUEST, {
                detail: {
                  provider: mailProviderFor(line.account, isOutlookAccount),
                  email: line.account,
                },
              })
            )
          }
        />
      ))}
      {/* Offline: one line for every mailbox, at every width, with what
          waits to be sent. It stands in for each mailbox's own network line. */}
      <OfflineLine offline={offline} waiting={waiting} t={t} />
      {/* A sync that stopped on a mailbox whose copy is complete. */}
      {!listNarrow
        ? syncPaused
            .filter((s) => !(offline && syncPauseKind(s.lastError) === "offline"))
            .map((s) => (
              <div
                key={`${s.account}|${s.folder}`}
                className="border-b border-[var(--mail-chrome-border)] px-5 pb-2.5 pt-2.5"
              >
                {syncPauseKind(s.lastError) === "signIn" ? (
                  /* The sign-in is refused: a grant revoked, a password
                     changed, a grant short of the full-mail scope. Only
                     after a fresh token was refused too (sync.rs,
                     outlook-sync.ts), so a token that merely expired
                     while the computer slept never shows this. Said in
                     the reader's terms, with the one thing that mends it. */
                  <ListNotice
                    title={s.account}
                    action={
                      <ListNoticeButton onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent<MailReconnectRequest>(MAIL_RECONNECT_REQUEST, {
                              detail: {
                                provider: mailProviderFor(s.account, isOutlookAccount),
                                email: s.account,
                              },
                            })
                          )}>
                        {t("reconnect")}
                      </ListNoticeButton>
                    }
                  >
                    {t("syncNeedsReconnect", { account: s.account })}
                  </ListNotice>
                ) : syncPauseKind(s.lastError) === "offline" ? (
                  /* The mail server did not answer. Nothing is wrong
                     with the account and there is nothing to press: the
                     worker tries again by itself. The worker's own words
                     are in the log, not on a tooltip. On a tooltip, a
                     reader hovers and meets a sentence in English about
                     seconds and servers. */
                  <ListNotice
                    kind="offline"
                    /* The mailbox's own provider, not Gmail for
                       everybody. If not, an Outlook account is told that
                       Mail cannot reach Gmail for it. */
                    title={t("syncOffline", {
                      provider: mailProviderLabel(mailProviderFor(s.account, isOutlookAccount)),
                      account: s.account,
                    })}
                  >
                    {t("syncOfflineHelp")}
                  </ListNotice>
                ) : (
                  /* Something else stopped it. Said in plain words first,
                     with the one thing the reader can try; the worker's
                     reason comes after, small, for whoever is asked. */
                  <ListNotice
                    title={t("syncPaused", { account: s.account })}
                    action={
                      <ListNoticeButton onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent<MailReconnectRequest>(MAIL_RECONNECT_REQUEST, {
                              detail: {
                                provider: mailProviderFor(s.account, isOutlookAccount),
                                email: s.account,
                              },
                            })
                          )}>
                        {t("reconnect")}
                      </ListNoticeButton>
                    }
                  >
                    <p>{t("syncPausedHelp")}</p>
                    {s.lastError ? (
                      <p className="mt-0.5 break-words text-[11px] text-[var(--mail-chrome-faint)]">
                        {t("syncPausedDetails", { reason: s.lastError })}
                      </p>
                    ) : null}
                  </ListNotice>
                )}
              </div>
            ))
        : null}
      {/* Which mailboxes the list is missing, and why. Above the rows,
          for as long as it is true: without this the rows that came
          back read as the whole answer. */}
      {unreadable.length && !listNarrow ? (
        <div className="space-y-2 border-b border-[var(--mail-chrome-border)] px-5 pb-2.5 pt-3">
          {unreadable.map((box, index) => (
            <ListNotice
              key={box.email}
              title={t("mailboxUnreadable", { email: box.email })}
              action={
                // One Retry reads every mailbox again, so one button.
                index === unreadable.length - 1 ? (
                  <ListNoticeButton onClick={() => void loadThreads({ fresh: true })}>
                    {t("retry")}
                  </ListNoticeButton>
                ) : undefined
              }
            >
              {box.reason}
            </ListNotice>
          ))}
        </div>
      ) : null}
      {/*
        Trash and Junk only, and only with something in them. Not while a
        search is on: the button empties the folder, not the results, and
        beside a list of results it would read as the second.
      */}
      {purgeAsk ? (
        <ConfirmPurgeDialog
          title={t("deleteForeverTitle", {
            what: t(purgeAsk.count === 1 ? "conversationOne" : "conversationsMany", {
              count: purgeAsk.count,
            }),
          })}
          /*
            Says where the mail goes from, by name. "Deleted" in a mail
            app on a computer can read as "removed from this computer",
            and this is the one delete where that mistake costs the mail.
          */
          body={t(
            purgeAsk.targets.length === 1 ? "deleteForeverBodyOne" : "deleteForeverBodyMany",
            {
              provider: (() => {
                const outlook = purgeAsk.targets.filter((x) => isOutlookAccount(x.account)).length;
                if (outlook === 0) return "Gmail";
                if (outlook === purgeAsk.targets.length) return "Outlook";
                return t("providerGmailAndOutlook");
              })(),
            }
          )}
          note={
            purgeAsk.targets.length > purgeAsk.count ? t("deleteForeverCopies") : undefined
          }
          confirmLabel={t("deleteForever")}
          cancelLabel={t("cancel")}
          onConfirm={runPurge}
          onCancel={cancelPurge}
        />
      ) : null}
      {debouncedSearch &&
      (loadingList || refreshing) &&
      !listNarrow &&
      (threads.length > 0 || pinnedThreads.length > 0) ? (
        /*
          Chrome colors, not white. White suits only a list on the navy
          chrome. On the cream chrome it is white text on near-white: a
          blank band above the results, with the spinner invisible in it
          too. That looks like a search that lost its earlier rows and left
          a hole where they were.
        */
        <div className="border-b border-[var(--mail-chrome-border)] px-5 pb-2 pt-3">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--mail-chrome-muted)]">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            {searchingMailboxCount === 1
              ? t("searchingMailbox")
              : t("searchingMailboxes", {
                  count: searchingMailboxCount,
                })}
          </p>
          <p className="pt-0.5 text-[11px] leading-snug text-[var(--mail-chrome-faint)]">
            {t("searchingHint")}
          </p>
        </div>
      ) : null}
    </>
  );
}

/**
 * The heading over pinned rows: the word and a pin, or the pin alone in a
 * narrow list. Pinned threads and pinned people share it, so the two views
 * mark a pin the same way.
 */
/**
 * The Outbox: what is held for later, what is being sent, and what the
 * server refused. Its own view, opened from the folder rail while it holds
 * anything.
 */
export function OutboxGroup({ onTop = false }: { onTop?: boolean }) {
  const t = useMailT();
  const pageList = usePageList();
  const openHeld = useOpenScheduledMessage();
  const { listNarrow, listExpanded, chromeDark } = usePageLayout();
  const { actOnHeld } = usePageActions();
  const { setSelected } = usePageReader();
  const { accountEmails, mailboxScopeEmails } = usePageAccounts();
  // Above the list, on one mailbox's tab: that mailbox's. On All: every
  // one, a hidden mailbox's too — hiding a mailbox holds its incoming mail,
  // and what it will send is still the reader's to see.
  const oneMailbox = onTop && !isMailboxScopeAll(mailboxScopeEmails, accountEmails);
  const inView = new Set(mailboxScopeEmails.map((e) => e.trim().toLowerCase()));
  const heldMessages = oneMailbox
    ? pageList.heldMessages.filter((held) => inView.has(held.account.trim().toLowerCase()))
    : pageList.heldMessages;
  const [menu, setMenu] = React.useState<OutboxMenuAt | null>(null);
  // A reply opens its thread, where it stands as a dashed bubble. A new
  // message has no thread yet: it opens on a page of its own.
  const open = (held: MailScheduledMessage) => {
    // Still in its Undo seconds: nothing is scheduled to open yet.
    if (isPendingScheduledId(held.id)) return;
    if (!held.threadId) {
      setSelected(null);
      openScheduledMessage(held);
      return;
    }
    setSelected({ account: held.account, threadId: held.threadId, inPeople: true });
  };
  return (
    <>
          {heldMessages.length && !listNarrow ? (
            <div>
              <p className={cn(
                "px-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-list-muted)]",
                listExpanded ? "pt-2" : "pt-4"
              )}>
                {t(onTop ? "scheduledGroup" : "outbox")} · {heldMessages.length}
              </p>
              {/* The Outbox: what is on its way out, until it has gone.
                  A message waiting for its time, one being sent, and
                  one the server refused, which stays here with the
                  server's words and a way to try again or let it go —
                  rather than vanishing with the only copy of it. */}
              {heldMessages.map((held) => (
                <button
                  key={`${held.account}|${held.id}`}
                  type="button"
                  className={cn(
                    "relative flex w-full items-center gap-3 py-2 pl-5 pr-[18px] text-left",
                    // Open in the reader: marked as an open thread is, a card.
                    openHeld?.id === held.id && openHeld.account === held.account
                      ? OPEN_ROW_CARD
                      : chromeDark
                        ? "hover:bg-white/5"
                        : "hover:bg-[var(--mail-chrome-hover)]"
                  )}
                  title={held.status === "failed" ? held.error : undefined}
                  onClick={() => open(held)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (isPendingScheduledId(held.id)) return;
                    setMenu({ held, x: event.clientX, y: event.clientY });
                  }}
                >
                  {held.missed ? (
                    // Missed, not broken: the clock, as a waiting one has.
                    <Clock className="h-3.5 w-3.5 shrink-0 text-amber-600/80" aria-hidden />
                  ) : held.status === "failed" ? (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
                  ) : held.status === "sending" ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-teal-700/75" aria-hidden />
                  ) : (
                    <Clock className="h-3.5 w-3.5 shrink-0 text-teal-700/75" aria-hidden />
                  )}
                  <span
                    className={cn(
                      "max-w-[38%] shrink-0 truncate text-sm font-semibold",
                      chromeDark ? "text-white" : "text-stone-900"
                    )}
                  >
                    {held.toName}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      chromeDark ? "text-white/45" : "text-[#908985]"
                    )}
                  >
                    {/* A missed one says so in words, where its subject was:
                        the dialog asked once, and this is what is left. */}
                    {held.missed
                      ? t("missedRow", { when: missedWhen(held.sendAt, t) })
                      : held.subject || "(no subject)"}
                  </span>
                  {/* The time, in the list's own grey, as a thread row's
                      date: the teal clock already says it is waiting. A
                      failed one shows its two ways out instead. */}
                  {held.missed ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
                      <RowAction tone="teal" onAct={() => void actOnHeld(held, "sendNow")}>
                        {t("sendNow")}
                      </RowAction>
                      {/* Its page has Change time; a menu cannot open inside the row. */}
                      {held.reschedulable ? (
                        <RowAction tone="grey" onAct={() => open(held)}>
                          {t("reschedule")}
                        </RowAction>
                      ) : null}
                    </span>
                  ) : held.status === "failed" ? (
                    <span className="flex shrink-0 items-center gap-2 text-xs font-semibold">
                      <span className="text-amber-700">{t("notSent")}</span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="rounded px-1.5 py-0.5 text-teal-700 hover:bg-teal-50"
                        onClick={(e) => {
                          e.stopPropagation();
                          void actOnHeld(held, "sendNow");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            void actOnHeld(held, "sendNow");
                          }
                        }}
                      >
                        {t("tryAgain")}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        className="rounded px-1.5 py-0.5 text-stone-500 hover:bg-stone-100 hover:text-red-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          void actOnHeld(held, "cancel");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            void actOnHeld(held, "cancel");
                          }
                        }}
                      >
                        {/* A scheduled draft let go stays in Drafts. */}
                        {t(isScheduledDraftId(held.id) ? "keepAsDraft" : "delete")}
                      </span>
                    </span>
                  ) : held.status === "sending" ? (
                    <span className="shrink-0 text-xs font-semibold text-teal-700/90">
                      {t("sendingNow")}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        "shrink-0 text-xs tabular-nums",
                        chromeDark ? "text-white/45" : "text-[#908985]"
                      )}
                    >
                      {formatSnoozeWakeLabel(held.sendAt)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
          {menu ? (
            <OutboxRowMenu
              at={menu}
              onOpen={open}
              onAct={(held, action) => void actOnHeld(held, action)}
              onDismiss={() => setMenu(null)}
            />
          ) : null}
    </>
  );
}

function PinnedHeading({
  listNarrow,
  listExpanded,
  label,
}: {
  listNarrow: boolean;
  listExpanded: boolean;
  label: string;
}) {
  if (listNarrow) {
    return (
      <div className="flex justify-center pb-0.5 pt-2" title={label}>
        <Pin
          className="h-3 w-3 text-[var(--mail-list-muted)]"
          aria-label={label}
        />
      </div>
    );
  }
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 px-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-list-muted)]",
        listExpanded ? "pt-2" : "pt-3"
      )}
    >
      {/* Inherits, so it stays the colour of the word it sits beside
          rather than picking its own. */}
      <Pin className="h-3 w-3" aria-hidden />
      {label}
    </p>
  );
}

/** An action on a Scheduled row: a span, because the row itself is a button. */
function RowAction({
  tone,
  onAct,
  children,
}: {
  tone: "teal" | "grey";
  onAct: () => void;
  children: React.ReactNode;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      className={cn(
        "rounded px-1.5 py-0.5",
        tone === "teal" ? "text-teal-700 hover:bg-teal-50" : "text-stone-500 hover:bg-stone-100 hover:text-stone-700"
      )}
      onClick={(e) => {
        e.stopPropagation();
        onAct();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onAct();
        }
      }}
    >
      {children}
    </span>
  );
}

/** What the people view reads from the page, and which people are unfolded into their conversations. */
export function usePeopleRowsState() {
  const t = useMailT();
  const { archive, archivePerson, askDeleteForever, askPersonSnooze, onPersonSnoozeOpenChange, personMenuAt, personSnooze, personSnoozeSignal, purgeFrom, rowMenuActions, setPersonMenuAt, setPersonSnooze, snooze, togglePersonPin, toggleRead, trash, trashPerson, unsnooze } = usePageActions();
  const { chromeDark, listDensity, listExpanded, listNarrow, listRowWide } = usePageLayout();
  const { clearMultiSelection, debouncedSearch, highlightTerms, inTrashView, multiKeys, pendingTokens, personGroups, personRows, search } = usePageList();
  const { clickPersonRow, openPersonWindow, expandThreadRow, paintedPersonKey, openThread, selected: selectedThread, setSelectedPersonKey } = usePageReader();
  const { draftKeys } = usePageCompose();
  // A scheduled message open in the reader is what is selected (ThreadRows).
  const scheduledOpen = Boolean(useOpenScheduledMessage());
  const selected = scheduledOpen ? null : selectedThread;
  const [selectionMenu, setSelectionMenu] = React.useState<SelectionMenuAt | null>(null);
  /*
    The stacks open in the list (person-stack.tsx). A click on a closed
    stack unfolds it and opens its newest thread; on an open one, folds it.
    With a modifier key a click picks rows, as on any row.
  */
  const [openStacks, setOpenStacks] = React.useState<ReadonlySet<string>>(() => new Set());
  const toggleStack = (key: string) =>
    setOpenStacks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isOpenThread = (th: { account: string; threadId: string }) =>
    selected != null && selected.account === th.account && selected.threadId === th.threadId;
  const openFromStack = (row: PersonRow, th: PersonRow["threads"][number]) => {
    clearMultiSelection();
    setSelectedPersonKey(row.key);
    openThread(th);
  };
  /** A stack in the list, and open. Open, the thread's own row is marked, not the person's. */
  const stackState = (row: PersonRow) => {
    const stack = row.threads.length > 1 && !listNarrow;
    const open = stack && openStacks.has(row.key);
    return { open, painted: paintedPersonKey === row.key && !open };
  };
  const clickStack = (row: PersonRow, e: React.MouseEvent) => {
    if (row.threads.length < 2 || e.metaKey || e.ctrlKey || e.shiftKey) return clickPersonRow(row, e);
    toggleStack(row.key);
    if (!openStacks.has(row.key)) openFromStack(row, row.threads[0]);
    /*
      Folded, the row is the person again, and so is the reader: their
      pane, with every thread. If the newest thread stays open behind the
      folded row, the archive key takes that one thread when the reader
      means all of them.
    */
    else clickPersonRow(row, e);
  };
  return { archive, archivePerson, askDeleteForever, askPersonSnooze, chromeDark, clickStack, debouncedSearch, draftKeys, expandThreadRow, highlightTerms, inTrashView, isOpenThread, listDensity, listExpanded, listNarrow, listRowWide, multiKeys, onPersonSnoozeOpenChange, openFromStack, openPersonWindow, pendingTokens, personGroups, personMenuAt, personRows, personSnooze, personSnoozeSignal, purgeFrom, rowMenuActions, scheduledOpen, search, selectionMenu, setPersonMenuAt, setPersonSnooze, setSelectionMenu, snooze, stackState, t, togglePersonPin, toggleRead, trash, trashPerson, unsnooze };
}
