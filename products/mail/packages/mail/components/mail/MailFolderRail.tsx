"use client";

/**
 * The folder rail: every folder on every mailbox, down the left of the list.
 *
 * It replaces a dropdown that had to be opened, read, and dismissed for
 * each filing. A rail is open or it is not, and while it is, filing a
 * conversation is one motion — pick it up, drop it on a folder already in
 * front of you. That only works if the folder is on screen before the drag
 * starts, which is the whole argument for a rail over a menu.
 *
 * Top to bottom:
 *
 *   Sent · Drafts · Trash · Junk   one set, across every mailbox
 *   ★ Favourites                   folders pinned here, mailboxes mixed
 *   Filter folders…                narrows the sections, not the views
 *   one headed section per mailbox, each a real tree
 *
 * The order is the argument. The four views at the top are the same four
 * for everybody and never move. What is below them is the reader's own
 * filing, which is theirs and is different on every machine.
 *
 * This file draws the rail. The parts:
 *
 *   use-folder-rail.tsx     its state: filter, folding, new folders,
 *                           rename, delete, move, and the mailbox drag
 *   folder-rail-rows.tsx    a view row, a folder row, the menus, the
 *                           question before a delete, the move picker
 *   folder-rail-shared.tsx  drag types, timings, icons, props
 *   lib/mail/folder-drop.ts the rules for a drop, which a suite checks
 *
 * tests/mounted-folder-rail walks it.
 */

