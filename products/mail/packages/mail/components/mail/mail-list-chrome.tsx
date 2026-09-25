"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component takes the page's model (`m`, from useMailPage) and reads
 * the names it needs from it. Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import * as React from "react";
import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { Folder, Funnel, Plus } from "lucide-react";
import { toast } from "@/lib/mail/toast";
import { clearMailThreadDrag, draggingMailThread, FolderViewHeader, FoldersTabMenu, isMailThreadDrag } from "@/components/mail/MailFolders";
import { MailFolderRail } from "@/components/mail/MailFolderRail";
import { MailCustomListEditor } from "@/components/mail/MailCustomListEditor";
import { createCustomList, customListTabId, deleteCustomList, parseCustomListTabId, updateCustomList } from "@/lib/mail/custom-lists";
import type { MailFolder } from "@/lib/mail/folder-types";
import { mailSay } from "@/lib/mail/i18n";
import { MailAccountTabs, MailRowButton } from "@/components/mail/MailAccountTabs";
import { setTabSchedule } from "@/lib/mail/tab-schedules";
import { cn } from "@/lib/utils";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { MailLayoutMenu } from "@/components/mail/MailListControls";
import { SortableMailListTab, viewTabClass } from "@/components/mail/SortableMailListTab";
import { MailListTab, MAIL_LIST_TABS, mailBuiltinTabLabels } from "@/components/mail/mail-list-state";
import type { MailPageModel } from "@/components/mail/use-mail-page";

export function FoldersMenu({
  m,
  iconOnly,
}: {
  m: MailPageModel;
  iconOnly: boolean;
}) {
  const {
    chromeDark,
    drafts,
    folderApiAccount,
    folders,
    foldersLoading,
    moveToFolder,
    refreshDrafts,
    refreshFolders,
    setActiveFolder,
    setSelected,
    setSelectedPersonKey,
    setTab,
  } = m;
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
      onOpenSent={() => {
        setActiveFolder(null);
        setSelected(null);
        setSelectedPersonKey(null);
        setTab("sent");
      }}
      draftCount={drafts.length || null}
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
        moveToFolder(thread, folderName, false)
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
}

export function FolderRail({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    accountEmails,
    accountFolders,
    actOnSelection,
    activeFolder,
    drafts,
    dragCarriesSelection,
    draggingAccount,
    foldersLoading,
    lastListTabRef,
    moveManyToFolder,
    moveToFolder,
    moveToInbox,
    onReorderAccount,
    railOnRight,
    railSystemView,
    refreshDrafts,
    refreshFolders,
    setActiveFolder,
    setSelected,
    setSelectedPersonKey,
    setTab,
    setThreadJunk,
    trash,
  } = m;
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
      draftCount={drafts.length || null}
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
        // row dragged was part of it. One of them dropped and the other two
        // stayed where they were, with a toast that named the folder as
        // though all three had gone.
        const carried = dragCarriesSelection(thread).filter(
          (t) => t.account.toLowerCase() === account.toLowerCase()
        );
        if (carried.length > 1) return moveManyToFolder(carried, folderName);
        return moveToFolder(thread, folderName, false);
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
}

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

export function FoldersButton({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    chromeDark,
    railShowing,
    setRailOpen,
    t,
  } = m;
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
}

export function FilterButton({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    chromeDark,
    filterIsOn,
    filtersShowing,
    lastFilterRef,
    setFilterRowOpen,
    setTab,
    t,
    tab,
    tabOrder,
  } = m;
  return (
    <MailRowButton
      icon={Funnel}
      label={t("filterLabel")}
      // Lit while the filters are showing, and only then. Lighting it
      // because a filter happened to be on made it look like the chosen
      // one of a pair of buttons, which it is not.
      active={filtersShowing}
      aria-expanded={filtersShowing}
      onNavy={chromeDark}
      /*
        Putting the row away is turning the filter off.

        A filter the reader cannot see is a list that is missing mail for
        no reason they can point at — so a filter that is on keeps its row
        on screen, and this button, which used to be able to hide it,
        takes it back to All instead. With All showing there is nothing to
        hide, and it folds away as it always did.
      */
      onClick={() => {
        if (!filtersShowing) {
          setFilterRowOpen(true);
          // Back to the one that was on when they were last put away —
          // if it is still there to go back to, and if nothing else has
          // taken the list over in the meantime. Opening Trash and then
          // pressing this means "show me the filters", not "leave Trash".
          const last = lastFilterRef.current;
          if (last && tab === "all" && tabOrder.includes(last)) setTab(last);
          return;
        }
        if (filterIsOn) setTab("all");
        setFilterRowOpen(false);
      }}
    />
  );
}

/** The filter chips: the built-in lists, the reader's own, and New list. */

