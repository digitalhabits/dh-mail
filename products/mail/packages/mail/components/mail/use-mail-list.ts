"use client";

/*
 * The list concern of the mail page: the tabs and filters, the search, the
 * folders, the rows and their order, the selection, the Outbox, and the
 * people view.
 *
 * Each `use…` here is one part of useMailPage, called where its hooks always
 * ran, so the effects keep their order. `usePageListSlice` makes the slice that
 * components read with `usePageList` (mail-page-slices.tsx). See
 * docs/mail-ui-structure.md.
 */

import { useTeamRowFilter } from "@/components/mail/team-layer";
import * as React from "react";
import { type PersonRow } from "@/lib/mail/person-participants";
import { useDraggingMailAccount, useMailFolders } from "@/components/mail/MailFolders";
import { type MailSystemView } from "@/components/mail/folder-rail-shared";
import { useMailSelection } from "@/components/mail/use-mail-selection";
import { useMemoObject } from "@/components/mail/use-memo-object";
import { useHeldMessages } from "@/components/mail/use-held-messages";
import { useListRows } from "@/components/mail/use-list-rows";
import { useListTabs } from "@/components/mail/use-list-tabs";
import { usePersonRows } from "@/components/mail/use-person-rows";
import { syncMailPinSummaries } from "@/lib/mail/pins";
import { useMailProviderNames } from "@/lib/mail/use-outlook-accounts";
import { newestFirst } from "@/lib/mail/thread-copies";
import type { MoveMenuHere } from "@/components/mail/MoveToFolderMenu";
import type { MailThreadSummary } from "@/lib/mail/types";
import { searchHighlightTerms } from "@/lib/mail/search-highlight";
import { useLeaveEmptyPlaces, useMailPins, MailListTab, MAIL_OFF_TAB_VIEWS, useMailViewMode, useMailUnreadOnly, isMailboxScopeAll, accountPassesMailboxScope, mailboxScopeKey, mailboxScopeApiAccount, type ActiveMailFolder } from "@/components/mail/mail-list-state";
import { useThreadListData } from "@/components/mail/use-thread-list-data";
import { nextUnreadKeep, unreadRows, type UnreadKeep } from "@/lib/mail/unread-filter";
import type { useAccountsState, usePausing } from "@/components/mail/use-mail-accounts";
import type { usePageSetup } from "@/components/mail/use-page-setup";
import type { useReaderState } from "@/components/mail/use-mail-reader";
import type { useFirstReadState } from "@/components/mail/use-mail-sync";
import type { MailPageProps } from "@/components/mail/use-mail-page";

export function useListTabsAndPins() {
  const {
    customListById,
    tab,
    setTab,
    tabOrder,
    setTabOrder,
    tabReorderSuppressClick,
    tabReorderSensors,
    tabSchedules,
    listEditor,
    setListEditor,
    editingBuiltin,
    editingList,
    activeCustomList,
    passesFilters,
  } = useListTabs();
  const pins = useMailPins();
  const pinKeySet = React.useMemo(
    () => new Set(pins.map((p) => `${p.account}|${p.threadId}`)),
    [pins]
  );
  const [viewMode] = useMailViewMode();
  const [unreadOnly, setUnreadOnly] = useMailUnreadOnly();
  return { activeCustomList, customListById, editingBuiltin, editingList, listEditor, passesFilters, pinKeySet, pins, setListEditor, setTab, setTabOrder, setUnreadOnly, tab, tabOrder, tabReorderSensors, tabReorderSuppressClick, tabSchedules, unreadOnly, viewMode };
}

export function useListQuery() {
  const [search, setSearch] = React.useState("");
  const [searchFocused, setSearchFocused] = React.useState(false);
  /** The search words to mark in the rows, as typed, so the paint keeps up. */
  const highlightTerms = React.useMemo(() => searchHighlightTerms(search), [search]);
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  /**
   * Open user folder (Gmail label); null = inbox tabs.
   *
   * `account` names the mailbox it was opened from. The rail always knows
   * it. The menu does not: it shows one merged row per name, so opening
   * Archive there means every Archive. A null account means that — every
   * mailbox — and is what the menu gives.
   */
  const [activeFolder, setActiveFolder] =
    React.useState<ActiveMailFolder | null>(null);
  return { activeFolder, debouncedSearch, highlightTerms, search, searchFocused, setActiveFolder, setDebouncedSearch, setSearch, setSearchFocused };
}

