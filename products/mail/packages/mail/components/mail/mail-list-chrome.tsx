"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component reads the page's slices that it needs (see
 * mail-page-slices.tsx). Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import * as React from "react";
import { TriageTab } from "@/components/mail/team-layer";
import { filterIsOn as filterIsOnFor } from "@/lib/mail/filter-set";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { Folder, Plus } from "lucide-react";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import { toast } from "@/lib/mail/toast";

/**
 * A drop on a folder that did not move the mail says why. The rail calls a
 * drop without waiting on it. Without this, an error here is an unhandled
 * rejection in the console and nothing on screen: the drop seems to do nothing.
 */
function dropFailed(err: unknown): void {
  toast.error(err instanceof Error ? err.message : String(err));
}
import { clearMailThreadDrag, draggingMailThread, FolderViewHeader, FoldersTabMenu, isMailThreadDrag } from "@/components/mail/MailFolders";
import { MailFolderRail } from "@/components/mail/MailFolderRail";
import { draftCountForTabs } from "@/components/mail/draft-opening";
import { MailCustomListEditor } from "@/components/mail/MailCustomListEditor";
import { createCustomList, customListTabId, deleteCustomList, parseCustomListTabId, updateCustomList } from "@/lib/mail/custom-lists";
import type { MailFolder } from "@/lib/mail/folder-types";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { usePageAccounts, usePageActions, usePageCompose, usePageLayout, usePageList, usePageReader, usePageSync } from "@/components/mail/mail-page-slices";
import type { PauseControls } from "@/components/mail/account-hours-menu";
import { MailAccountTabs, MailRowButton } from "@/components/mail/MailAccountTabs";
import { setTabSchedule } from "@/lib/mail/tab-schedules";
import { setTabIcon, useTabIcons } from "@/lib/mail/tab-icons";
import { cn } from "@/lib/utils";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { MailLayoutMenu } from "@/components/mail/MailListControls";
import { SortableMailListTab, TabHits, viewTabClass } from "@/components/mail/SortableMailListTab";
import { threadOnTab } from "@/components/mail/use-list-tabs";
import { isMailboxScopeAll, MailListTab, MAIL_OFF_TAB_VIEWS, mailBuiltinTabLabels } from "@/components/mail/mail-list-state";

export const FoldersMenu = React.memo(function FoldersMenu({
  iconOnly,
}: {
  iconOnly: boolean;
}) {
  const { accountEmails, mailboxScopeEmails } = usePageAccounts();
  const { chromeDark } = usePageLayout();
  const { drafts, refreshDrafts } = usePageCompose();
  const { folderApiAccount, folders, foldersLoading, heldMessages, snoozedCount, refreshFolders, setActiveFolder, setTab } = usePageList();
  const { moveToFolder } = usePageActions();
  const { setSelected, setSelectedPersonKey } = usePageReader();
  return (
    <FoldersTabMenu
      onNavy={chromeDark}
      iconOnly={iconOnly}
      folders={folders}
      loading={foldersLoading}
      onMenuOpen={() => void refreshFolders()}
      onOpenFolder={(f) => {
        setActiveFolder({ ...f, account: null });
        setSelected(null);
        setSelectedPersonKey(null);
        // Back to the whole folder. Every other way out of here says which
        // list it means — Sent, Drafts, Trash, Junk all set the tab — and
        // this one did not, so a folder opened while Drafts was up showed
        // the drafts again under the folder's own name.
        setTab("all");
      }}
      snoozedCount={snoozedCount}
      outboxCount={heldMessages.length}
      onOpenSnoozed={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("snoozed");
      }}
      onOpenOutbox={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("outbox");
      }}
      onOpenSent={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("sent");
      }}
      draftCount={draftCountForTabs(drafts, isMailboxScopeAll(mailboxScopeEmails, accountEmails) ? null : mailboxScopeEmails)}
      onOpenDrafts={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("drafts");
        refreshDrafts();
      }}
      onOpenTrash={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("trash");
      }}
      onOpenJunk={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("junk");
      }}
      onDropThread={(folderName, thread) =>
        moveToFolder(thread, folderName, false).catch(dropFailed)
      }
      onCreateFolder={async (name) => {
        const json = await apiJson<{ folder: MailFolder }>(
          "/api/mail/folders",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              ...(folderApiAccount ? { account: folderApiAccount } : null),
            }),
          }
        );
        await refreshFolders();
        // Stay where you are. A new folder is empty, and it is made in order
        // to put something in it — opening it takes you away from the mail
        // you meant to file.
        toast.success(mailSay("folderReady", { name: json.folder.name }));
      }}
    />
  );
});