export function FilterChips({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    customListById,
    listEditor,
    setActiveFolder,
    setListEditor,
    setTab,
    setTabOrder,
    snoozedCount,
    t,
    tab,
    tabOrder,
    tabReorderSensors,
    tabReorderSuppressClick,
  } = m;
  return (
      /* The half-rem of padding, and the same again in negative margin, is
         room for a chip's own outline. A scroller clips at its box, and the
         first chip sat exactly on that edge — so the left of its border was
         shaved off, which read as a chip half out of the row. The margin
         puts the row back where it was. */
      <div className="-mx-0.5 min-w-0 flex-1 overflow-x-auto px-0.5 py-0.5 [scrollbar-width:thin]">
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
            <div className="flex w-max items-center gap-2 py-0.5 pr-2">
              {tabOrder.map((id) => {
                const listId = parseCustomListTabId(id);
                const custom = listId
                  ? customListById.get(listId)
                  : undefined;
                const label = custom
                  ? custom.name
                  : mailBuiltinTabLabels(t)[id] ?? id;
                return (
                  <SortableMailListTab
                    key={id}
                    id={id}
                    label={label}
                    active={tab === id}
                    suppressClick={tabReorderSuppressClick}
                    onSelect={() => {
                      // The folder stays. A filter narrows what is on
                      // screen; leaving the folder is what Back is for.
                      // The first press chooses the list. Pressing the one
                      // already chosen is what opens it for editing: a
                      // reader switching between two lists was being handed
                      // the editor every time they switched.
                      const alreadyOn = tab === id;
                      setTab(id);
                      if (!alreadyOn) return;
                      // A list of your own opens whole; a built-in filter
                      // opens at its schedule, which is all there is to it.
                      if (custom) setListEditor(custom.id);
                      else if (MAIL_LIST_TABS.includes(id)) setListEditor(id);
                    }}
                    onEdit={
                      custom ? () => setListEditor(custom.id) : undefined
                    }
                  />
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
              {tab === "snoozed" ||
              (snoozedCount != null && snoozedCount > 0) ? (
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
                  "flex shrink-0 items-center border-b-[3px] border-transparent pb-0.5 pt-[5px]",
                  listEditor != null
                    ? "text-teal-700"
                    : "text-[var(--mail-chrome-muted)] hover:text-[var(--mail-chrome-fg)]"
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded",
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
}

export function FilterRow({
  m,
  filterButton,
  filterChips,
  foldersButton,
}: {
  m: MailPageModel;
  filterButton: React.ReactNode;
  filterChips: React.ReactNode;
  foldersButton: React.ReactNode;
}) {
  const {
    accountTabsShowing,
    filtersShowing,
    listChromeOnToolbar,
  } = m;
  return (
    listChromeOnToolbar && !filtersShowing ? null : (
    <div className="mt-2 flex items-center gap-2">
      {accountTabsShowing || listChromeOnToolbar ? null : foldersButton}
      {listChromeOnToolbar ? null : filterButton}

      {filtersShowing ? filterChips : null}
    </div>
  )
  );
}

/** The mailbox row: All, then one tab per mailbox. */

export function AccountTabs({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    accountEmails,
    accountLabels,
    autoReplyByAccount,
    chromeDark,
    isOutlookAccount,
    mailboxScopeEmails,
    quietUntilByAccount,
    setAccountEmails,
    setMailboxScopeEmails,
  } = m;
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
          />
  );
}

export function ListTabsOrFolder({
  m,
  accountTabs,
  filterRow,
  foldersButton,
}: {
  m: MailPageModel;
  accountTabs: React.ReactNode;
  filterRow: React.ReactNode;
  foldersButton: React.ReactNode;
}) {
  const {
    accountFolders,
    accountTabsShowing,
    activeFolder,
    chromeDark,
    debouncedSearch,
    editingBuiltin,
    editingList,
    folders,
    listChromeOnToolbar,
    listEditor,
    listVertical,
    setActiveFolder,
    setListEditor,
    setSelected,
    setSelectedPersonKey,
    setTab,
    setTabOrder,
    t,
    tab,
    tabOrder,
    tabSchedules,
    threads,
  } = m;
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
    <div
      className={cn(
        "text-sm",
        // Room for the mailbox row under New email. One mailbox has no
        // such row, so the filter row's own margin is enough.
        !listVertical && accountTabsShowing && "mt-[13px]"
      )}
    >
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
        something to pick between.
      */}
      {accountTabsShowing ? (
      <div className="flex items-center gap-2">
        {listChromeOnToolbar ? null : foldersButton}
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
              ? t("editList")
              : t("newList")
        }
        submitLabel={editingList || editingBuiltin ? t("save") : t("createList")}
        initial={
          editingBuiltin
            ? {
                name: editingBuiltin,
                members: [],
                scheduleDefault: Boolean(tabSchedules[editingBuiltin]),
                scheduleFrom: tabSchedules[editingBuiltin]?.from,
                scheduleTo: tabSchedules[editingBuiltin]?.to,
                scheduleDays: tabSchedules[editingBuiltin]?.days,
              }
            : editingList
              ? {
                  name: editingList.name,
                  members: editingList.members,
                  scheduleDefault: editingList.scheduleDefault,
                  scheduleFrom: editingList.scheduleFrom,
                  scheduleTo: editingList.scheduleTo,
                  scheduleDays: editingList.scheduleDays,
                }
              : undefined
        }
        onSubmit={(name, members, schedule) => {
          if (editingBuiltin) {
            setTabSchedule(editingBuiltin, schedule.enabled ? schedule : null);
            setListEditor(null);
            return;
          }
          if (editingList) {
            updateCustomList(editingList.id, {
              name,
              members,
              schedule,
            });
            setListEditor(null);
            return;
          }
          const list = createCustomList(name, members, schedule);
          const tabId = customListTabId(list.id);
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

export function LayoutMenu({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    accountEmails,
    autoReplies,
    chromeDark,
    endAutoReply,
    loadThreads,
    onMailboxVisibilityChange,
    onOwnIdentityChange,
    openAutoReply,
    ownIdentity,
  } = m;
  return (
          <MailLayoutMenu
            onNavy={chromeDark}
            // It opens below the button now rather than off the right edge,
            // so it lines up with its left side.
            align="start"
            knownEmails={accountEmails}
            onVisibilityChange={onMailboxVisibilityChange}
            onAccountsChanged={() => {
              void loadThreads({ fresh: true });
            }}
            autoReplies={autoReplies}
            onSetUpAutoReply={openAutoReply}
            onEndAutoReply={(account) => void endAutoReply(account)}
            ownIdentity={ownIdentity}
            onOwnIdentityChange={onOwnIdentityChange}
          />
  );
}
