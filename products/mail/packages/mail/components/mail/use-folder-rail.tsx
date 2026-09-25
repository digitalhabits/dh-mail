"use client";

/*
 * Everything the folder rail knows and does, apart from what it draws: the
 * filter, which sections and folders are collapsed, the favourites, new
 * folders, renaming, deleting and moving a folder, and the drag of a
 * mailbox to a new place in the order.
 *
 * MailFolderRail calls this once, at its top, and draws from what it
 * returns. The statements here are the rail's own, in the order they ran,
 * so the hooks run in the same order as before.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";

import {
  buildFolderTree,
  filterFolderTree,
  flattenFolderTree,
  folderAncestors,
  type FolderTreeNode,
} from "@/lib/mail/folder-tree";
import {
  collapsedAccountKey,
  collapsedFolderKey,
  readCollapsedAccounts,
  readCollapsedFolders,
  writeCollapsedAccounts,
  writeCollapsedFolders,
} from "@/lib/mail/folder-rail";
import {
  folderFavouriteKey,
  pruneFolderFavourites,
  useFolderFavourites,
} from "@/lib/mail/folder-favourites";
import { accountsWithFolders, type MailAccountFolder } from "@/lib/mail/folder-types";
import {
  accountDropPlace,
  type AccountSpan,
} from "@/lib/mail/account-order";
import { useIsOutlookAccount } from "@/lib/mail/use-outlook-accounts";
import { useMailT } from "@/lib/mail/i18n";
import {
  type FolderRailProps,
  REVEAL_MS,
  SYSTEM_TWO_UP_WIDTH,
  scrollingAncestor,
} from "@/components/mail/folder-rail-shared";
import {
  type DropState,
  type FolderDrag,
  folderAcceptsFolder,
  folderParentPath,
} from "@/lib/mail/folder-drop";

export function useFolderRail(props: FolderRailProps) {
  const {
    accountFolders,
    loading,
    accounts,
    openFolder,
    systemView,
    draftCount,
    onOpenFolder,
    onOpenSent,
    onOpenDrafts,
    onOpenTrash,
    onOpenInbox,
    onOpenJunk,
    onOpenArchived,
    onCreateFolder,
    onReorderAccount,
    onRenameFolder,
    onDeleteFolder,
    draggingAccount,
    onDropThread,
    onDropTrash,
    onDropJunk,
    onDropInbox,
    side = "left",
  } = props;

  const t = useMailT();
  const railRef = React.useRef<HTMLElement>(null);
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsedState] = React.useState<Set<string>>(
    () => new Set()
  );
  /**
   * Whole mailboxes folded shut.
   *
   * Three accounts of eighty folders is a rail nobody can see the bottom
   * of, and the two you are not filing into today are most of it.
   */
  const [collapsedAccounts, setCollapsedAccountsState] = React.useState<
    Set<string>
  >(() => new Set());
  const [creatingFor, setCreatingFor] = React.useState<string | null>(null);
  /**
   * The mailbox a folder is being made on, while the provider makes it.
   *
   * Its own state, and not `creatingFor` and `saving` together, because the
   * name box does not survive the wait: it is disabled the moment the work
   * starts, a disabled field cannot hold focus, and the blur that follows is
   * the one that closes the box. So by the time there was anything to wait
   * for, `creatingFor` was already null and the spinner had nothing to hang
   * from.
   */
  const [creatingIn, setCreatingIn] = React.useState<string | null>(null);
  /**
   * A folder being made inside another, by mailbox and parent name.
   *
   * Kept apart from `creatingFor`, which names a mailbox: one of these
   * puts a box under a heading and the other puts it under a row, and
   * having both open at once would be two boxes wanting the same name.
   */
  const [creatingUnder, setCreatingUnder] = React.useState<{
    account: string;
    parent: string;
  } | null>(null);
  /**
   * The folder under the right-click, and where the pointer was.
   *
   * The node rather than its name: what the menu can offer depends on what
   * the folder is, and a parent nobody made or a row standing for a search
   * cannot be renamed because there is nothing at the provider to rename.
   */
  const [menu, setMenu] = React.useState<{
    node: FolderTreeNode;
    x: number;
    y: number;
    /**
     * The provider owns this row — Inbox, Sent, Trash and the rest.
     *
     * It answers a right-click all the same, with the one thing that is
     * true of it: something can be filed under it. The rest of the menu
     * would be a lie, since none of these can be renamed, moved or thrown
     * away from here.
     */
    fixed?: boolean;
  } | null>(null);
  /** The mailbox heading that was right-clicked, and where. */
  const [accountMenu, setAccountMenu] = React.useState<{
    account: string;
    x: number;
    y: number;
  } | null>(null);
  /** Where a right-click landed on Sent, Drafts, Trash, or Junk. */
  const [fixedMenu, setFixedMenu] = React.useState<{
    x: number;
    y: number;
  } | null>(null);
  /** The folder being renamed, by mailbox and whole name. */
  const [renamingKey, setRenamingKey] = React.useState<string | null>(null);
  /** The folder being asked about, and where the asking is drawn. */
  const [confirmDelete, setConfirmDelete] = React.useState<{
    node: FolderTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  /** The folder being moved by menu rather than by hand, and where to draw. */
  const [movingFolder, setMovingFolder] = React.useState<{
    node: FolderTreeNode;
    x: number;
    y: number;
  } | null>(null);
  const isOutlookAccount = useIsOutlookAccount();
  /** One at a time: the pointer is only ever over one heading. */
  const accountSpringRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  React.useEffect(
    () => () => {
      if (accountSpringRef.current) clearTimeout(accountSpringRef.current);
    },
    []
  );
  const [newName, setNewName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const favourites = useFolderFavourites();
  React.useEffect(() => {
    setCollapsedState(readCollapsedFolders());
    setCollapsedAccountsState(readCollapsedAccounts());
  }, []);
  const setCollapsed = React.useCallback(
    (next: Set<string>) => {
      setCollapsedState(next);
      writeCollapsedFolders(next);
    },
    []
  );
  const toggleAccount = React.useCallback((account: string) => {
    setCollapsedAccountsState((current) => {
      const key = collapsedAccountKey(account);
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeCollapsedAccounts(next);
      return next;
    });
  }, []);
  const openAccount = React.useCallback((account: string) => {
    setCollapsedAccountsState((current) => {
      const key = collapsedAccountKey(account);
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      writeCollapsedAccounts(next);
      return next;
    });
  }, []);
  const toggleCollapsed = React.useCallback(
    (account: string, name: string) => {
      const key = collapsedFolderKey(account, name);
      const next = new Set(collapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setCollapsed(next);
    },
    [collapsed, setCollapsed]
  );
  /**
   * A folder taken off the favourites is shown where it actually lives.
   *
   * Unfavouriting from the band at the top makes the row vanish from under
   * the pointer, and its real home may be forty rows down inside two folded
   * folders — so the folder reads as deleted rather than unpinned. This
   * opens the way to it, brings it into view and rings it for a moment.
   *
   * Only from the band. Unfavouriting from the row itself changes nothing
   * about where that row is, and scrolling to what is already under the
   * pointer would be the app taking the view away for no reason.
   */
  const [revealed, setRevealed] = React.useState<string | null>(null);
  /** The reveal the rail has already scrolled to, so it goes there once. */
  const scrolledToRef = React.useRef<string | null>(null);
  /**
   * The one row a dropped conversation would land on.
   *
   * Held here rather than on each row, so that lighting one puts the last
   * one out — see `useDragOver`.
   */
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  /** The folder in the air, while one is. */
  const [folderDrag, setFolderDrag] = React.useState<FolderDrag | null>(null);
  /** The mailbox heading being dragged. */
  const [accountDrag, setAccountDrag] = React.useState<string | null>(null);
  /**
   * Wide enough for the four views to stand two abreast.
   *
   * Measured, because the rail is dragged to whatever width its reader wants
   * and a media query only knows about the window. The number is what two
   * columns need: 6.5rem each and the gap between them.
   */
  const [systemTwoUp, setSystemTwoUp] = React.useState(false);
  React.useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      setSystemTwoUp(entry.contentRect.width >= SYSTEM_TWO_UP_WIDTH);
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
  /** Each mailbox section, so a drop can be told which space it is in. */
  const sectionRefs = React.useRef(new Map<string, HTMLDivElement>());
  /**
   * Where it would land: in front of this mailbox, or at the end.
   *
   * A place between two headings rather than a heading — a mailbox has no
   * inside, so there is nothing to drop one onto. The rail draws it as a
   * line, which is the only honest picture of "it goes here".
   */
  const [accountDropBefore, setAccountDropBefore] = React.useState<
    string | null | undefined
  >(undefined);
  /**
   * A folder the provider has been asked about and has not answered.
   *
   * Both providers take seconds over a move, and the rail cannot show it
   * in its new place until they say it is there — so for those seconds the
   * folder sat exactly where it had been, with nothing to say anything had
   * been asked at all.
   */
  const [busyFolder, setBusyFolder] = React.useState<string | null>(null);
  /** Hold the row while the provider is asked, whatever it is asked. */
  const whileBusy = React.useCallback(
    async (account: string, name: string, run: () => Promise<void>) => {
      setBusyFolder(folderFavouriteKey(account, name));
      try {
        await run();
      } finally {
        setBusyFolder(null);
      }
    },
    []
  );
  /**
   * Moving a folder is renaming it to where it is going.
   *
   * Both providers already read a name as a place — a Gmail label is its
   * whole path, and the Outlook rename compares the parent it had with the
   * parent it is being given and re-parents when they differ — so there is
   * nothing here a move needs that a rename did not already do.
   */
  const dropFolderInto = React.useCallback(
    async (target: FolderTreeNode) => {
      const drag = folderDrag;
      setFolderDrag(null);
      setDragOver(null);
      if (!drag || !folderAcceptsFolder(drag, target)) return;
      const held = drag;
      // Open where it is going, so it can be seen to have arrived.
      setCollapsedState((current) => {
        const key = collapsedFolderKey(target.account, target.name);
        if (!current.has(key)) return current;
        const next = new Set(current);
        next.delete(key);
        writeCollapsedFolders(next);
        return next;
      });
      await whileBusy(held.account, held.name, async () => {
        try {
          await onRenameFolder(
            held.account,
            held.name,
            `${target.name}/${held.label}`
          );
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : t("couldNotMoveFolder")
          );
        }
      });
    },
    [folderDrag, onRenameFolder, whileBusy, t]
  );
  /** Out of whatever holds it, back to the top of its own mailbox. */
  const dropFolderAtTop = React.useCallback(
    async (account: string) => {
      const drag = folderDrag;
      setFolderDrag(null);
      setDragOver(null);
      if (!drag) return;
      if (drag.account.toLowerCase() !== account.toLowerCase()) return;
      // Already there: nothing above it to come out of.
      if (!folderParentPath(drag.name)) return;
      await whileBusy(drag.account, drag.name, async () => {
        try {
          await onRenameFolder(drag.account, drag.name, drag.label);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : t("couldNotMoveFolder")
          );
        }
      });
    },
    [folderDrag, onRenameFolder, whileBusy, t]
  );
  const revealFolder = React.useCallback(
    (account: string, name: string) => {
      openAccount(account);
      setCollapsedState((current) => {
        const next = new Set(current);
        let changed = false;
        for (const path of folderAncestors(name)) {
          if (next.delete(collapsedFolderKey(account, path))) changed = true;
        }
        if (!changed) return current;
        writeCollapsedFolders(next);
        return next;
      });
      setRevealed(folderFavouriteKey(account, name));
    },
    [openAccount]
  );
  /** Stop pointing at it after a beat. */
  React.useEffect(() => {
    if (!revealed) {
      scrolledToRef.current = null;
      return;
    }
    const timer = window.setTimeout(() => setRevealed(null), REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  /**
   * Once it is on screen, scroll to it. Once, and not before it is there.
   *
   * A folder just made is not in the rail when the reveal is asked for: the
   * provider answers, the whole list is read back, and the row arrives a
   * render or two later. Looking for it on the next frame found nothing and
   * gave up — which is why a new folder was ringed where it stood and never
   * scrolled to.
   *
   * So this looks after every render while a reveal is pending, and takes
   * the rail there the first time the row exists.
   */
  React.useEffect(() => {
    if (!revealed || scrolledToRef.current === revealed) return;
    /*
      Read back and compared here, rather than asked for in a selector.

      The key joins the mailbox to the folder with a NUL, which is the one
      character `CSS.escape` cannot carry: the rules say to write it as the
      replacement character instead, so the selector asked for a key with a
      U+FFFD in it and no row ever had one. The ring showed, because that is
      a comparison in JavaScript, and the rail never moved.
    */
    const rows = railRef.current?.querySelectorAll<HTMLElement>(
      "[data-folder-row]"
    );
    const row = rows
      ? Array.from(rows).find((el) => el.dataset.folderRow === revealed)
      : undefined;
    if (!row) return;
    scrolledToRef.current = revealed;
    const gently = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    row.scrollIntoView({ block: "center", behavior: gently ? "smooth" : "auto" });
    if (!gently) return;
    /*
      And again, without the animation, if the animation did nothing.

      A smooth scroll is a request the engine may decline — this webview
      declines it — and a reveal that does not move is no reveal at all: the
      folder ends up ringed somewhere off the bottom of the rail, which is
      the very thing the scroll is for. So the scroller is read a beat later,
      and if it has not moved the rail is simply put there.
    */
    const scroller = scrollingAncestor(row);
    const before = scroller?.scrollTop;
    window.setTimeout(() => {
      if (!scroller || scroller.scrollTop !== before) return;
      row.scrollIntoView({ block: "center", behavior: "auto" });
    }, 150);
  });
  const openCollapsed = React.useCallback(
    (account: string, name: string) => {
      const key = collapsedFolderKey(account, name);
      if (!collapsed.has(key)) return;
      const next = new Set(collapsed);
      next.delete(key);
      setCollapsed(next);
    },
    [collapsed, setCollapsed]
  );
  /** A favourite pointing at a folder the provider no longer has is dropped. */
  React.useEffect(() => {
    if (loading || !accountFolders.length) return;
    pruneFolderFavourites(accountFolders);
  }, [accountFolders, loading]);
  const trees = React.useMemo(() => {
    const byAccount = new Map<string, MailAccountFolder[]>();
    for (const row of accountFolders) {
      const list = byAccount.get(row.account);
      if (list) list.push(row);
      else byAccount.set(row.account, [row]);
    }
    // Every connected mailbox gets a section, even an empty one: a heading
    // with nothing under it says "no folders here yet", and no heading at
    // all says "this mailbox does not exist".
    const order = accounts.length
      ? accounts
      : accountsWithFolders(accountFolders);
    return order.map((account) => ({
      account,
      nodes: buildFolderTree(byAccount.get(account) ?? []),
    }));
  }, [accountFolders, accounts]);
  const filtered = React.useMemo(
    () =>
      trees.map(({ account, nodes }) => ({
        account,
        nodes: filterFolderTree(nodes, query),
      })),
    [trees, query]
  );
  /** The mailboxes as the rail lists them, which is the order being changed. */
  const railAccounts = React.useMemo(
    () => filtered.map((section) => section.account),
    [filtered]
  );
  /**
   * Where a drop would put the dragged mailbox, if it can go there at all.
   *
   * One question for the whole rail rather than one per section, because the
   * places a mailbox can go are the spaces between the sections, and a space
   * is not inside either of the two it separates. Asked section by section,
   * the rail had spaces it could not name at all: the one above the first
   * mailbox needed the pointer in the top half of a section that is as tall
   * as the mailbox is deep, so with the folders open — or the rail scrolled
   * a little — the top of the list was somewhere the reader could not point.
   *
   * See `accountDropPlace`, which does the reading. Any place is a place:
   * the order is the reader's own arrangement, so a mailbox may sit anywhere
   * among the others, whichever provider each of them came from.
   */
  const dropPlaceAt = React.useCallback(
    (y: number): string | null | undefined => {
      if (!accountDrag) return undefined;
      const spans: AccountSpan[] = [];
      for (const account of railAccounts) {
        const box = sectionRefs.current.get(account)?.getBoundingClientRect();
        if (!box) continue;
        spans.push({ account, top: box.top, bottom: box.bottom });
      }
      return accountDropPlace(railAccounts, spans, accountDrag, y);
    },
    [accountDrag, railAccounts]
  );
  const favouriteKeys = React.useMemo(
    () =>
      new Set(favourites.map((f) => folderFavouriteKey(f.account, f.name))),
    [favourites]
  );
  /**
   * Favourites, as rows to draw.
   *
   * Read out of the trees rather than out of the stored list, so a count
   * and a name here are the same ones the section below shows.
   */
  const favouriteRows = React.useMemo(() => {
    if (!favourites.length) return [];
    const byKey = new Map<string, FolderTreeNode>();
    for (const { nodes } of trees) {
      for (const node of flattenFolderTree(nodes)) {
        byKey.set(folderFavouriteKey(node.account, node.name), node);
      }
    }
    const needle = query.trim().toLowerCase();
    return favourites
      .map((f) => byKey.get(folderFavouriteKey(f.account, f.name)))
      .filter((node): node is FolderTreeNode => Boolean(node))
      .filter((node) => !needle || node.label.toLowerCase().includes(needle));
  }, [favourites, trees, query]);
  /**
   * What a row does while a conversation is in the air.
   *
   * A conversation belongs to one mailbox and can only be filed inside it,
   * so every folder on another account refuses the drop. It stays on screen
   * and stays readable: hiding it would move the rows below it, and the
   * reader is already aiming at one of them.
   */
  const dropStateFor = React.useCallback(
    (account: string): DropState => {
      if (!draggingAccount) return "rest";
      return account.toLowerCase() === draggingAccount.toLowerCase()
        ? "live"
        : "dim";
    },
    [draggingAccount]
  );
  const dragging = draggingAccount !== null;
  // A drag can end anywhere — off the rail, off the window, on a row that
  // refused it — and none of those send a last leave.
  React.useEffect(() => {
    if (!dragging) setDragOver(null);
  }, [dragging]);
  /**
   * Rename, keeping the folder where it is.
   *
   * The box holds the last part of the name, so the parents are put back
   * around whatever is typed: renaming Figenbladet under Academia asks for
   * `Academia/<new>`, and the folder stays inside Academia. Typing a path
   * would otherwise move it, which is not what Rename says it does.
   */
  const submitRename = React.useCallback(
    async (node: FolderTreeNode, nextLabel: string) => {
      setRenamingKey(null);
      const label = nextLabel.trim().replace(/\//g, " ");
      if (!label || label === node.label) return;
      const parent = node.name.slice(
        0,
        node.name.length - node.label.length
      );
      await whileBusy(node.account, node.name, async () => {
        try {
          await onRenameFolder(node.account, node.name, `${parent}${label}`);
        } catch (err) {
          toast.error(
            err instanceof Error ? err.message : t("couldNotRenameFolder")
          );
        }
      });
    },
    [onRenameFolder, whileBusy, t]
  );
  const runDelete = React.useCallback(async () => {
    const target = confirmDelete?.node;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await onDeleteFolder(target.account, target.name);
      setConfirmDelete(null);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("couldNotDeleteFolder")
      );
    } finally {
      setDeleting(false);
    }
  }, [confirmDelete, deleting, onDeleteFolder, t]);
  /**
   * Make a folder inside the one that was right-clicked.
   *
   * The parent's whole name goes in front of whatever is typed, so the
   * provider is asked for `Clients/2026` and not for a second top-level
   * folder called 2026. A typed `/` is flattened for the same reason the
   * rename flattens one: this makes a folder here, and nowhere else.
   */
  const submitSubfolder = async () => {
    const target = creatingUnder;
    const label = newName.trim().replace(/\//g, " ");
    if (!target || !label || saving) return;
    const name = `${target.parent}/${label}`;
    setSaving(true);
    // The parent carries the wait, the way it carries a move or a rename.
    await whileBusy(target.account, target.parent, async () => {
      try {
        await onCreateFolder(target.account, name);
        setCreatingUnder(null);
        setNewName("");
        // A folder lands in the order the provider keeps, which on a long
        // rail is nowhere near where it was asked for.
        revealFolder(target.account, name);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("couldNotMakeFolder")
        );
      }
    });
    setSaving(false);
  };
  const submitNewFolder = async (account: string) => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    setCreatingIn(account);
    try {
      await onCreateFolder(account, name);
      setCreatingFor(null);
      setNewName("");
      revealFolder(account, name);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("couldNotMakeFolder")
      );
    } finally {
      setSaving(false);
      setCreatingIn(null);
    }
  };
  /**
   * The four rows above the mailboxes answer a right-click, but have nothing
   * to offer: the provider owns them, so they cannot be renamed, moved, or
   * deleted. Saying so beats a menu that never opens.
   */
  const openFixedMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    setMenu(null);
    setAccountMenu(null);
    setFixedMenu({ x: event.clientX, y: event.clientY });
  };

  return {
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
  };
}