export const FolderRail = React.memo(function FolderRail() {
  const { accountEmails, mailboxScopeEmails, onReorderAccount } = usePageAccounts();
  const { accountFolders, activeFolder, draggingAccount, foldersLoading, heldMessages, snoozedCount, lastListTabRef, railSystemView, refreshFolders, setActiveFolder, setTab } = usePageList();
  const { actOnSelection, dragCarriesSelection, moveManyToFolder, moveToFolder, moveToInbox, setThreadJunk, trash } = usePageActions();
  const { drafts, refreshDrafts } = usePageCompose();
  const { railOnRight } = usePageLayout();
  const { setSelected, setSelectedPersonKey } = usePageReader();
  return (
    <MailFolderRail
      accountFolders={accountFolders}
      loading={foldersLoading}
      onReorderAccount={onReorderAccount}
      accounts={accountEmails}
      openFolder={
        activeFolder
          ? { account: activeFolder.account, name: activeFolder.name }
          : null
      }
      systemView={railSystemView}
      snoozedCount={snoozedCount}
      outboxCount={heldMessages.length}
      onOpenSnoozed={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("snoozed");
      }}
      onOpenOutbox={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("outbox");
      }}
      draftCount={draftCountForTabs(drafts, isMailboxScopeAll(mailboxScopeEmails, accountEmails) ? null : mailboxScopeEmails)}
      draggingAccount={draggingAccount}
      side={railOnRight ? "right" : "left"}
      onOpenFolder={(account, name) => {
        const known = accountFolders.find(
          (f) =>
            f.account.toLowerCase() === account.toLowerCase() &&
            f.name.toLowerCase() === name.toLowerCase()
        );
        setActiveFolder({
          account,
          name,
          count: known?.count ?? 0,
          role: known?.role,
          virtual: known?.virtual,
        });
        setSelected(null);
        setSelectedPersonKey(null);
        // The folder's own contents — see the folders menu, which had the
        // same hole.
        setTab("all");
      }}
      onOpenSent={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("sent");
      }}
      onOpenDrafts={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("drafts");
        refreshDrafts();
      }}
      onOpenTrash={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("trash");
      }}
      onOpenJunk={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("junk");
      }}
      onOpenArchived={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("archived");
      }}
      onOpenInbox={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        // Back to the filter the reader was last reading under, not to a
        // fixed one: leaving the inbox for Trash and coming back should
        // find it as it was left.
        setTab(lastListTabRef.current);
      }}
      onDropThread={(account, folderName) => {
        // Read before the drag is cleared: the window-level dragend that
        // clears it runs after this, because a React handler is called from
        // the root container on the way up.
        const thread = draggingMailThread();
        clearMailThreadDrag();
        // The rail refuses a foreign mailbox already; this is the same rule
        // where it is enforced rather than drawn.
        if (!thread || thread.account.toLowerCase() !== account.toLowerCase()) {
          return;
        }
        // Everything the drag was carrying, which is the selection when the
        // row dragged was part of it. If only the dragged row moves, the
        // others stay where they are, and the toast names the folder as
        // though all of them went.
        const carried = dragCarriesSelection(thread).filter(
          (t) => t.account.toLowerCase() === account.toLowerCase()
        );
        if (carried.length > 1) return Promise.resolve(moveManyToFolder(carried, folderName)).catch(dropFailed);
        return moveToFolder(thread, folderName, false).catch(dropFailed);
      }}
      onDropTrash={() => {
        const thread = draggingMailThread();
        clearMailThreadDrag();
        if (!thread) return;
        // The same rule as the folders, through the path the keyboard
        // already uses for a selection.
        if (dragCarriesSelection(thread).length > 1) {
          return actOnSelection("trash");
        }
        return trash(thread, "drop");
      }}
      onDropInbox={() => {
        const thread = draggingMailThread();
        clearMailThreadDrag();
        if (!thread) return;
        return moveToInbox(thread);
      }}
      onDropJunk={() => {
        const thread = draggingMailThread();
        clearMailThreadDrag();
        if (!thread) return;
        return setThreadJunk(thread, true);
      }}
      onCreateFolder={async (account, name) => {
        const json = await apiJson<{ folder: MailFolder }>(
          "/api/mail/folders",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, account }),
          }
        );
        await refreshFolders();
        // Stay where you are. A new folder is empty, and it is made in
        // order to put something in it.
        toast.success(mailSay("folderReady", { name: json.folder.name }));
      }}
      onRenameFolder={async (account, name, newName) => {
        /**
         * Say it is happening, because it takes seconds.
         *
         * The provider does the work and then the whole folder list is
         * read back, and until both are done the rail can only show the
         * folder where it was. A message that arrives with the result
         * arrives after the wait it was meant to explain.
         *
         * A move and a rename are the same call and not the same sentence:
         * the parent changing is a move, the last part changing is a
         * rename, and the folder is told apart from its place by comparing
         * the two names rather than by being passed a flag.
         */
        const parentOf = (path: string) =>
          path.split("/").slice(0, -1).join("/");
        const moved = parentOf(name) !== parentOf(newName);
        const leaf = newName.split("/").pop() ?? newName;
        const into = parentOf(newName);
        const pending = toast.loading(
          moved
            ? `Moving ${leaf} to ${into || "the top level"}…`
            : `Renaming to ${leaf}…`,
          { description: "This can take a few seconds to reach the server." }
        );
        try {
          // On that mailbox only. Without the account this renames the
          // folder on every account that happens to share its name, which
          // is what the merged menu meant by a folder and is not what a row
          // under one mailbox's heading means.
          await apiJson<{ folder: MailFolder }>("/api/mail/folders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, newName, account }),
          });
        } catch (err) {
          toast.dismiss(pending);
          throw err;
        }
        await refreshFolders();
        // The open folder was that folder. Follow it, rather than leaving
        // the reader looking at a list headed by a name nothing has.
        setActiveFolder((current) =>
          current &&
          current.name.toLowerCase() === name.toLowerCase() &&
          (current.account ?? "").toLowerCase() === account.toLowerCase()
            ? { ...current, name: newName }
            : current
        );
        toast.success(
          moved
            ? `${leaf} moved to ${into || "the top level"}`
            : `Renamed to ${leaf}`,
          { id: pending, description: undefined }
        );
      }}
      onDeleteFolder={async (account, name) => {
        // On that mailbox only, for the same reason the rename is: a row
        // under one heading means that mailbox's folder, and no other.
        await apiJson("/api/mail/folders", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, account }),
        });
        await refreshFolders();
        // Standing in a folder that no longer exists is standing nowhere.
        setActiveFolder((current) =>
          current &&
          current.name.toLowerCase() === name.toLowerCase() &&
          (current.account ?? "").toLowerCase() === account.toLowerCase()
            ? null
            : current
        );
        toast.success(`${name} deleted`);
      }}
    />
  );
});