export function useListFolders({
  accounts,
}: Pick<MailPageProps, "accounts">) {
  // Folders are shared across mailboxes — don't refetch when the mailbox
  // scope changes. Defer slightly so the inbox thread list wins the first
  // network slot.
  const {
    folders,
    accountFolders,
    loading: foldersLoading,
    refresh: refreshFolders,
  } = useMailFolders("all", { deferMs: 400 });
  /**
   * A mailbox that has just been connected brings its folders with it.
   *
   * The folder list is fetched once, for every mailbox at once. If nothing
   * asks for it again when a mailbox is added, the rail stays as it is until
   * something else refreshes it. Somebody who has
   * just connected an account is the one person certain to be looking at
   * the rail, and a new account is the one time it is certainly wrong.
   *
   * On the set of addresses, not the list: arranging the mailboxes in
   * settings hands back the same ones in another order, and that is not a
   * reason to ask the providers for anything. A mailbox disconnected counts
   * as much as one added — its folders have to go.
   */
  const connectedAccountsKey = React.useMemo(
    () =>
      [...accounts]
        .map((email) => email.trim().toLowerCase())
        .sort()
        .join("|"),
    [accounts]
  );
  const knownAccountsRef = React.useRef(connectedAccountsKey);
  React.useEffect(() => {
    if (knownAccountsRef.current === connectedAccountsKey) return;
    knownAccountsRef.current = connectedAccountsKey;
    void refreshFolders();
    // `refreshFolders` is rebuilt on every render — the ref above is what
    // decides, and adding it here would ask on every render instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAccountsKey]);
  return { accountFolders, folders, foldersLoading, refreshFolders };
}

export function useListView({
  accountEmails,
  activeFolder,
  mailboxScopeEmails,
  tab,
}: Pick<ReturnType<typeof useListTabsAndPins>, "tab"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails" | "mailboxScopeEmails"> &
  Pick<ReturnType<typeof useListQuery>, "activeFolder">) {
  /**
   * Named in the waiting state, so a slow list says where it is waiting.
   *
   * The mailboxes this view actually asks, not every one connected. A
   * folder opened from the rail belongs to one account, and telling its
   * reader we are "loading from Gmail and Outlook" names a provider that
   * is not being asked and cannot be the reason for the wait.
   */
  const mailProviderNames = useMailProviderNames(
    React.useMemo(() => {
      if (activeFolder?.account) return [activeFolder.account];
      return isMailboxScopeAll(mailboxScopeEmails, accountEmails)
        ? accountEmails
        : mailboxScopeEmails;
    }, [activeFolder, mailboxScopeEmails, accountEmails])
  );
  /**
   * The rail is built once and then only ever widened or narrowed.
   *
   * If the click that opens it also mounts it, that is the pause before the
   * slide. React builds a few hundred folder rows, on the main thread,
   * before any width can change. The frames spent waiting for a first paint
   * to animate from come on top of that. None of it is the animation. All
   * of it is work done at the worst possible moment.
   *
   * So the box is always there at width nought, so opening it is one
   * style change on an element the browser already has, and the transition
   * starts on the very next frame.
   *
   * `hidden` is the one thing that still has to wait: a box of width
   * nought still holds focusable rows, so it is made properly invisible —
   * but only once the closing slide has finished, or it would vanish
   * rather than close.
   */
  /** The mailbox a conversation is being dragged from — null at rest. */
  const draggingAccount = useDraggingMailAccount();
  const mailSurfaceRef = React.useRef<HTMLDivElement | null>(null);
  const folder =
    tab === "sent"
      ? "sent"
      : tab === "trash"
        ? "trash"
        : tab === "junk"
          ? "junk"
          : tab === "archived"
            ? "archived"
            : tab === "snoozed"
              ? "snoozed"
              : "inbox";
  /**
   * Whether the list on screen is Trash, or Junk.
   *
   * Two ways lead there: the Trash and Junk tabs, which show every mailbox,
   * and one mailbox's own folder in the rail, such as Outlook's "Deleted
   * Items". If only the tab counts, Deleted Items opened from the rail is an
   * ordinary folder. It offers Archive and Delete, no Restore and no "Delete
   * forever". Delete then asks Outlook to move mail from Deleted Items into
   * Deleted Items, which it refuses.
   *
   * With a folder open the tab says nothing: it still holds whatever was
   * last pressed. So the open folder's role decides, and the tab only when
   * no folder is open.
   */
  const inTrashView = activeFolder ? activeFolder.role === "trash" : tab === "trash";
  const inJunkView = activeFolder ? activeFolder.role === "junk" : tab === "junk";
  const searchScopeKey = mailboxScopeKey(mailboxScopeEmails, accountEmails);
  /**
   * How many mailboxes the running search is asking.
   *
   * An empty scope means every connected mailbox — see the state above —
   * so counting the list itself said "Searching 0 mailboxes", which is the
   * one number it can never be while a search is running.
   */
  const searchingMailboxCount = mailboxScopeEmails.length || accountEmails.length;
  // True while a background refetch is running over already-visible threads.
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  return { draggingAccount, folder, inJunkView, inTrashView, mailProviderNames, mailSurfaceRef, searchInputRef, searchScopeKey, searchingMailboxCount };
}

export function useListData({
  accountEmails,
  accounts,
  activeFolder,
  debouncedSearch,
  folder,
  initialList,
  mailSurfaceRef,
  mailboxScopeEmails,
  noneFetching,
  pageSnapKey,
  pauseState,
  reconcileSelection,
  searchScopeKey,
  viewerId,
}: Pick<ReturnType<typeof usePageSetup>, "pageSnapKey"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails" | "mailboxScopeEmails"> &
  Pick<ReturnType<typeof useReaderState>, "reconcileSelection"> &
  Pick<ReturnType<typeof useListQuery>, "activeFolder" | "debouncedSearch"> &
  Pick<ReturnType<typeof useListView>, "folder" | "mailSurfaceRef" | "searchScopeKey"> &
  Pick<ReturnType<typeof usePausing>, "noneFetching" | "pauseState"> &
  Pick<MailPageProps, "accounts" | "initialList" | "viewerId">) {
  /*
    The rows themselves — the fetch, the caches, the quiet poll, the
    after-send Sent refresh — live in use-thread-list-data. This page
    hands in the view the reader chose and keeps the selecting, the
    acting and the drawing.
  */
  const {
    listCacheKey,
    threads,
    setThreads,
    threadsRef,
    hiddenRowsRef,
    listViewIdRef,
    listCursor,
    loadingList,
    loadingMore,
    loadMoreThreads,
    refreshing,
    listError,
    unreadable,
    resultsQuery,
    snoozedCount,
    setSnoozedCount,
    searchDeleted,
    setSearchDeleted,
    hiddenSearch,
    loadThreads,
    scheduleSentRefreshForAccount,
    loadAbortRef,
    sentHiddenEmails,
  } = useThreadListData({
    viewerId,
    pageSnapKey,
    initialList,
    accountCount: accounts.length,
    accountEmails,
    mailboxScopeEmails,
    folder,
    activeFolder,
    debouncedSearch,
    searchScopeKey,
    pauseState,
    noneFetching,
    mailSurfaceRef,
    reconcileSelection,
  });
  return { hiddenRowsRef, hiddenSearch, listCacheKey, listCursor, listError, listViewIdRef, loadAbortRef, loadMoreThreads, loadThreads, loadingList, loadingMore, refreshing, resultsQuery, scheduleSentRefreshForAccount, searchDeleted, sentHiddenEmails, setSearchDeleted, setSnoozedCount, setThreads, snoozedCount, threads, threadsRef, unreadable };
}

export function useVisibleRows({
  accountEmails,
  mailboxScopeEmails,
  passesFilters,
  search,
  sentHiddenEmails,
  setDebouncedSearch,
  tab,
  threads,
  unreadOnly,
}: Pick<ReturnType<typeof useListTabsAndPins>, "passesFilters" | "tab" | "unreadOnly"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails" | "mailboxScopeEmails"> &
  Pick<ReturnType<typeof useListQuery>, "search" | "setDebouncedSearch"> &
  Pick<ReturnType<typeof useListData>, "sentHiddenEmails" | "threads">) {
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
    // setDebouncedSearch is a useState setter, which does not change.
  }, [search, setDebouncedSearch]);
  const listScrollRef = React.useRef<HTMLDivElement | null>(null);
  // Mailbox menu only filters what we paint — the fetch always loads every
  // connected mailbox so toggling stays instant.
  // In Sent, All also holds the hidden mailboxes' sent mail.
  const threadsForAccount = threads.filter((t) =>
    accountPassesMailboxScope(t.account, mailboxScopeEmails, accountEmails, sentHiddenEmails)
  );
  // The organization's build: Unassigned, in the team mailbox. Null when off.
  const teamKeep = useTeamRowFilter(threadsForAccount);
  // "all" = the whole inbox (both piles); "sent" / "snoozed" are folders.
  // Folder view shows every thread in that label (no People split).
  // The tabs narrow a search too. They used not to, on the reasoning that a
  // query should reach both piles — but the tabs stayed lit and clickable
  // while doing nothing, so a reader narrowing their results watched the same
  // list come back and could only read it as broken. "All" already reaches
  // everything, which is the tab a search starts on.
  // Custom lists: any external participant in the list's people.
  // Inbox tabs: newest-first. Snoozed: soonest wake first.
  const inTab = (
    // Every view that is a place rather than a slice of the inbox. `t.tab` is
    // only ever "people" or "other", so filtering by it here empties any of
    // these — which is exactly how Junk and Trash came back empty even with
    // the provider returning rows.
    //
    // A folder is a place too, but it is not in this list. The two are
    // different questions: the folder says which mail, the filter says
    // whose. A reader in Clients who wants only the people in their address
    // book must not have to leave the folder to ask.
    // The filters on, any one of them (lib/mail/filter-set).
    threadsForAccount.filter((t) => passesFilters(t) && (!teamKeep || teamKeep(t)))
  )
    .slice()
    .sort((a, b) =>
      tab === "snoozed"
        ? Date.parse(a.snoozedUntil ?? a.lastAt) -
          Date.parse(b.snoozedUntil ?? b.lastAt)
        : newestFirst(a, b)
    );
  const { tabHasUnread, visible } = useUnreadSwitch(inTab, unreadOnly, `${tab}|${mailboxScopeKey(mailboxScopeEmails, accountEmails)}`);
  // On-screen thread order for successor selection after delete/archive/move.
  // Updated below once pinned band + flow list are known; read from the ref
  // inside removeThread so those values don't need to be declared earlier.
  const screenThreadOrderRef = React.useRef<MailThreadSummary[]>([]);
  // The same, for the by-person list. Set once the rows are grouped, below.
  const personRowOrderRef = React.useRef<PersonRow[]>([]);
  return { listScrollRef, personRowOrderRef, screenThreadOrderRef, tabHasUnread, threadsForAccount, visible };
}

