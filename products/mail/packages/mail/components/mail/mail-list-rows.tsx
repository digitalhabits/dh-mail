"use client";

/*
 * Parts of the thread list's markup (ThreadListColumn), moved out of
 * mail-thread-list.tsx.
 *
 * Each component takes the page's model (`m`, from useMailPage) and reads the
 * names it needs from it. The JSX is the list's own, word for word.
 */

import { isMailPersonPinned } from "@/lib/mail/person-pins";
import { syncPauseKind } from "@/lib/mail/sync-pause";
import { formatSnoozeWakeLabel, SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { ListNotice, ListNoticeButton } from "@/components/mail/ListNotice";
import { MailFirstReadLine } from "@/components/mail/MailFirstReadLine";
import { AlertTriangle, Clock, Loader2, Pin, Paperclip } from "lucide-react";
import { MAIL_RECONNECT_REQUEST, toast, type MailReconnectRequest } from "@/lib/mail/toast";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { unpinMailThread } from "@/lib/mail/pins";
import { threadDraftKey } from "@/lib/mail/local-drafts";
import { rowStandsFor, threadKey } from "@/lib/mail/thread-copies";
import { type MailStringKey } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";
import { rowTime } from "@/lib/mail/date-format";
import { PersonAvatar } from "@/components/mail/PersonAvatar";
import { PersonRowActions } from "@/components/mail/PersonRowActions";
import { Highlighted } from "@/components/mail/Highlighted";
import { ConfirmPurgeDialog } from "@/components/mail/ConfirmPurgeDialog";
import { ThreadListRow, ThreadRowMenu, PersonRowMenu, ThreadMessageCount, DraftBadge } from "@/components/mail/ThreadListRow";
import type { MailPageModel } from "@/components/mail/use-mail-page";

/** The thread view's rows: the pinned band, then the list by day. */
export function ThreadRows({
  m,

}: {
  m: MailPageModel;

}) {
  const {
    actOnHeld,
    archive,
    capturePinFlip,
    chromeDark,
    clickThreadRow,
    debouncedSearch,
    expandThreadRow,
    groups,
    heldMessages,
    highlightTerms,
    inTrashView,
    listDensity,
    listExpanded,
    listNarrow,
    listRowWide,
    multiKeys,
    phone,
    pinKeySet,
    pinnedThreads,
    rowMenuActions,
    selected,
    setSelected,
    showPinnedBand,
    snooze,
    t,
    togglePin,
    toggleRead,
    trash,
    unsnooze,
  } = m;
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
              {listNarrow ? (
                <div
                  className="flex justify-center pb-0.5 pt-2"
                  title={t("pinned")}
                >
                  <Pin
                    className="h-3 w-3 text-[var(--mail-chrome-faint)]"
                    aria-label={t("pinned")}
                  />
                </div>
              ) : (
                <p className={cn(
                  "flex items-center gap-1.5 px-5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-chrome-faint)]",
                  listExpanded ? "pt-2" : "pt-3"
                )}>
                  {/* Inherits, so it stays the colour of the word it
                      sits beside rather than picking its own. */}
                  <Pin className="h-3 w-3" aria-hidden />
                  {t("pinned")}
                </p>
              )}
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
                  />
                ))}
              </div>
            </div>
        ) : null}
        <div
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
          {heldMessages.length && !listNarrow ? (
            <div>
              <p className={cn(
                "px-5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-chrome-faint)]",
                listExpanded ? "pt-2" : "pt-4"
              )}>
                {t("outbox")} · {heldMessages.length}
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
                    "flex w-full items-center gap-3 px-5 py-2 text-left",
                    chromeDark ? "hover:bg-white/5" : "hover:bg-[#f4f1ec]"
                  )}
                  title={held.status === "failed" ? held.error : undefined}
                  onClick={() => {
                    if (!held.threadId) return;
                    setSelected({
                      account: held.account,
                      threadId: held.threadId,
                      inCrm: true,
                    });
                  }}
                >
                  {held.status === "failed" ? (
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
                    {held.subject || "(no subject)"}
                  </span>
                  {/* The time is the row's point, so it is the one
                      thing in it wearing a colour. A failed one wears
                      its two ways out instead. */}
                  {held.status === "failed" ? (
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
                        {t("delete")}
                      </span>
                    </span>
                  ) : held.status === "sending" ? (
                    <span className="shrink-0 text-xs font-semibold text-teal-700/90">
                      {t("sendingNow")}
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-teal-700/90">
                      {formatSnoozeWakeLabel(held.sendAt)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
          {groups.map((group) => (
              <div key={group.label || "results"}>
                {group.label && !listNarrow ? (
                  <p className={cn(
                    "px-5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-chrome-faint)]",
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
                  />
                ))}
              </div>
            ))}
        </div>
      </>
    </>
  );
}

/** The people view's rows: one per correspondent, pinned people first, then by day, with the person menu and its snooze times. */
export function PeopleRows({
  m,

}: {
  m: MailPageModel;

}) {
  const {
    archive,
    archivePerson,
    askDeleteForever,
    askPersonSnooze,
    chromeDark,
    clickPersonRow,
    debouncedSearch,
    draftKeys,
    highlightTerms,
    inTrashView,
    listDensity,
    listExpanded,
    listNarrow,
    listRowWide,
    multiKeys,
    onPersonSnoozeOpenChange,
    openPersonWindow,
    paintedPersonKey,
    pendingTokens,
    personGroups,
    personMenuAt,
    personRows,
    personSnooze,
    personSnoozeSignal,
    pinKeySet,
    purgeFrom,
    rowMenuActions,
    search,
    setPersonMenuAt,
    setPersonSnooze,
    snooze,
    t,
    togglePersonPin,
    togglePin,
    toggleRead,
    trash,
    trashPerson,
    unsnooze,
  } = m;
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
                  : mailUsesCrmPeople()
                    ? "No mail from CRM contacts right now."
                    : "No mail from your contacts right now."}
            </p>
          ) : null}
          {personGroups.map((group) => (
          <div key={group.label || "people"}>
            {group.label && !listNarrow ? (
              <p
                className={cn(
                  "px-5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-chrome-faint)]",
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
            return (
              <div
                key={row.key}
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
                  setPersonMenuAt({
                    key: row.key,
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
                className={cn(
                  "group flex w-full transition-colors",
                  listNarrow
                    ? "items-center justify-center px-1 py-1.5"
                    : listRowWide && listDensity !== "compact"
                      ? "items-start px-5 py-2"
                    : listRowWide
                      ? "items-center px-5 py-1.5"
                    : listDensity !== "compact"
                      ? "items-center px-5 py-2.5"
                      : "items-center px-5 py-1.5",
                  !listExpanded &&
                  (paintedPersonKey === row.key ||
                    multiKeys.has(row.key))
                    ? "bg-[var(--mail-chrome-selected)] [--mail-person-stack-ring:var(--mail-chrome-selected)]"
                    : "hover:bg-[var(--mail-chrome-hover)] hover:[--mail-person-stack-ring:var(--mail-chrome-hover)]"
                )}
              >
              <button
                type="button"
                data-person-key={row.key}
                title={listNarrow ? personTitle : undefined}
                aria-label={listNarrow ? personTitle : undefined}
                onClick={(e) => clickPersonRow(row, e)}
                className={cn(
                  "flex min-w-0 flex-1 text-left",
                  listNarrow
                    ? "items-center justify-center"
                    : listRowWide && listDensity !== "compact"
                      ? "items-start gap-3"
                      : listRowWide || listDensity !== "compact"
                        ? "items-center gap-3"
                        : "items-center gap-2.5"
                )}
              >
                <PersonAvatar
                  row={row}
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
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="w-[10rem] shrink-0 truncate text-sm font-semibold text-[var(--mail-chrome-fg)]">
                      <Highlighted text={row.name} terms={highlightTerms} onNavy={chromeDark} />
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
                    <ThreadMessageCount
                      count={row.threads.length}
                      label={`${row.threads.length} threads`}
                    />
                    {/* Gone on hover, not invisible: the actions beside
                        the row take its place, and a time that kept
                        its space cut the name to a letter. */}
                    <span className="w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-[var(--mail-chrome-faint)] group-hover:hidden">
                      {rowTime(row.lastAt, {
                        withYear: Boolean(debouncedSearch),
                      })}
                    </span>
                  </span>
                  {listDensity === "compact" || !newest.snippet ? null : (
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="w-[10rem] shrink-0" aria-hidden />
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
                ) : (
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-[var(--mail-chrome-fg)]">
                        <Highlighted text={row.name} terms={highlightTerms} onNavy={chromeDark} />
                      </span>
                      {personHasDraft ? <DraftBadge /> : null}
                      {listDensity === "compact" &&
                      row.threads.length > 1 ? (
                        <ThreadMessageCount
                          count={row.threads.length}
                          label={`${row.threads.length} threads`}
                        />
                      ) : null}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--mail-chrome-faint)] group-hover:hidden">
                      {rowTime(row.lastAt, {
                        withYear: Boolean(debouncedSearch),
                      })}
                    </span>
                  </span>
                  {listDensity === "compact" ? null : (
                    <span className="mt-0.5 flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-xs text-[var(--mail-chrome-muted)]">
                        {personHasFile ? (
                        <Paperclip
                          className="mr-1 inline h-3 w-3 shrink-0 -translate-y-px stroke-[1.5] text-[var(--mail-chrome-muted)] opacity-80"
                          aria-label={t("hasAttachments")}
                        />
                      ) : null}
                        <Highlighted text={newest.snippet || newest.subject} terms={highlightTerms} onNavy={chromeDark} />
                      </span>
                      <ThreadMessageCount
                        count={row.threads.length}
                        label={`${row.threads.length} threads`}
                      />
                    </span>
                  )}
                </span>
                )}
              </button>
              {listNarrow ? null : (
                <PersonRowActions
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
                x={personMenuAt.x}
                y={personMenuAt.y}
                unread={Boolean(newest.unread)}
                pinned={pinKeySet.has(threadKey(newest))}
                snoozed={Boolean(newest.snoozedUntil)}
                canReplyAll={(newest.externalParticipants?.length ?? 0) > 1}
                onSnooze={() =>
                  askPersonSnooze(newest, personMenuAt.x, personMenuAt.y)
                }
                onCancelSnooze={
                  newest.snoozedUntil ? () => void unsnooze(newest) : undefined
                }
                onToggleRead={() => void toggleRead([newest], "it")}
                onTogglePin={() => togglePin(newest)}
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
              snoozed={Boolean(newest.snoozedUntil)}
              onToggleRead={() => void toggleRead(row.threads, row.name)}
              // The newest is the one the row is showing and the one
              // the reader means by "this".
              onSnooze={() =>
                askPersonSnooze(newest, personMenuAt.x, personMenuAt.y)
              }
              onCancelSnooze={
                newest.snoozedUntil ? () => void unsnooze(newest) : undefined
              }
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
              void snooze(personSnooze.thread, untilIso);
              setPersonSnooze(null);
            }}
            onCancelSnooze={
              personSnooze.thread.snoozedUntil
                ? () => {
                    void unsnooze(personSnooze.thread);
                    setPersonSnooze(null);
                  }
                : undefined
            }
            currentUntil={personSnooze.thread.snoozedUntil}
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
    </>
  );
}

/** What stands above the rows: the search still running, first reads, stopped syncs, mailboxes the list is missing, the delete-forever question, and search notes. */
export function ListNotices({
  m,

}: {
  m: MailPageModel;

}) {
  const {
    cancelPurge,
    debouncedSearch,
    firstReads,
    isOutlookAccount,
    listNarrow,
    loadThreads,
    loadingList,
    pinnedThreads,
    purgeAsk,
    refreshing,
    runPurge,
    searchingMailboxCount,
    syncPaused,
    t,
    threads,
    unreadable,
  } = m;
  return (
    <>
      {/*
        While a search is actually running, whatever is already on screen.
        It used to appear only when the list was empty, which is the one
        time a reader does not need telling — with rows from the last
        query still showing, a new one looks like nothing is happening.

        `refreshing`, not `loadingList`: a search typed over rows already
        on screen keeps those rows and never sets loadingList at all, so
        the banner missed exactly the common case — the reader saw a
        plausible list, no sign anything was still out, and then a slow
        mailbox's answer landed in one late lump as if from nowhere.
        `refreshing` holds until the last mailbox has answered.

        A search is not a page loading: it is every mailbox being asked on
        its own, over the network, by its own provider. That is why it
        takes as long as it does and why rows land in bursts.
      */}
      {/* Not before the first row. Until then the list below is saying
          the same thing in more words — one wait, said once. This one
          is for what is still out *while* there is something to read,
          which is the case nobody was told about. */}
      {/* The first read of a mailbox, for as long as it is not complete.
          It takes hours, across many sittings, and the list grows as it
          goes. The line stays up in every state — reading, waiting to try
          again, stopped — and says which, at every width of the list. It
          used to show only while the phase was "full" and the list was
          wide, so a reader saw it go and took the read for finished. */}
      {firstReads.map((line) => (
        <MailFirstReadLine
          key={`${line.account}|${line.folder}`}
          line={line}
          narrow={listNarrow}
          onReconnect={() =>
            window.dispatchEvent(
              new CustomEvent<MailReconnectRequest>(MAIL_RECONNECT_REQUEST, {
                detail: {
                  provider: isOutlookAccount(line.account) ? "outlook" : "gmail",
                  email: line.account,
                },
              })
            )
          }
        />
      ))}
      {/* A sync that stopped on a mailbox whose copy is complete. */}
      {!listNarrow
        ? syncPaused
            .map((s) => (
              <div
                key={`${s.account}|${s.folder}`}
                className="border-b border-[var(--mail-chrome-border)] px-5 pb-2.5 pt-2.5"
              >
                {syncPauseKind(s.lastError) === "signIn" ? (
                  /* The grant is not good for the copy — an old one
                     from before the full-mail scope, or one revoked.
                     Said in the reader's terms, with the one thing
                     that mends it, since a line that only names a
                     refusal leaves them to guess at the remedy. */
                  <ListNotice
                    title={s.account}
                    action={
                      <ListNoticeButton onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent<MailReconnectRequest>(MAIL_RECONNECT_REQUEST, {
                              detail: {
                                provider: isOutlookAccount(s.account) ? "outlook" : "gmail",
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
                     are in the log, and no longer on a tooltip — a
                     reader hovered and met a sentence in English about
                     seconds and servers. */
                  <ListNotice
                    kind="offline"
                    /* The mailbox's own provider, not Gmail for
                       everybody: an Outlook account was told that Mail
                       could not reach Gmail for it. */
                    title={t("syncOffline", {
                      provider: isOutlookAccount(s.account)
                        ? "Outlook"
                        : "Gmail",
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
                                provider: isOutlookAccount(s.account) ? "outlook" : "gmail",
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
          Chrome colors, not white. This was written for a list that sat
          on the navy chrome, and on the cream one it was white text on
          near-white: a blank band above the results, with the spinner
          invisible in it too. What it looked like was a search that had
          lost its earlier rows and left a hole where they had been.
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