/**
 * The way to the folders.
 *
 * On the expanded toolbar it stands before New email, because it says
 * which mail this is. Unexpanded it stays on the mailbox row, or on
 * the filter row when there is no mailbox row.
 *
 * It stays while the rail is open, lit the way the funnel is lit while
 * the filters are showing. Pressing it again puts the rail away: it is
 * the only way out, and a control that vanished once it had worked
 * would leave a gap in the row and the rail with no way to close it.
 */

export const FoldersButton = React.memo(function FoldersButton() {
  const { chromeDark, railShowing, setRailOpen } = usePageLayout();
  const t = useMailT();
  return (
    <MailRowButton
      icon={Folder}
      label={t("folders")}
      active={railShowing}
      aria-expanded={railShowing}
      onNavy={chromeDark}
      onClick={() => setRailOpen(!railShowing)}
      onDragEnter={(e: React.DragEvent) => {
        // Dragging a conversation at the folders asks for the folders.
        // It opens and stays open — the rail is not a menu that springs
        // shut again once the drop has landed, and a drag never closes it.
        if (!isMailThreadDrag(e.dataTransfer)) return;
        e.preventDefault();
        setRailOpen(true);
      }}
      onDragOver={(e: React.DragEvent) => {
        if (!isMailThreadDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
    />
  );
});

/**
 * The list tabs, as in To-Do: All, the built-in lists, the reader's own,
 * and New list. One at a time, underlined. Chips that can be switched on
 * together, behind a funnel, read as confusing.
 */

export const FilterChips = React.memo(function FilterChips() {
  const t = useMailT();
  const { customListById, searchHits, listEditor, setActiveFolder, setListEditor, setTab, setTabOrder, tab, tabOrder, tabReorderSensors, tabReorderSuppressClick } = usePageList();
  const tabIcons = useTabIcons();
  return (
      /* The half-rem of padding, and the same again in negative margin, is
         room for a chip's own outline. A scroller clips at its box, and the
         first chip sat exactly on that edge — so the left of its border was
         shaved off, which read as a chip half out of the row. The margin
         puts the row back where it was. */
      <div className="-mx-0.5 min-w-0 flex-1 overflow-x-auto px-0.5 pt-0.5 [scrollbar-width:thin]">
        <DndContext
          sensors={tabReorderSensors}
          collisionDetection={closestCenter}
          onDragStart={() => {
            tabReorderSuppressClick.current = true;
          }}
          onDragEnd={(event) => {
            const { active, over } = event;
            if (over && active.id !== over.id) {
              const oldIndex = tabOrder.indexOf(active.id as MailListTab);
              const newIndex = tabOrder.indexOf(over.id as MailListTab);
              if (oldIndex >= 0 && newIndex >= 0) {
                setTabOrder(arrayMove(tabOrder, oldIndex, newIndex));
              }
            }
            // Drop can synthesize a click — ignore that one.
            window.setTimeout(() => {
              tabReorderSuppressClick.current = false;
            }, 0);
          }}
        >
          <SortableContext
            items={tabOrder}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex w-max items-end gap-5 pt-0.5 pr-2">
              <button
                type="button"
                data-list-tab="all"
                onClick={() => setTab("all")}
                className={viewTabClass(tab === "all")}
              >
                {t("tabAll")}
                <TabHits hits={searchHits?.length} />
              </button>
              {tabOrder.filter((id) => id !== "all").map((id) => {
                const listId = parseCustomListTabId(id);
                const custom = listId
                  ? customListById.get(listId)
                  : undefined;
                const label = custom
                  ? custom.name
                  : mailBuiltinTabLabels(t)[id] ?? id;
                return (
                  <React.Fragment key={id}>
                  <SortableMailListTab
                    id={id}
                    label={label}
                    icon={tabIcons[id]}
                    active={filterIsOnFor(tab, id, MAIL_OFF_TAB_VIEWS)}
                    suppressClick={tabReorderSuppressClick}
                    hits={searchHits?.filter((thread) => threadOnTab(thread, id, customListById)).length}
                    onSelect={() => {
                      // The folder stays. A tab narrows what is on
                      // screen; leaving the folder is what Back is for.
                      // One tab at a time, as in To-Do.
                      setTab(id);
                    }}
                    // Right-click opens it: a list of your own whole, a
                    // built-in filter at its schedule, which is all there is
                    // to it. Pressing it again takes it off.
                    onEdit={() => setListEditor(custom ? custom.id : id)}
                  />
                  {/* The organization's build puts its ranked list here,
                      right of Other, once there is one. */}
                  {id === "other" ? <TriageTab tabClass={viewTabClass} /> : null}
                  </React.Fragment>
                );
              })}
              {tab === "sent" ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveFolder(null);
                    setTab("sent");
                  }}
                  className={viewTabClass(true)}
                >
                  {mailBuiltinTabLabels(t).sent}
                </button>
              ) : null}
              {tab === "junk" ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveFolder(null);
                    setTab("junk");
                  }}
                  className={viewTabClass(true)}
                >
                  {mailBuiltinTabLabels(t).junk}
                </button>
              ) : null}
              {tab === "trash" ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveFolder(null);
                    setTab("trash");
                  }}
                  className={viewTabClass(true)}
                >
                  {mailBuiltinTabLabels(t).trash}
                </button>
              ) : null}
              {tab === "drafts" ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveFolder(null);
                    setTab("drafts");
                  }}
                  className={viewTabClass(true)}
                >
                  {mailBuiltinTabLabels(t).drafts}
                </button>
              ) : null}
              {/* Snoozed and Outbox are places in the folder rail; a chip
                  here only while one is the open view, as Drafts has. */}
              {tab === "outbox" ? (
                <button type="button" onClick={() => setTab("outbox")} className={viewTabClass(true)}>
                  {mailBuiltinTabLabels(t).outbox}
                </button>
              ) : null}
              {tab === "snoozed" ? (
                <button
                  type="button"
                  onClick={() => {
                    setActiveFolder(null);
                    setTab("snoozed");
                  }}
                  className={viewTabClass(tab === "snoozed")}
                >
                  {mailBuiltinTabLabels(t).snoozed}
                </button>
              ) : null}
              <button
                type="button"
                title={t("newList")}
                aria-label={t("newListTab")}
                aria-expanded={listEditor != null}
                onClick={() =>
                  setListEditor((prev) =>
                    prev == null ? "create" : null
                  )
                }
                className={cn(
                  // Transparent bottom border keeps height aligned with tabs;
                  // active state is the inset square (not ring — overflow-x
                  // on the tab scroller would clip a ring's top edge). The
                  // matching space above is what puts the square level with
                  // the words beside it rather than over them.
                  // As a tab's: 2px over, 6px under, and the same fill under
                  // the pointer (viewTabClass).
                  "flex shrink-0 items-center border-b-2 border-transparent pb-[6px] pt-[2px] relative isolate before:absolute before:-inset-x-2 before:inset-y-0 before:-z-10 before:rounded-t-control before:transition-colors hover:before:bg-[var(--mail-chrome-hover)]",
                  listEditor != null
                    ? "text-teal-700"
                    : "text-[var(--mail-chrome-muted)] hover:text-[var(--mail-chrome-fg)]"
                )}
              >
                {/* 2px down: centred on the row it sits on the middle of
                    the capitals, and reads as higher than "Other" beside
                    it, whose letters are mostly lower case. */}
                <span
                  className={cn(
                    "flex h-5 w-5 translate-y-0.5 items-center justify-center rounded",
                    listEditor != null
                      ? "border border-teal-600"
                      : "border border-transparent"
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                </span>
              </button>
            </div>
          </SortableContext>
        </DndContext>
      </div>
  );
});