/**
 * The tab's rows through the unread switch (lib/mail/unread-filter.ts).
 * The keep is state moved on during the render, so a row read a moment ago
 * is still there on the paint that marks it read.
 */
function useUnreadSwitch(rows: MailThreadSummary[], on: boolean, place: string) {
  const [keep, setKeep] = React.useState<UnreadKeep | null>(null);
  const next = on ? nextUnreadKeep(keep, place, rows) : null;
  if (next !== keep) setKeep(next);
  const visible = React.useMemo(() => (next ? unreadRows(rows, next) : rows), [rows, next]);
  return { tabHasUnread: rows.some((r) => r.unread), visible };
}

export function useSelectionPart({
  listCacheKey,
  personRowOrderRef,
  screenThreadOrderRef,
  viewMode,
}: Pick<ReturnType<typeof useListTabsAndPins>, "viewMode"> &
  Pick<ReturnType<typeof useListData>, "listCacheKey"> &
  Pick<ReturnType<typeof useVisibleRows>, "personRowOrderRef" | "screenThreadOrderRef">) {
  const {
    multiKeys,
    multiSelectedCount,
    clearMultiSelection,
    selectRowWithModifier,
    selectedThreadsNow,
    successorAfterSelection,
  } = useMailSelection({
    viewMode,
    listCacheKey,
    screenThreadOrderRef,
    personRowOrderRef,
  });
  return { clearMultiSelection, multiKeys, multiSelectedCount, selectRowWithModifier, selectedThreadsNow, successorAfterSelection };
}