import * as React from "react";
import {
  Archive,
  ChevronRight,
  FilePen,
  Inbox,
  Loader2,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { type FolderTreeNode } from "@/lib/mail/folder-tree";
import { collapsedAccountKey, collapsedFolderKey } from "@/lib/mail/folder-rail";
import { folderFavouriteKey, toggleFolderFavourite } from "@/lib/mail/folder-favourites";
import { cn } from "@/lib/utils";
import {
  type FolderRailProps,
  HeartIcon,
  MAIL_ACCOUNT_DRAG_TYPE,
  SPRING_OPEN_MS,
  clearFolderDragImage,
  setFolderDragImage,
} from "@/components/mail/folder-rail-shared";
import { folderParentPath } from "@/lib/mail/folder-drop";
import {
  FolderContextMenu,
  FolderDeleteConfirm,
  FolderMovePicker,
  FolderRow,
  SystemRow,
} from "@/components/mail/folder-rail-rows";
import { useFolderRail } from "@/components/mail/use-folder-rail";

/** ── the rail ──────────────────────────────────────────────────────────── */

export function MailFolderRail(props: FolderRailProps) {
  const {
    accountDrag,
    accountDropBefore,
    accountFolders,
    accountMenu,
    accountSpringRef,
    busyFolder,
    collapsed,
    collapsedAccounts,
    confirmDelete,
    creatingFor,
    creatingIn,
    creatingUnder,
    deleting,
    draftCount,
    dragOver,
    dragging,
    dropFolderAtTop,
    dropFolderInto,
    dropPlaceAt,
    dropStateFor,
    favouriteKeys,
    favouriteRows,
    filtered,
    fixedMenu,
    folderDrag,
    isOutlookAccount,
    loading,
    menu,
    movingFolder,
    newName,
    onDropInbox,
    onDropJunk,
    onDropThread,
    onDropTrash,
    onOpenArchived,
    onOpenDrafts,
    onOpenFolder,
    onOpenInbox,
    onOpenJunk,
    onOpenSent,
    onOpenTrash,
    onRenameFolder,
    onReorderAccount,
    openAccount,
    openCollapsed,
    openFixedMenu,
    openFolder,
    query,
    railAccounts,
    railRef,
    renamingKey,
    revealFolder,
    revealed,
    runDelete,
    saving,
    sectionRefs,
    setAccountDrag,
    setAccountDropBefore,
    setAccountMenu,
    setConfirmDelete,
    setCreatingFor,
    setCreatingUnder,
    setDragOver,
    setFixedMenu,
    setFolderDrag,
    setMenu,
    setMovingFolder,
    setNewName,
    setQuery,
    setRenamingKey,
    side,
    submitNewFolder,
    submitRename,
    submitSubfolder,
    systemTwoUp,
    systemView,
    t,
    toggleAccount,
    toggleCollapsed,
    whileBusy,
  } = useFolderRail(props);

  const renderNodes = (nodes: FolderTreeNode[], account: string, depth = 0) =>
    nodes.map((node) => {
      const key = collapsedFolderKey(account, node.name);
      // A filter opens what it found: a match hidden inside a folded parent
      // is a match the reader cannot see or drop onto.
      const isCollapsed = query.trim() ? false : collapsed.has(key);
      const hasChildren = node.children.length > 0;
      return (
        <React.Fragment key={node.name}>
          <FolderRow
            node={node}
            depth={depth}
            collapsed={isCollapsed}
            hasChildren={hasChildren}
            active={
              openFolder?.name.toLowerCase() === node.name.toLowerCase() &&
              (openFolder.account ?? "").toLowerCase() ===
                account.toLowerCase()
            }
            favourite={favouriteKeys.has(
              folderFavouriteKey(account, node.name)
            )}
            drop={dropStateFor(account)}
            dragOver={dragOver}
            setDragOver={setDragOver}
            folderDrag={folderDrag}
            onFolderDragStart={setFolderDrag}
            onFolderDragEnd={() => setFolderDrag(null)}
            onFolderDrop={(target) => void dropFolderInto(target)}
            renaming={
              renamingKey === folderFavouriteKey(account, node.name)
            }
            revealed={revealed === folderFavouriteKey(account, node.name)}
            busy={busyFolder === folderFavouriteKey(account, node.name)}
            onContextMenu={(event) => {
              // A parent standing in for one nobody made: there is nothing
              // at the provider to rename, and nothing to file into it.
              if (node.implied) return;
              event.preventDefault();
              setAccountMenu(null);
              setFixedMenu(null);
              // Inbox is the row a reader reaches for when they want a
              // folder to put mail in, and it was the one row that handed
              // them the browser's menu instead of ours.
              setMenu({
                node,
                x: event.clientX,
                y: event.clientY,
                fixed: Boolean(node.virtual || node.role),
              });
            }}
            onRenameSubmit={(next) => void submitRename(node, next)}
            onRenameCancel={() => setRenamingKey(null)}
            onOpen={() => onOpenFolder(account, node.name)}
            onToggleCollapse={() => toggleCollapsed(account, node.name)}
            onToggleFavourite={() =>
              toggleFolderFavourite(account, node.name)
            }
            onDropThread={() => void onDropThread(account, node.name)}
            onSpringOpen={() => openCollapsed(account, node.name)}
          />
          {creatingUnder?.account === account &&
          creatingUnder.parent === node.name ? (
            <input
              autoFocus
              value={newName}
              disabled={saving}
              placeholder={t("newFolderName")}
              aria-label={t("newFolderInside", { name: node.label })}
              className="mb-1 mt-0.5 w-full rounded-md border border-teal-500 bg-white px-2 py-1 text-sm outline-none"
              // Where the folder will be: one step in from its parent, in
              // the place the row itself will take once it exists.
              style={{ marginLeft: (depth + 1) * 14 }}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => setCreatingUnder(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitSubfolder();
                } else if (e.key === "Escape") {
                  e.stopPropagation();
                  setCreatingUnder(null);
                }
              }}
            />
          ) : null}
          {hasChildren && !isCollapsed
            ? renderNodes(node.children, account, depth + 1)
            : null}
        </React.Fragment>
      );
    });
  const sentRow = (
    <SystemRow
      icon={Send}
      label={t("viewSent")}
      active={systemView === "sent"}
      // You never file into Sent or Drafts. Dimmed mid-drag so the rule
      // is visible before the drop rather than after it.
      drop={dragging ? "dim" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenSent}
      onContextMenu={openFixedMenu}
    />
  );
  const draftsRow = (
    <SystemRow
      icon={FilePen}
      label={t("viewDrafts")}
      count={draftCount}
      active={systemView === "drafts"}
      drop={dragging ? "dim" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenDrafts}
      onContextMenu={openFixedMenu}
    />
  );
  const trashRow = (
    <SystemRow
      icon={Trash2}
      label={t("viewTrash")}
      active={systemView === "trash"}
      drop={dragging ? "live" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenTrash}
      onContextMenu={openFixedMenu}
      onDropThread={() => void onDropTrash()}
    />
  );
  const inboxRow = (
    <SystemRow
      icon={Inbox}
      label={t("viewInbox")}
      active={systemView === "inbox"}
      /* A drop target like the rest.
         It was dimmed on the argument that the inbox is where a conversation
         already was — true of one dragged out of the inbox, and not of one
         dragged out of the archive, the bin or a folder, which is the case a
         reader actually has in hand when they drag onto Inbox. It goes back
         to the mailbox it belongs to; nothing here can move mail between
         accounts. */
      drop={dragging && onDropInbox ? "live" : dragging ? "dim" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenInbox}
      onContextMenu={openFixedMenu}
      onDropThread={onDropInbox ? () => void onDropInbox() : undefined}
    />
  );
  const junkRow = (
    <SystemRow
      icon={ShieldAlert}
      label={t("viewJunk")}
      active={systemView === "junk"}
      // Filing something as junk is a real thing to want, and the move
      // menu is not the only place to want it.
      drop={dragging ? "live" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenJunk}
      onContextMenu={openFixedMenu}
      onDropThread={() => void onDropJunk?.()}
    />
  );
  const archivedRow = (
    <SystemRow
      icon={Archive}
      label={t("viewArchived")}
      active={systemView === "archived"}
      /* Nothing is filed into Archived. On Gmail it is not a folder at all
         — it is everything the inbox label has been taken off — and the
         archive action is what puts mail there. */
      drop={dragging ? "dim" : "rest"}
      dragOver={dragOver}
      setDragOver={setDragOver}
      onClick={onOpenArchived}
      onContextMenu={openFixedMenu}
    />
  );
  return (
    <aside
      ref={railRef}
      aria-label={t("folders")}
      /**
       * The head stays; the mailboxes scroll under it.
       *
       * Done by splitting the rail rather than by sticking the head to the
       * top of one long scroll: a sticky head sits over the rows passing
       * beneath it, and a row half under it is still a drop target. Two
       * boxes, one fixed and one scrolling, cannot overlap at all.
       */
      className={cn(
        "group/rail flex h-full w-full shrink-0 flex-col overflow-hidden border-[var(--mail-chrome-border)] bg-[var(--mail-chrome)] px-2 pt-1",
        side === "right" ? "border-l" : "border-r"
      )}
    >
      {/* What this column is. The way out of it is the folder button that
          opened it, which closes it again — one control for the pair, so
          the rail carries no cross of its own. */}
      <div className="flex shrink-0 items-center gap-1 pl-2">
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-[var(--mail-chrome-muted)]">
          {t("folders")}
        </p>
      </div>

      {/*
        The four views. One set, across every mailbox — there is no
        per-account Trash to keep, and never was.

        Two columns when two will fit, and one when they will not. Four rows
        of one word each, stacked, take a fifth of a rail that has folders to
        show; side by side they take half of that.

        The order changes with the shape, which is why the width is measured
        rather than left to the grid. Stacked, they run in the order they
        are spoken about: Inbox, Sent, Drafts, Trash. Two abreast, the pair
        that holds mail stands on the left and the pair you write from on
        the right — so the grid is dealt Inbox, Sent, Trash, Drafts, and
        reads down as Inbox/Trash and Sent/Drafts.

        Six, in two columns of three that read down: Drafts, Junk, Trash,
        and beside them Inbox, Sent, Archived — the mail you are writing or
        have thrown out on one side, the mail that arrived and where it goes
        on the other. The grid fills across, so the order below is those two
        columns interleaved.

        In one column they read in the order a reader wants them: Inbox,
        Sent, Archived first, then Drafts, Junk, Trash.

        Junk and Archived were listed under each account only, on the
        argument that across every mailbox at once they are places nobody
        reads. Asked for here, and the argument was thin: a reader who wants
        to know what was filed as junk does not want to ask it once per
        mailbox. Both are still under each account, where the question is
        what *this* account holds.
      */}
      <div
        className={cn(
          "grid shrink-0 gap-x-2",
          systemTwoUp ? "grid-cols-2" : "grid-cols-1"
        )}
      >
        {systemTwoUp ? (
          <>
            {draftsRow}
            {inboxRow}
            {junkRow}
            {sentRow}
            {trashRow}
            {archivedRow}
          </>
        ) : (
          <>
            {inboxRow}
            {sentRow}
            {archivedRow}
            {draftsRow}
            {junkRow}
            {trashRow}
          </>
        )}
      </div>

      {favouriteRows.length ? (
        // Capped, and scrolling inside the cap. Everything above the filter
        // box is now held out of the scroll, so a reader with twenty
        // favourites would otherwise pin twenty rows and leave the folders
        // a sliver at the bottom.
        <div className="mt-3 flex max-h-[35%] shrink-0 flex-col">
          <p className="flex shrink-0 items-center gap-1 px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--mail-chrome-muted)]">
            <HeartIcon className="h-3 w-3" filled />
            {t("favourites")}
          </p>
          <div className="min-h-0 overflow-y-auto">
          {favouriteRows.map((node) => (
            <FolderRow
              key={folderFavouriteKey(node.account, node.name)}
              node={node}
              depth={0}
              collapsed
              hasChildren={false}
              active={
                openFolder?.name.toLowerCase() === node.name.toLowerCase() &&
                (openFolder.account ?? "").toLowerCase() ===
                  node.account.toLowerCase()
              }
              favourite
              drop={dropStateFor(node.account)}
              dragOver={dragOver}
              setDragOver={setDragOver}
              folderDrag={folderDrag}
              onFolderDragStart={setFolderDrag}
              onFolderDragEnd={() => setFolderDrag(null)}
              onFolderDrop={(target) => void dropFolderInto(target)}
              // The mailboxes are mixed up here, so each row has to say
              // which one it is on. In the sections below, the heading says.
              accountTag={node.account}
              inFavourites
              onOpen={() => onOpenFolder(node.account, node.name)}
              onToggleCollapse={() => {}}
              onToggleFavourite={() => {
                // Every row here is a favourite, so this only ever removes
                // one — and the row goes with it.
                toggleFolderFavourite(node.account, node.name);
                revealFolder(node.account, node.name);
              }}
              onDropThread={() => void onDropThread(node.account, node.name)}
              onSpringOpen={() => {}}
            />
          ))}
          </div>
        </div>
      ) : null}

      {/* Under the divider, over the sections: it narrows what is below it
          and never the four views above, and standing between the two is
          how it says so. */}
      <div className="mt-3 shrink-0 border-t border-[var(--mail-chrome-border)] pt-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("filterFoldersPlaceholder")}
          aria-label={t("filterFolders")}
          className="w-full rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm outline-none placeholder:text-stone-400 focus:border-stone-300"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
      </div>

      <div
        /* Room at the top for the line that says "in front of the first
           one". It is drawn just above the section it points at, and the
           first section starts at the very top of the scroll — so without
           this the one line the reader needed most was the one line the
           rail cut off. */
        className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pt-1.5 pb-2"
        /*
          The rail answers for a mailbox in the air, from top to bottom.

          Every place a mailbox can go is a space between two others, and
          the rail is read as a whole to find which space the pointer is in
          — including the two that are not between anything: above
          everything, and below everything. Both used to be hard to reach or
          impossible. See `dropPlaceAt`.
        */
        onDragOver={(e) => {
          if (!accountDrag) return;
          const place = dropPlaceAt(e.clientY);
          if (place === undefined) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setAccountDropBefore(place);
        }}
        onDrop={(e) => {
          if (!accountDrag) return;
          const place = dropPlaceAt(e.clientY);
          if (place === undefined) return;
          e.preventDefault();
          e.stopPropagation();
          const moved = accountDrag;
          setAccountDrag(null);
          setAccountDropBefore(undefined);
          void onReorderAccount?.(moved, place);
        }}
      >
        {loading && !accountFolders.length ? (
          <p className="px-2 py-4 text-center text-xs text-stone-400">
            {t("loadingFolders")}
          </p>
        ) : null}
        {filtered.map(({ account, nodes }) => {
          const state = dropStateFor(account);
          /**
           * While a conversation is in the air, only its own mailbox is
           * open.
           *
           * Dimming the other mailboxes said they would refuse the drop,
           * which was true and not much help: their folders were still
           * there, eighty of them on a working account, and the folder
           * actually being aimed at could be a long scroll below all of it
           * — with a thread held down the whole way.
           *
           * The headings stay, so the rail is still the shape the reader
           * knows. And this settles at the moment the drag starts, before
           * the pointer has reached the rail at all, so the rule that
           * nothing moves once you are aiming still holds.
           *
           * The source mailbox is opened whether or not it was, because it
           * is the one place the conversation can go. None of it is
           * written down: when the drag ends the reader's own arrangement
           * comes back.
           *
           * A filter opens what it found, here as much as inside a folder:
           * a match under a folded mailbox is a match nobody can see or
           * drop onto.
           *
           * A mailbox in the air folds every mailbox, its own included. The
           * move is an arrangement of the headings and nothing else, and
           * with the folders open the headings are pages apart — the reader
           * had to drag a mailbox across a list of somebody else's folders
           * to reach a place two names above it, and a place off the top of
           * the rail could not be reached at all. Folded, the whole
           * arrangement is in view and every space in it is a short move
           * away. It is not written down either: the folders come back open
           * when the drag ends.
           */
          const accountShut = accountDrag
            ? true
            : dragging
              ? state !== "live"
              : !query.trim() &&
                collapsedAccounts.has(collapsedAccountKey(account));
          const dropAbove = accountDrag !== null && accountDropBefore === account;
          /* Last in the rail, and the drop is "after everything". */
          const dropAtEnd =
            accountDrag !== null &&
            accountDropBefore === null &&
            railAccounts[railAccounts.length - 1] === account;
          return (
            <div
              key={account}
              /* The section says where it is, and the rail as a whole says
                 what a drop there would mean. */
              ref={(node) => {
                if (node) sectionRefs.current.set(account, node);
                else sectionRefs.current.delete(account);
              }}
              className="relative"
            >
              {/* Where it would land. A line between two headings, because
                  that is what the move is: a place in a list, not a thing to
                  be dropped onto. */}
              {dropAbove ? (
                <span
                  aria-hidden
                  /* Half the gap above the heading, so the line reads as
                     the space between two mailboxes rather than as a rule
                     over the name below it. */
                  className="pointer-events-none absolute inset-x-1 -top-[5px] z-10 h-0.5 rounded-full bg-teal-500"
                />
              ) : null}
              {dropAtEnd ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-1 -bottom-[3px] z-10 h-0.5 rounded-full bg-teal-500"
                />
              ) : null}
              <div
                className={cn(
                  "flex items-center gap-1 pr-2 pb-1",
                  state === "dim" && "opacity-40"
                )}
                /* Making a folder is the only thing there is to do to a
                   mailbox from here, and it is rare — so it waits behind a
                   right-click, the way everything you do to a folder does,
                   rather than appearing under the pointer on a row that is
                   otherwise just a name. */
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenu(null);
                  setFixedMenu(null);
                  setAccountMenu({
                    account,
                    x: event.clientX,
                    y: event.clientY,
                  });
                }}
              >
                {/* The whole heading turns the mailbox, rather than the
                    triangle alone. A folder row has two jobs — open it, or
                    fold it — and needs the two apart. A heading has only
                    this one, so the small target would be a small target
                    for no reason. */}
                <button
                  type="button"
                  aria-expanded={!accountShut}
                  title={account}
                  /* The heading is the mailbox, so the heading is what you
                     pick up to move it. Only when nothing else is in the
                     air: a rail that answers two drags at once answers
                     neither. */
                  draggable={Boolean(onReorderAccount) && !dragging && !folderDrag}
                  /*
                    The two properties this webview actually reads, set where
                    they survive — `select-none` above compiles to the
                    unprefixed rule alone, and `-webkit-user-drag` cannot be
                    written as a class at all. The same pair the folder rows
                    carry; see `FolderRow`.
                  */
                  style={{
                    WebkitUserSelect: "none",
                    ...(onReorderAccount
                      ? ({ WebkitUserDrag: "element" } as React.CSSProperties)
                      : null),
                  }}
                  onDragStart={(event) => {
                    if (!onReorderAccount) return;
                    event.stopPropagation();
                    event.dataTransfer.setData(MAIL_ACCOUNT_DRAG_TYPE, account);
                    // A payload the browser knows, as well as ours: WebKit
                    // will not begin a drag that carries nothing it can read.
                    event.dataTransfer.setData(
                      "text/plain",
                      `redd-mail-account:${account}`
                    );
                    event.dataTransfer.effectAllowed = "move";
                    setFolderDragImage(event.dataTransfer, account);
                    // After the handler, not during it. Setting state here
                    // rebuilds the row under the drag, which cancels it.
                    setTimeout(() => setAccountDrag(account), 0);
                  }}
                  onDragEnd={() => {
                    clearFolderDragImage();
                    setAccountDrag(null);
                    setAccountDropBefore(undefined);
                  }}
                  /*
                    A heading takes two kinds of drop, and they are told
                    apart by what is in the air.

                    A mailbox lands on it and takes its place. A folder
                    dropped on it comes out of whatever holds it — without
                    somewhere to mean "the top", a folder dragged into
                    another could never come back out, and the rail would
                    nest and never unnest.
                  */
                  onDragOver={(e) => {
                    // An account in the air is the section's to answer.
                    if (accountDrag) return;
                    if (!folderDrag) return;
                    if (
                      folderDrag.account.toLowerCase() !==
                      account.toLowerCase()
                    ) {
                      return;
                    }
                    if (!folderParentPath(folderDrag.name)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    if (accountDrag) return;
                    if (!folderDrag) return;
                    e.preventDefault();
                    e.stopPropagation();
                    void dropFolderAtTop(account);
                  }}
                  className={cn(
                    // select-none, for the same reason a folder row has it:
                    // a right-click on a name took the name as well as the
                    // menu, and a pull across the heading swept a highlight
                    // over it. The mailbox is something to point at, not
                    // something to copy.
                    "flex min-w-0 flex-1 select-none items-center gap-1 rounded-md py-0.5 pl-1 pr-1 text-left",
                    "hover:bg-[var(--mail-chrome-hover)]",
                    // The one being carried. Where it would land is a line
                    // between headings, drawn on the section — see below.
                    accountDrag === account && "opacity-40"
                  )}
                  onClick={() => toggleAccount(account)}
                  onDragEnter={() => {
                    // Same as a folded folder: hovering it mid-drag opens
                    // it, so the mailbox you are filing into need not have
                    // been left open. A mailbox being dragged is not being
                    // filed into, so it opens nothing.
                    if (accountDrag) return;
                    if (state !== "live" || !accountShut) return;
                    if (accountSpringRef.current) {
                      clearTimeout(accountSpringRef.current);
                    }
                    accountSpringRef.current = setTimeout(() => {
                      accountSpringRef.current = null;
                      openAccount(account);
                    }, SPRING_OPEN_MS);
                  }}
                  onDragLeave={() => {
                    if (!accountSpringRef.current) return;
                    clearTimeout(accountSpringRef.current);
                    accountSpringRef.current = null;
                  }}
                >
                  <ChevronRight
                    aria-hidden
                    className={cn(
                      "h-3 w-3 shrink-0 transition-transform",
                      !accountShut && "rotate-90",
                      state === "live"
                        ? "text-teal-700"
                        : "text-[var(--mail-chrome-muted)]"
                    )}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide",
                      // Dark enough to read. It was the same faint grey as a
                      // folder's count, which is a number you glance at — but
                      // this names the mailbox everything under it belongs to,
                      // and at 11px, uppercase and tracked out, faint grey is
                      // the hardest thing on the rail to read.
                      //
                      // The muted chrome colour rather than a stone: the rail
                      // sits on chrome, which is cream in one mode and navy in
                      // the other, and a fixed grey can only suit one.
                      //
                      // The mailbox the conversation came from is the one it
                      // can go into. Naming it in teal answers "why will that
                      // folder not take it" before it is asked.
                      state === "live"
                        ? "text-teal-700"
                        : "text-[var(--mail-chrome-muted)]"
                    )}
                  >
                    {account}
                  </span>
                  {/*
                    The mailbox carries the wait for a folder made on it.

                    A provider takes a second or two to make one, and until
                    now the only word of it was the toast at the end — by
                    which time the reader had been looking at an unchanged
                    rail wondering whether the Enter had landed.
                  */}
                  {creatingIn === account ? (
                    <Loader2
                      className="h-3 w-3 shrink-0 animate-spin text-[var(--mail-chrome-muted)]"
                      aria-hidden
                    />
                  ) : null}
                </button>
              </div>
              {accountShut ? null : creatingFor === account ? (
                <input
                  autoFocus
                  value={newName}
                  disabled={saving}
                  placeholder={t("newFolderName")}
                  aria-label={t("newFolderNameOn", { account })}
                  className="mb-1 w-full rounded-md border border-teal-500 bg-white px-2 py-1 text-sm outline-none"
                  onChange={(e) => setNewName(e.target.value)}
                  onBlur={() => setCreatingFor(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitNewFolder(account);
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setCreatingFor(null);
                    }
                  }}
                />
              ) : null}
              {accountShut ? null : nodes.length ? (
                renderNodes(nodes, account)
              ) : loading ? (
                /* Nothing, while the answer is still on its way.
                   "No folders yet" is a statement about the mailbox, and
                   under a heading whose folders have not arrived it reads
                   as one — the reader is told their account is empty by a
                   rail that has simply not been told otherwise. The line
                   above the sections says loading once, which is the right
                   number of times to say it. */
                null
              ) : (
                <p className="px-2 py-1 text-xs text-stone-400">
                  {query.trim() ? t("noFolderByThatName") : t("noFoldersYet")}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {menu ? (
        <FolderContextMenu
          x={menu.x}
          y={menu.y}
          onDismiss={() => setMenu(null)}
          note={menu.fixed ? t("systemFolderFixed") : undefined}
          onRename={
            menu.fixed
              ? undefined
              : () => {
                  setRenamingKey(
                    folderFavouriteKey(menu.node.account, menu.node.name)
                  );
                  setMenu(null);
                }
          }
          onNewSubfolder={() => {
            // Open the parent, or the box would be typed into behind a
            // triangle and the folder would appear somewhere unseen.
            openCollapsed(menu.node.account, menu.node.name);
            setCreatingFor(null);
            setCreatingUnder({
              account: menu.node.account,
              parent: menu.node.name,
            });
            setNewName("");
            setMenu(null);
          }}
          onMove={
            menu.fixed
              ? undefined
              : () => {
                  setMovingFolder({ node: menu.node, x: menu.x, y: menu.y });
                  setMenu(null);
                }
          }
          onDelete={
            menu.fixed
              ? undefined
              : () => {
                  setConfirmDelete({ node: menu.node, x: menu.x, y: menu.y });
                  setMenu(null);
                }
          }
        />
      ) : null}
      {fixedMenu ? (
        <FolderContextMenu
          x={fixedMenu.x}
          y={fixedMenu.y}
          note={t("systemFolderFixed")}
          onDismiss={() => setFixedMenu(null)}
        />
      ) : null}
      {accountMenu ? (
        <FolderContextMenu
          x={accountMenu.x}
          y={accountMenu.y}
          onDismiss={() => setAccountMenu(null)}
          onNewFolder={() => {
            // Somewhere to put it, and somewhere to see it made.
            openAccount(accountMenu.account);
            setCreatingUnder(null);
            setCreatingFor(accountMenu.account);
            setNewName("");
            setAccountMenu(null);
          }}
        />
      ) : null}
      {movingFolder ? (
        <FolderMovePicker
          moving={movingFolder.node}
          rows={accountFolders.filter(
            (f) =>
              f.account.toLowerCase() ===
              movingFolder.node.account.toLowerCase()
          )}
          x={movingFolder.x}
          y={movingFolder.y}
          onDismiss={() => setMovingFolder(null)}
          onMove={(target) => {
            const node = movingFolder.node;
            setMovingFolder(null);
            // The same rename the drag uses: a folder's name is where it
            // is, so moving it is giving it the name of where it is going.
            void whileBusy(node.account, node.name, async () => {
              try {
                await onRenameFolder(
                  node.account,
                  node.name,
                  target ? `${target}/${node.label}` : node.label
                );
              } catch (err) {
                toast.error(
                  err instanceof Error
                    ? err.message
                    : t("couldNotMoveFolder")
                );
              }
            });
          }}
        />
      ) : null}
      {confirmDelete ? (
        <FolderDeleteConfirm
          x={confirmDelete.x}
          y={confirmDelete.y}
          label={confirmDelete.node.label}
          onOutlook={isOutlookAccount(confirmDelete.node.account)}
          busy={deleting}
          onConfirm={() => void runDelete()}
          onDismiss={() => setConfirmDelete(null)}
        />
      ) : null}
    </aside>
  );
}