export function FilterRow({
  filterChips,
  foldersButton,
}: {
  filterChips: React.ReactNode;
  foldersButton: React.ReactNode;
}) {
  const { filtersShowing, setUnreadOnly, tabHasUnread, unreadOnly } = usePageList();
  // Here only with one mailbox; with more, before their tabs.
  const ownsFolders = foldersButton != null;
  // Only where it can narrow something, and always while it is on, so
  // there is a way back from a tab it has emptied.
  const unreadSwitch = filtersShowing && (tabHasUnread || unreadOnly);
  return (
    !filtersShowing && !ownsFolders ? null : (
    /* The tabs, then the folders at the right end when there is no
       mailbox row for them, as Outlook has Focused and Other. The light line
       runs the whole width of the list: the row reaches out over the
       head's padding (px-5) and takes it back. An inset shadow and not a
       border, so the selected tab's underline is drawn over it. */
    <div className="-mx-5 mt-2 flex items-end gap-2 px-5 shadow-[inset_0_-1px_0_var(--mail-chrome-border)]">
      {filtersShowing ? filterChips : null}
      {unreadSwitch ? <UnreadSwitch on={unreadOnly} onChange={setUnreadOnly} /> : null}
      {/* Its glyph level with the times at the end of the rows. Level
          with the tab words: a tab is 30px from its underline up, with
          the words' middle 18px above the line, so this button's middle
          goes 2px up from where the row's foot puts it. */}
      {ownsFolders ? (
        <div className={cn("-mr-[11px] shrink-0 -translate-y-[2px]", !unreadSwitch && "ml-auto")}>{foldersButton}</div>
      ) : null}
    </div>
  )
  );
}