export function useOutbox({
  setTab,
  snoozedCount,
  tab,
}: Pick<ReturnType<typeof useListTabsAndPins>, "setTab" | "tab"> &
  Pick<ReturnType<typeof useListData>, "snoozedCount">) {
  const { heldMessages, actOnHeld } = useHeldMessages();
  useLeaveEmptyPlaces(tab, setTab, snoozedCount, heldMessages.length);
  return { actOnHeld, heldMessages };
}

export function useListRowsPart({
  accountEmails,
  activeFolder,
  debouncedSearch,
  listCacheKey,
  loadingList,
  mailboxScopeEmails,
  passesFilters,
  pinKeySet,
  pins,
  refreshing,
  resultsQuery,
  screenThreadOrderRef,
  search,
  tab,
  threads,
  viewMode,
  visible,
}: Pick<ReturnType<typeof useListTabsAndPins>, "passesFilters" | "pinKeySet" | "pins" | "tab" | "viewMode"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails" | "mailboxScopeEmails"> &
  Pick<ReturnType<typeof useListQuery>, "activeFolder" | "debouncedSearch" | "search"> &
  Pick<ReturnType<typeof useListData>, "listCacheKey" | "loadingList" | "refreshing" | "resultsQuery" | "threads"> &
  Pick<ReturnType<typeof useVisibleRows>, "screenThreadOrderRef" | "visible">) {
  // Keep pin snapshots fresh when the inbox refetch returns newer rows.
  React.useEffect(() => {
    if (threads.length) syncMailPinSummaries(threads);
  }, [threads]);
  const {
    showPinnedBand,
    pinnedThreads,
    pendingTokens,
    searchedVisible,
    groups,
  } = useListRows({
    tab,
    passesFilters,
    viewMode,
    debouncedSearch,
    activeFolder,
    pins,
    threads,
    mailboxScopeEmails,
    accountEmails,
    search,
    resultsQuery,
    visible,
    pinKeySet,
    screenThreadOrderRef,
    loadingList,
    refreshing,
    listCacheKey,
  });
  return { groups, pendingTokens, pinnedThreads, searchedVisible, showPinnedBand };
}