/**
 * The unread switch: one for every tab, as the envelope with a dot that
 * marks a conversation unread in the reader's toolbar. Off, it is in the
 * muted grey of the tabs that are not open; on, it sits in a pill and the
 * tab lists only its unread conversations (lib/mail/unread-filter.ts).
 * Not the green dot the rows wear: a green dot at the head of the list
 * read as one more thing waiting (2026-10-24).
 */
function UnreadSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useMailT();
  const label = on ? t("unreadOnlyHide") : t("unreadOnlyShow");
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={cn(
        // Its middle level with the tab words, and its glyph ending where
        // the mailbox tabs above end: the pill's padding reaches past the
        // edge, as a tab's fill reaches past its words.
        "-mr-1.5 mb-[3px] ml-auto flex shrink-0 items-center rounded-control border px-1.5 py-1 transition-colors",
        // A shade lighter than the tab words: it is a quiet switch, not a tab.
        on
          ? "border-stone-300 bg-[var(--mail-chrome-hover)] text-[var(--mail-chrome-muted)]"
          : "border-transparent text-[var(--mail-chrome-muted)] opacity-[0.85] hover:bg-[var(--mail-chrome-hover)] hover:opacity-100"
      )}
    >
      <MailDotIcon className="h-[18px] w-[18px]" aria-hidden />
    </button>
  );
}