export function useListPeople({
  accountEmails,
  selectedPersonKey,
  debouncedSearch,
  pendingTokens,
  personRowOrderRef,
  readSoFar,
  t,
  unreadable,
  viewMode,
  visible,
}: Pick<ReturnType<typeof usePageSetup>, "t"> &
  Pick<ReturnType<typeof useListTabsAndPins>, "viewMode"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails"> &
  Pick<ReturnType<typeof useListQuery>, "debouncedSearch"> &
  Pick<ReturnType<typeof useListData>, "unreadable"> &
  Pick<ReturnType<typeof useVisibleRows>, "personRowOrderRef" | "visible"> &
  Pick<ReturnType<typeof useListRowsPart>, "pendingTokens"> &
  Pick<ReturnType<typeof useFirstReadState>, "readSoFar"> & {
    /** The person open in the reader (useReaderState). */
    selectedPersonKey: string | null;
  }) {
  /* What the empty state says about a search: that it could not run,
     that it ran over the part read so far, or that it found nothing. */
  const searchEmptyText = debouncedSearch
    ? unreadable.length
      ? t("searchFailed")
      : readSoFar
        ? t("noResultsSoFar", { query: debouncedSearch, count: readSoFar.toLocaleString() })
        : `No results for “${debouncedSearch}”.`
    : null;
  const { personRows, personGroups } = usePersonRows({
    viewMode,
    accountEmails,
    visible,
    pendingTokens,
    debouncedSearch,
    openPersonKey: selectedPersonKey,
  });
  personRowOrderRef.current = personRows;
  return { personGroups, personRows, searchEmptyText };
}

export function useListPlace({
  accountEmails,
  activeFolder,
  mailboxScopeEmails,
  tab,
}: Pick<ReturnType<typeof useListTabsAndPins>, "tab"> &
  Pick<ReturnType<typeof useAccountsState>, "accountEmails" | "mailboxScopeEmails"> &
  Pick<ReturnType<typeof useListQuery>, "activeFolder">) {
  /*
   * The title bar starts where the traffic lights end, in every layout.
   *
   * If it starts at a different place in each layout, moving the list moves
   * the controls. Then the row that you reach for without looking is never
   * twice in the same place.
   */
  const folderApiAccount = mailboxScopeApiAccount(
    mailboxScopeEmails,
    accountEmails
  );
  /**
   * The four unified views, as the rail lights them.
   *
   * A folder being open beats a tab: opening Academia out of the rail
   * leaves `tab` on whatever it was, and Sent must not stay lit.
   */
  /**
   * The last filter the list was read under.
   *
   * Trash, Sent and the rest are tabs in the same row as All and the custom
   * lists, so going to one of them replaces the filter. The Inbox row has
   * to put back what it replaced, or leaving the inbox and coming back
   * would quietly change what the reader sees.
   */
  const lastListTabRef = React.useRef<MailListTab>("all");
  React.useEffect(() => {
    if (!MAIL_OFF_TAB_VIEWS.includes(tab)) lastListTabRef.current = tab;
  }, [tab]);
  /**
   * Where the conversation the reader has open is, for the move menu.
   *
   * The view it was opened from, which is the only answer the list can give
   * without asking the provider what labels a thread carries. A folder view
   * names the folder; the four places name themselves.
   */
  const hereNow: MoveMenuHere = {
    view: activeFolder
      ? null
      : tab === "junk"
        ? "junk"
        : tab === "trash"
          ? "trash"
          : tab === "archived"
            ? "archived"
            : MAIL_OFF_TAB_VIEWS.includes(tab)
              ? null
              : "inbox",
    folder: activeFolder?.name ?? null,
  };
  const railSystemView: MailSystemView = activeFolder
    ? null
    : tab === "sent"
      ? "sent"
      : tab === "drafts"
        ? "drafts"
        : tab === "trash"
          ? "trash"
          : tab === "junk"
            ? "junk"
            : tab === "archived"
              ? "archived"
              : tab === "snoozed"
              ? "snoozed"
              : tab === "outbox"
              ? "outbox"
              : // Anything else is the mail itself, under whichever filter
                // the reader has chosen. That is the inbox.
                "inbox";
  /**
   * The folders button, the funnel, and the filters it unrolls.
   *
   * Its own thing, because it belongs to both headers: the mailbox row
   * above the inbox, and the name of an open folder. What is being
   * filtered changes; that there is filtering does not.
   */
  /**
   * Is a filter narrowing the list, and is the row of them on screen?
   *
   * A filter is one of the slices — All, In contacts, Other, a list of the
   * reader's own — and All is the one that narrows nothing. Trash and Sent
   * are not filters at all: they are places, chosen elsewhere, and the
   * funnel has nothing to say about them.
   */
  const filterIsOn = !MAIL_OFF_TAB_VIEWS.includes(tab) && tab !== "all";
  /* The lists are tabs, as in To-Do, and tabs are always there. */
  const filtersShowing = true;
  return { filterIsOn, filtersShowing, folderApiAccount, hereNow, lastListTabRef, railSystemView };
}