/** The mailbox row: All, then one tab per mailbox. */

export const AccountTabs = React.memo(function AccountTabs() {
  const accounts = usePageAccounts();
  const {
    accountEmails,
    accountLabels,
    autoReplyByAccount,
    isOutlookAccount,
    mailboxScopeEmails,
    quietUntilByAccount,
    setAccountEmails,
    setMailboxScopeEmails,
    // Hiding mailboxes for a while, and the greyed tabs (use-mailbox-hide).
    hide,
  } = accounts;
  const { chromeDark } = usePageLayout();
  // Pausing, for the tab's menu: hiding and pausing are one menu now.
  const pause: PauseControls = {
    state: accounts.pauseState,
    now: accounts.pauseNow,
    pauseUntil: accounts.pauseMailUntil,
    resume: accounts.resumeMail,
    setQuietHours: accounts.setMailQuietHours,
    setFollowAllHours: accounts.setFollowAllHours,
    setUnpauseWords: accounts.setUnpauseWords,
  };
  return (
          <MailAccountTabs
            accounts={accountEmails}
            labels={accountLabels}
            isOutlookAccount={isOutlookAccount}
            selected={mailboxScopeEmails}
            onSelect={setMailboxScopeEmails}
            onReorder={(next) => {
              // The row writes the arrangement itself, All among the mailboxes.
              // This is the list answering at once, before the store's own
              // event comes back around.
              setAccountEmails(next);
            }}
            onNavy={chromeDark}
            quietUntil={quietUntilByAccount}
            autoReplyOn={autoReplyByAccount}
            hide={hide}
            pause={pause}
          />
  );
});