export function usePageListSlice({
  accountFolders,
  activeCustomList,
  activeFolder,
  clearMultiSelection,
  customListById,
  debouncedSearch,
  draggingAccount,
  editingBuiltin,
  editingList,
  filterIsOn,
  filtersShowing,
  folderApiAccount,
  folders,
  foldersLoading,
  groups,
  heldMessages,
  hereNow,
  hiddenSearch,
  highlightTerms,
  inJunkView,
  inTrashView,
  lastListTabRef,
  listCacheKey,
  listCursor,
  listEditor,
  listError,
  listScrollRef,
  loadMoreThreads,
  loadingList,
  loadingMore,
  mailProviderNames,
  multiKeys,
  multiSelectedCount,
  passesFilters,
  pendingTokens,
  personGroups,
  personRows,
  pinKeySet,
  pinnedThreads,
  pins,
  railSystemView,
  refreshFolders,
  scheduleSentRefreshForAccount,
  search,
  searchDeleted,
  searchEmptyText,
  searchFocused,
  searchInputRef,
  searchedVisible,
  searchingMailboxCount,
  selectedThreadsNow,
  setActiveFolder,
  setListEditor,
  setSearch,
  setSearchDeleted,
  setSearchFocused,
  setTab,
  setTabOrder,
  setThreads,
  setUnreadOnly,
  showPinnedBand,
  snoozedCount,
  tab,
  tabHasUnread,
  tabOrder,
  tabReorderSensors,
  tabReorderSuppressClick,
  tabSchedules,
  threads,
  threadsForAccount,
  unreadable,
  unreadOnly,
  viewMode,
  viewerId,
}: Pick<ReturnType<typeof useListTabsAndPins>, "activeCustomList" | "customListById" | "editingBuiltin" | "editingList" | "listEditor" | "passesFilters" | "pinKeySet" | "pins" | "setListEditor" | "setTab" | "setTabOrder" | "setUnreadOnly" | "tab" | "tabOrder" | "tabReorderSensors" | "tabReorderSuppressClick" | "tabSchedules" | "unreadOnly" | "viewMode"> &
  Pick<ReturnType<typeof useListQuery>, "activeFolder" | "debouncedSearch" | "highlightTerms" | "search" | "searchFocused" | "setActiveFolder" | "setSearch" | "setSearchFocused"> &
  Pick<ReturnType<typeof useListFolders>, "accountFolders" | "folders" | "foldersLoading" | "refreshFolders"> &
  Pick<ReturnType<typeof useListView>, "draggingAccount" | "inJunkView" | "inTrashView" | "mailProviderNames" | "searchInputRef" | "searchingMailboxCount"> &
  Pick<ReturnType<typeof useListData>, "hiddenSearch" | "listCacheKey" | "listCursor" | "listError" | "loadMoreThreads" | "loadingList" | "loadingMore" | "scheduleSentRefreshForAccount" | "searchDeleted" | "setSearchDeleted" | "setThreads" | "snoozedCount" | "threads" | "unreadable"> &
  Pick<ReturnType<typeof useVisibleRows>, "listScrollRef" | "tabHasUnread" | "threadsForAccount"> &
  Pick<ReturnType<typeof useSelectionPart>, "clearMultiSelection" | "multiKeys" | "multiSelectedCount" | "selectedThreadsNow"> &
  Pick<ReturnType<typeof useOutbox>, "heldMessages"> &
  Pick<ReturnType<typeof useListRowsPart>, "groups" | "pendingTokens" | "pinnedThreads" | "searchedVisible" | "showPinnedBand"> &
  Pick<ReturnType<typeof useListPeople>, "personGroups" | "personRows" | "searchEmptyText"> &
  Pick<ReturnType<typeof useListPlace>, "filterIsOn" | "filtersShowing" | "folderApiAccount" | "hereNow" | "lastListTabRef" | "railSystemView"> &
  Pick<MailPageProps, "viewerId">) {
  const searchHits = debouncedSearch ? threadsForAccount : null;
  /*
    The other four concerns. Each is one memoised object, made after the
    last hook that it reads (docs/mail-ui-structure.md).
  */
  const list = useMemoObject({
    accountFolders, activeCustomList, activeFolder, customListById, debouncedSearch, editingBuiltin,
    editingList, filterIsOn, filtersShowing, folderApiAccount, folders, foldersLoading, groups,
    heldMessages, hereNow, hiddenSearch, highlightTerms, inJunkView, inTrashView, lastListTabRef,
    listCacheKey, listCursor, listEditor, listError, listScrollRef, loadMoreThreads, loadingList,
    loadingMore, mailProviderNames, draggingAccount, multiKeys,
    multiSelectedCount, clearMultiSelection, selectedThreadsNow, passesFilters, pendingTokens,
    personGroups, personRows, pinKeySet, pinnedThreads, pins, railSystemView, refreshFolders,
    scheduleSentRefreshForAccount, search, searchHits, searchDeleted, searchEmptyText,
    searchFocused, searchInputRef, searchedVisible, searchingMailboxCount, setActiveFolder,
    setListEditor, setSearch, setSearchDeleted, setSearchFocused, setTab, setTabOrder, setThreads,
    setUnreadOnly, showPinnedBand, snoozedCount, tab, tabHasUnread, tabOrder, tabReorderSensors,
    tabReorderSuppressClick, tabSchedules, threads, unreadable, unreadOnly, viewMode, viewerId,
  });
  return list;
}