export function ListTabsOrFolder({
  accountTabs,
  filterRow,
  foldersButton,
  accountTabsShowing,
}: {
  accountTabs: React.ReactNode;
  filterRow: React.ReactNode;
  /** The way to the folders, before the mailbox tabs; null when it stands elsewhere. */
  foldersButton: React.ReactNode;
  /** Whether the mailbox row shows: more than one mailbox connected, hidden ones counted. */
  accountTabsShowing: boolean;
}) {
  const t = useMailT();
  const { accountFolders, activeFolder, debouncedSearch, editingBuiltin, editingList, folders, listEditor, setActiveFolder, setListEditor, setTab, setTabOrder, tab, tabOrder, tabSchedules, threads } = usePageList();
  const { chromeDark, listVertical } = usePageLayout();
  const { setSelected, setSelectedPersonKey } = usePageReader();
  const tabIcons = useTabIcons();
  return (
    activeFolder ? (
    <>
    <FolderViewHeader
      onNavy={chromeDark}
      folder={(() => {
        const meta =
          folders.find(
            (f) => f.name.toLowerCase() === activeFolder.name.toLowerCase()
          ) ?? activeFolder;
        return {
          ...meta,
          count: debouncedSearch
            ? meta.count
            : Math.max(threads.length, meta.count),
        };
      })()}
      onBack={() => setActiveFolder(null)}
      onOpenParent={(path) => {
        // Up one level, on the mailbox this folder was opened from. A
        // parent standing in for one nobody made has no count of its own,
        // so it opens on nothing until the list comes back.
        const known = accountFolders.find(
          (f) =>
            (activeFolder.account ?? "").toLowerCase() ===
              f.account.toLowerCase() &&
            f.name.toLowerCase() === path.toLowerCase()
        );
        setActiveFolder({
          account: activeFolder.account,
          name: path,
          count: known?.count ?? 0,
          role: known?.role,
          virtual: known?.virtual,
        });
        setSelected(null);
        setSelectedPersonKey(null);
      }}
    />
    {/* The filters stay. A folder says which mail this is; a filter says
        whose, and the two are different questions — a reader in Clients
        who wants only the people in their address book was being told to
        leave the folder to ask. The mailbox row does not stay: a folder
        is on one mailbox already. */}
    <div className="text-sm">{filterRow}</div>
    </>
  ) : (
    <div className="text-sm">
      {/*
        Two rows, and the second one grows when it is asked to.

        The first says whose mail this is — All, or one mailbox — and it gets
        the width to itself, because that is the row a reader reads along.

        The second holds the folders and the funnel, and the filters unroll
        along it when the funnel is pressed: they belong to that button, so
        they come out beside it rather than starting a row of their own. A
        reader who wants everything from one mailbox, which is most of the
        time, never sees them.
      */}
      {/*
        One mailbox needs no row to choose it.

        The row would be "All" beside the single mailbox — two tabs for the
        same mail, and a question the reader cannot answer wrongly. It
        appears when a second mailbox is connected, which is when there is
        something to pick between. Connected, not shown: a mailbox hidden for
        the evening still counts, or the row that shows it again would go
        with it.
      */}
      {/*
        Level with the reader beside it: the tabs' top with the top of its
        row of actions, and the line under the filters with the foot of
        its subject (the 16px under the tabs, which takes in the filter
        row's own 8px, puts it there).
      */}
      {accountTabsShowing ? (
      <div className={cn("flex items-center gap-1", !listVertical && "mb-4")}>
        {/* The folders first: they are the mailboxes' own. The glyph,
            not the button, is level with the row's left edge. */}
        {foldersButton ? <div className="-ml-2 shrink-0">{foldersButton}</div> : null}
        {/* The row scrolls when the mailboxes outrun it; the button beside it does not move. */}
        <div className="min-w-0 flex-1">
          {accountTabs}
        </div>
      </div>
      ) : null}

      {/*
        The filters go under the tabs, not beside them.

        Beside them they competed for a sidebar's worth of width with the
        mailboxes, which are that row's whole point, and the first thing to
        be squeezed out was the mailbox at the end. Underneath, the tabs get
        the width. The way to the folders is the exception and stands at the
        head of the tab row: it is one glyph, it does not grow, and the
        folders are the mailboxes' own.
      */}
      {filterRow}
      <MailCustomListEditor
        open={listEditor != null}
        onCancel={() => setListEditor(null)}
        scheduleOnly={Boolean(editingBuiltin)}
        title={
          editingBuiltin
            ? mailBuiltinTabLabels(t)[editingBuiltin] ?? editingBuiltin
            : editingList
              ? t("editFilter")
              : t("newList")
        }
        submitLabel={editingList || editingBuiltin ? t("save") : t("createList")}
        initial={
          editingBuiltin
            ? {
                name: editingBuiltin,
                icon: tabIcons[editingBuiltin] ?? "",
                members: [],
                scheduleDefault: Boolean(tabSchedules[editingBuiltin]),
                scheduleFrom: tabSchedules[editingBuiltin]?.from,
                scheduleTo: tabSchedules[editingBuiltin]?.to,
                scheduleDays: tabSchedules[editingBuiltin]?.days,
              }
            : editingList
              ? {
                  name: editingList.name,
                  icon: tabIcons[customListTabId(editingList.id)] ?? "",
                  members: editingList.members,
                  groups: editingList.groups,
                  scheduleDefault: editingList.scheduleDefault,
                  scheduleFrom: editingList.scheduleFrom,
                  scheduleTo: editingList.scheduleTo,
                  scheduleDays: editingList.scheduleDays,
                }
              : undefined
        }
        onSubmit={(name, members, schedule, icon, groups) => {
          if (editingBuiltin) {
            setTabIcon(editingBuiltin, icon);
            setTabSchedule(editingBuiltin, schedule.enabled ? schedule : null);
            setListEditor(null);
            return;
          }
          if (editingList) {
            updateCustomList(editingList.id, {
              name,
              members,
              schedule,
              groups,
            });
            setTabIcon(customListTabId(editingList.id), icon);
            setListEditor(null);
            return;
          }
          const list = createCustomList(name, members, schedule, groups);
          const tabId = customListTabId(list.id);
          setTabIcon(tabId, icon);
          setTabOrder([...tabOrder, tabId]);
          setActiveFolder(null);
          setTab(tabId);
          setListEditor(null);
        }}
        onDelete={
          editingList
            ? () => {
                const tabId = customListTabId(editingList.id);
                deleteCustomList(editingList.id);
                setTabOrder(tabOrder.filter((id) => id !== tabId));
                // The list being read is gone; All is what is left.
                if (tab === tabId) setTab("all");
                setListEditor(null);
              }
            : undefined
        }
      />
    </div>
  )
  );
}

/** Display & accounts, with Settings, shortcuts and contact sources in it. */

export const LayoutMenu = React.memo(function LayoutMenu() {
  const {
    accountEmails,
    autoReplies,
    onMailboxVisibilityChange,
    onOwnIdentityChange,
    ownIdentity,
  } = usePageAccounts();
  const { endAutoReply, openAutoReply } = usePageCompose();
  const { loadThreads } = usePageSync();
  const { chromeDark } = usePageLayout();
  return (
          <MailLayoutMenu
            onNavy={chromeDark}
            // It opens below the button, not off the right edge, so it
            // lines up with its left side.
            align="start"
            knownEmails={accountEmails}
            onVisibilityChange={onMailboxVisibilityChange}
            onAccountsChanged={() => {
              void loadThreads({ fresh: true });
            }}
            autoReplies={autoReplies}
            onSetUpAutoReply={(account) => openAutoReply(account, { settings: true })}
            onEndAutoReply={(account) => void endAutoReply(account)}
            ownIdentity={ownIdentity}
            onOwnIdentityChange={onOwnIdentityChange}
          />
  );
});
