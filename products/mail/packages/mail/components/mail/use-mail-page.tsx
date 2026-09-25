"use client";

/*
 * Everything MailPage knows and does, apart from what it draws.
 *
 * MailPage calls this once, at its top, and draws from what it returns.
 * The statements here are MailPage's own, in the order they ran, so the
 * hooks run in the same order as before. The markup, which calls no hook,
 * stayed in MailPage.tsx and in the components it is split into.
 *
 * New logic for the page goes in a hook of its own (see the use-*.ts files
 * beside this one) and is called from here. `MailPageModel` is what the
 * markup can read.
 */

import * as React from "react";
import { flushPendingDiscards } from "@/lib/mail/pending-discard";
import { useApplyUiScale, useUiScale } from "@/lib/mail/use-ui-scale";
import { useMailColorMode } from "@/lib/mail/theme";
import { onMailComposeTo } from "@/lib/mail/compose-to";
import { setOwnMailIdentity } from "@/lib/own-addresses";
import { type PersonRow } from "@/lib/mail/person-participants";
import { useMailConnect } from "@/components/mail/use-mail-connect";
import { useMailSyncStates } from "@/lib/mail/use-sync-states";
import { firstReadLines, pausedAfterFirstRead } from "@/lib/mail/first-read";
import { useMailZoom } from "@/components/mail/use-mail-layout";
import { MAIL_RECONNECT_REQUEST, type MailReconnectRequest } from "@/lib/mail/toast";
import { isChatPopoutOpen } from "@/lib/native-shell";
import { useDraggingMailAccount, useMailFolders } from "@/components/mail/MailFolders";
import { type MailSystemView } from "@/components/mail/folder-rail-shared";
import { useFolderRailOpen, useFolderRailWidth } from "@/lib/mail/folder-rail";
import { threadMatchesCustomList } from "@/lib/mail/custom-lists";
import { accountChipLabels } from "@/lib/mail/account-labels";
import { getMailFilterRowOpen, setMailFilterRowOpen } from "@/lib/mail/layout";
import { useMailUndo } from "@/components/mail/use-mail-undo";
import { useAutoReply } from "@/components/mail/use-auto-reply";
import { useMailSelection } from "@/components/mail/use-mail-selection";
import { useSyncNow } from "@/components/mail/use-sync-now";
import { useHeldMessages } from "@/components/mail/use-held-messages";
import { useMailWindowKeys } from "@/components/mail/use-mail-window-keys";
import { useEditAsNew } from "@/components/mail/use-edit-as-new";
import { useWindowRequests } from "@/components/mail/use-window-requests";
import { useListRows } from "@/components/mail/use-list-rows";
import { useListLayout } from "@/components/mail/use-list-layout";
import { useRowOpening } from "@/components/mail/use-row-opening";
import { usePauseChip } from "@/components/mail/use-pause-chip";
import { usePersonSelection } from "@/components/mail/use-person-selection";
import { useListTabs } from "@/components/mail/use-list-tabs";
import { useComposeHome } from "@/components/mail/use-compose-home";
import { usePersonMenu } from "@/components/mail/use-person-menu";
import { usePersonRows } from "@/components/mail/use-person-rows";
import { useThreadRemoval } from "@/components/mail/use-thread-removal";
import { useThreadActions } from "@/components/mail/use-thread-actions";
import { useBatchActions } from "@/components/mail/use-batch-actions";
import { usePinToggle } from "@/components/mail/use-pin-toggle";
import { useDeleteForever } from "@/components/mail/use-delete-forever";
import { syncMailPinSummaries } from "@/lib/mail/pins";
import { pruneExpiredMailDrafts } from "@/lib/mail/local-drafts";
import { useMailProviderNames } from "@/lib/mail/use-outlook-accounts";
import { mailPageCacheKey } from "@/lib/page-snapshot-cache";
import { rowStandsFor, threadKey } from "@/lib/mail/thread-copies";
import { useMailT } from "@/lib/mail/i18n";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import type { MoveMenuHere } from "@/components/mail/MailFolders";
import { usePhoneLayout } from "@/lib/mail/use-phone-layout";
import { useMailDrafts } from "@/components/mail/use-mail-drafts";
import { preloadRichTextEditor } from "@/components/ui/RichTextEditor";
import type { MailThreadAction, MailThreadSummary } from "@/lib/mail/types";
import { believedPopoutKeys, setOpenPopoutKeys } from "@/lib/mail/popout";
import { setMailAvatars } from "@/lib/mail/team-avatars";
import { cn } from "@/lib/utils";
import { MAIL_ACCOUNT_ORDER_EVENT, moveAccountBefore, readAccountOrder, sortAccountsByOrder, writeAccountOrder } from "@/lib/mail/account-order";
import { scrubLegacySharedMailCaches, type MailListCacheEntry } from "@/lib/mail/list-cache";
import { searchHighlightTerms } from "@/lib/mail/search-highlight";
import { useThreadDraftKeys } from "@/components/mail/ThreadListRow";
import { useMailPins, MailListTab, MAIL_OFF_TAB_VIEWS, patchCachedThreads, useMailViewMode, useMailListDensity, isMailboxScopeAll, accountPassesMailboxScope, mailboxScopeKey, mailboxScopeApiAccount, type ActiveMailFolder } from "@/components/mail/mail-list-state";
import { useThreadListData } from "@/components/mail/use-thread-list-data";

export type MailPageProps = {
  accounts: string[];
  /** Clerk user id (planner) or local owner id (Mac app) — scopes paint caches. */
  viewerId: string;
  /** From InstantTabPaint snapshot — paints threads before the fetch returns. */
  initialList?: MailListCacheEntry & { key: string };
  /**
   * The reader's own mailboxes.
   *
   * **Not the connected list.** A connected mailbox is not necessarily the
   * reader's: a team shares `team@`, and replies to it must still reach the
   * colleagues who read it. Only a host knows which of its mailboxes are one
   * person's, so only a host says.
   */
  ownAddresses?: string[];
  /**
   * Domains whose every address is a colleague. Only for a host that has an
   * organization; left unset, nobody is a colleague, which is right for one
   * person with a personal mailbox.
   */
  ownDomains?: string[];
  /**
   * Faces the host knows: `own` for every one of the reader's own mailboxes,
   * `byAddress` for anyone else. Without it, everyone gets hashed initials.
   */
  avatars?: { own?: string; byAddress?: Record<string, string> };
  /**
   * Aliases and colleague domains as the host stores them, without the
   * connected mailboxes. Only for a host that keeps identity at runtime; one
   * that reads it from server environment leaves both of these out and the
   * settings fields stay hidden.
   */
  ownIdentity?: { addresses: string[]; domains: string[] };
  onOwnIdentityChange?: (next: {
    addresses: string[];
    domains: string[];
  }) => void;
};

export function useMailPage(props: MailPageProps) {
  const {
  accounts,
  viewerId,
  initialList,
  ownAddresses,
  ownDomains,
  avatars,
  ownIdentity,
  onOwnIdentityChange,
} = props;

  const t = useMailT();
  const shortcuts = useMailShortcuts();
  // Before anything renders: reply-stripping, the "You" label, and the
  // in-contacts split all ask whether an address is the reader's, and the
  // answer is nothing until it is set. useMemo, not useEffect — the first
  // render already asks.
  React.useMemo(() => {
    setOwnMailIdentity({
      addresses: ownAddresses ?? [],
      domains: ownDomains ?? [],
    });
    setMailAvatars({ own: avatars?.own, byAddress: avatars?.byAddress ?? {} });
  }, [ownAddresses, ownDomains, avatars]);
  const pageSnapKey = mailPageCacheKey(viewerId);
  React.useLayoutEffect(() => {
    scrubLegacySharedMailCaches();
  }, []);
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
  } = useListTabs();
  const pins = useMailPins();
  const pinKeySet = React.useMemo(
    () => new Set(pins.map((p) => `${p.account}|${p.threadId}`)),
    [pins]
  );
  // Fetch the Quill chunk right away, so the first Reply doesn't flash a
  // composer without its editor while the chunk downloads.
  React.useEffect(() => {
    preloadRichTextEditor();
  }, []);
  // Drop local drafts idle for ~90 days (also refreshes Draft badges).
  React.useEffect(() => {
    pruneExpiredMailDrafts();
  }, []);
  // Local copy so hide/show in the accounts menu updates chips + list immediately
  // (InstantTabPaint snapshots / router.refresh otherwise lag a full remount).
  const [accountEmails, setAccountEmails] = React.useState(() =>
    sortAccountsByOrder(accounts, readAccountOrder())
  );
  React.useEffect(() => {
    const follow = () =>
      setAccountEmails(sortAccountsByOrder(accounts, readAccountOrder()));
    follow();
    // The settings panel arranges them too, and it is a different tree.
    window.addEventListener(MAIL_ACCOUNT_ORDER_EVENT, follow);
    return () => window.removeEventListener(MAIL_ACCOUNT_ORDER_EVENT, follow);
  }, [accounts]);
  const [viewMode, setViewMode] = useMailViewMode();
  const [listDensity, setListDensity] = useMailListDensity();
  const colorMode = useMailColorMode();
  const chromeDark = colorMode === "dark";
  /**
   * The phone layout: one list, the reader over it. The pieces below are
   * built once and stand in whichever frame the window asks for — see the
   * phone branch before the desktop return, and MailPhoneShell.
   */
  const phone = usePhoneLayout();
  // The reader's own size for the whole app — see use-ui-scale.
  const [uiScale, setUiScale] = useUiScale();
  useApplyUiScale(uiScale);
  const { drafts, loading: draftsLoading, refresh: refreshDrafts } =
    useMailDrafts();
  const accountLabels = React.useMemo(
    () => accountChipLabels(accountEmails),
    [accountEmails]
  );
  // Which person digest is open in the reading pane (People view only).
  const [selectedPersonKey, setSelectedPersonKey] = React.useState<
    string | null
  >(null);
  /**
   * Mailboxes in the list and in search. Empty = all connected accounts.
   * Search always covers every folder on a selected mailbox.
   */
  const [mailboxScopeEmails, setMailboxScopeEmails] = React.useState<string[]>(
    []
  );
  // Drop scope picks that are no longer connected.
  React.useEffect(() => {
    const known = new Set(accountEmails.map((e) => e.toLowerCase()));
    setMailboxScopeEmails((prev) => {
      const next = prev.filter((e) => known.has(e.toLowerCase()));
      return next.length === prev.length ? prev : next;
    });
  }, [accountEmails]);
  const [search, setSearch] = React.useState("");
  const [searchFocused, setSearchFocused] = React.useState(false);
  /** The search words to mark in the rows, as typed, so the paint keeps up. */
  const highlightTerms = React.useMemo(() => searchHighlightTerms(search), [search]);
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  /**
   * Open user folder (Gmail label); null = inbox tabs.
   *
   * `account` names the mailbox it was opened from, which the rail always
   * knows and the old menu never did: that menu showed one merged row per
   * name, so opening Archive meant every Archive. A null account still
   * means that — every mailbox — and is what the menu keeps doing.
   */
  const [activeFolder, setActiveFolder] =
    React.useState<ActiveMailFolder | null>(null);
  /**
   * The drafts view, at the head of the rail or under one account.
   *
   * Gmail keeps drafts as a label that cannot be listed by name, so the row
   * under an account is this same view with one mailbox left in it. Outlook
   * has a real folder and reaches it the ordinary way.
   */
  const draftsView =
    tab === "drafts" || (activeFolder?.virtual && activeFolder.role === "drafts");
  const draftsAccount =
    activeFolder?.role === "drafts" ? activeFolder.account : null;
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
   * The folder list is fetched once, for every mailbox at once, and nothing
   * asked for it again when a mailbox was added — so the rail stood as it
   * had been until something else happened to refresh it. Somebody who has
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
  const [railOpen, setRailOpen] = useFolderRailOpen();
  const {
    width: railWidth,
    resizing: railResizing,
    startResize: startRailResize,
  } = useFolderRailWidth();
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
   * It used to be mounted by the click that opened it, and that is what
   * the pause before the slide was: React building a few hundred folder
   * rows, on the main thread, before any width could change. The frames
   * spent waiting for a first paint to animate from were on top of that.
   * None of it was the animation; all of it was work done at the worst
   * possible moment.
   *
   * Now the box is always there at width nought, so opening it is one
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
   * Items". Only the tab used to count. Opened from the rail, Deleted Items
   * was treated as an ordinary folder: it offered Archive and Delete, no
   * Restore and no "Delete forever", and Delete then asked Outlook to move
   * mail from Deleted Items into Deleted Items, which it refuses.
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
  const {
    pauseState,
    pauseNow,
    pauseMailUntil,
    resumeMail,
    setMailQuietHours,
    setFollowAllHours,
    pauseChip,
    noneFetching,
    pausedLabel,
    quietUntilByAccount,
    resumeFetching,
  } = usePauseChip({ accountEmails, accountLabels, t });
  const [selected, setSelected] = React.useState<{
    account: string;
    threadId: string;
    /** Whether participants already match CRM contacts (hides Add to CRM). */
    inCrm: boolean;
    /** Search hit message id — open the thread centered on it. */
    focusMessageId?: string;
  } | null>(null);
  // Keep the open thread's In CRM flag in sync after Add to CRM / refresh.
  const reconcileSelection = React.useCallback(
    (rows: MailThreadSummary[]) => {
      setSelected((current) => {
        if (!current) return current;
        // By what the row stands for, not its key: the open thread keeps
        // matching its row when a refresh leaves the row standing on the
        // conversation's other copy. The identity is left alone — a
        // repoint would remount the reader under someone mid-read.
        const next = rows.find((t) => rowStandsFor(t, current));
        if (!next) return current;
        const inCrm = next.tab === "people";
        return current.inCrm === inCrm ? current : { ...current, inCrm };
      });
    },
    []
  );
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
    loadThreads,
    scheduleSentRefreshForAccount,
    loadAbortRef,
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
  const {
    autoReplies,
    autoReplyByAccount,
    autoReplyOpen,
    autoReplyAccount,
    openAutoReply,
    closeAutoReply,
    storeAutoReply,
    endAutoReply,
  } = useAutoReply({ t });
  const {
    composing,
    setComposing,
    floatingReply,
    setFloatingReply,
    floatingCompose,
    setFloatingCompose,
    composeSeed,
    setComposeSeed,
    phoneDockedDraft,
    setPhoneDockedDraft,
  } = useComposeHome();
  /** Held in a ref: the handlers that open a thread are made before it is. */
  const openThreadRef = React.useRef<
    ((t: MailThreadSummary) => void) | null
  >(null);
  /**
   * Land on a person, wherever the reader came from.
   *
   * One thread is not a choice to make: the person pane is a list of what
   * is open with somebody, and a list of one is a card standing in front of
   * the only thing behind it. So a single thread opens where the pane would
   * have been, and the pane is kept for the people there is something to
   * choose between.
   *
   * This lived in the click handler alone, so the rule held when a person
   * was clicked and not when the app moved the selection itself — after
   * archiving or deleting the person who was open, the next one came up as
   * a card to click even when they had a single thread. Same landing, same
   * rule, whoever asked for it.
   */
  const landOnPerson = React.useCallback((row?: PersonRow | null) => {
    setSelectedPersonKey(row ? row.key : null);
    // The person stays marked in the list, and the thread renders: the
    // reading pane asks about an open thread before it asks about a person.
    if (row && row.threads.length === 1) openThreadRef.current?.(row.threads[0]);
    else setSelected(null);
  }, []);
  /**
   * Hide the mail list so compose/thread gets the full pane. Only allowed
   * while a detail pane is open — otherwise there'd be nothing left.
   */
  const [listCollapsed, setListCollapsed] = React.useState(false);
  /** List fills the shell; reading pane is hidden until restored. */
  const [listExpanded, setListExpanded] = React.useState(false);
  const [zoom, adjustZoom] = useMailZoom();
  /**
   * When to offer the Mac address book.
   *
   * Once a mailbox exists, because completing an address means nothing before
   * there is mail to write. Then once more when a composer opens, which is the
   * moment it would have helped. `mac-contacts-ask` counts the offers and
   * stops at two.
   */
  const [macAskTrigger, setMacAskTrigger] = React.useState(0);
  const offerMacContacts = React.useCallback(() => {
    setMacAskTrigger((n) => n + 1);
  }, []);
  React.useEffect(() => {
    if (accounts.length) offerMacContacts();
  }, [accounts.length, offerMacContacts]);
  const {
    listVertical,
    listSplit,
    listChromeOnToolbar,
    listRowsOnPane,
    detailOpen,
    listWidth,
    startListResize,
    expandListFromNarrow,
    listHeight,
    startListHeightResize,
    controlsWidth,
    startControlsResize,
    toggleListExpanded,
    paneRowRef,
    threadListRef,
    hideList,
    railShowing,
    railHidden,
    shownListWidth,
    shownRailWidth,
    listOpen,
    listSliding,
    listMounted,
    listExpandSliding,
    listSlideOverlay,
    expandClip,
    railInset,
    listSlideTransform,
    railSlideTransform,
    listNarrow,
    listRowWide,
    listNearSnap,
    listFirst,
    railOnRight,
    listControlsLeft,
    titlebarLeft,
    listBorderClass,
    railSlideDuration,
  } = useListLayout({
    listExpanded,
    setListExpanded,
    listCollapsed,
    setListCollapsed,
    composing,
    selected,
    railOpen,
    railWidth,
    railResizing,
  });
  const closeCompose = React.useCallback(() => {
    setComposing(false);
    setComposeSeed(null);
    setListCollapsed(false);
  }, [setComposing, setComposeSeed]);
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  const [filterRowOpen, setFilterRowOpenState] = React.useState(false);
  React.useEffect(() => setFilterRowOpenState(getMailFilterRowOpen()), []);
  const setFilterRowOpen = React.useCallback((open: boolean) => {
    setFilterRowOpenState(open);
    setMailFilterRowOpen(open);
  }, []);
  // If the last snooze clears while you're on Snoozed, leave the tab.
  React.useEffect(() => {
    if (snoozedCount == null) return;
    if (tab === "snoozed" && snoozedCount <= 0) {
      setTab("all");
    }
  }, [tab, snoozedCount, setTab]);
  const listScrollRef = React.useRef<HTMLDivElement | null>(null);
  // Mailbox menu only filters what we paint — the fetch always loads every
  // connected mailbox so toggling stays instant.
  const threadsForAccount = threads.filter((t) =>
    accountPassesMailboxScope(t.account, mailboxScopeEmails, accountEmails)
  );
  // "all" = the whole inbox (both CRM piles); "sent" / "snoozed" are folders.
  // Folder view shows every thread in that label (no CRM split).
  // The tabs narrow a search too. They used not to, on the reasoning that a
  // query should reach both piles — but the tabs stayed lit and clickable
  // while doing nothing, so a reader narrowing their results watched the same
  // list come back and could only read it as broken. "All" already reaches
  // everything, which is the tab a search starts on.
  // Custom lists: any external participant in the list's people.
  // Inbox tabs: newest-first. Snoozed: soonest wake first.
  const visible = (
    // Every view that is a place rather than a slice of the inbox. `t.tab` is
    // only ever "people" or "other", so filtering by it here empties any of
    // these — which is exactly how Junk and Trash came back empty even with
    // the provider returning rows.
    //
    // A folder is a place too, and it used to be in this list. But the two
    // are different questions: the folder says which mail, the filter says
    // whose, and a reader in Clients who wants only the people in their
    // address book was being told to leave the folder to ask.
    MAIL_OFF_TAB_VIEWS.includes(tab) || tab === "all"
      ? threadsForAccount
      : activeCustomList
        ? threadsForAccount.filter((t) =>
            threadMatchesCustomList(t, activeCustomList)
          )
        : threadsForAccount.filter((t) => t.tab === tab)
  )
    .slice()
    .sort((a, b) =>
      tab === "snoozed"
        ? Date.parse(a.snoozedUntil ?? a.lastAt) -
          Date.parse(b.snoozedUntil ?? b.lastAt)
        : Date.parse(b.lastAt) - Date.parse(a.lastAt)
    );
  // On-screen thread order for successor selection after delete/archive/move.
  // Updated below once pinned band + flow list are known; read from the ref
  // inside removeThread so those values don't need to be declared earlier.
  const screenThreadOrderRef = React.useRef<MailThreadSummary[]>([]);
  // The same, for the by-person list. Set once the rows are grouped, below.
  const personRowOrderRef = React.useRef<PersonRow[]>([]);
  // The open folder's chip takes the counted number and leaves it alone.
  //
  // It used to raise that number to however many threads were loaded,
  // because Gmail's label totals lag after a message is filed. Counting by
  // search removed the lag, and the raise was reading the wrong thing
  // anyway: `threads` still holds the previous view's rows for a moment
  // after a folder opens, so a folder holding one thread was labelled with
  // the inbox's row count, and stuck there for ninety seconds.

  const {
    removeThread,
    openFolderName,
    noteLeftOpenFolder,
    hideRemovedRows,
    unhideRows,
  } = useThreadRemoval({
    viewerId,
    listCacheKey,
    viewMode,
    selectedPersonKey,
    activeFolder,
    setThreads,
    setSelected,
    threadsRef,
    screenThreadOrderRef,
    hiddenRowsRef,
    listViewIdRef,
    loadAbortRef,
  });
  const {
    pushMailUndo,
    pushBatchUndo,
    dropMailUndo,
    undoLastMailAction,
    hasMailUndo,
  } = useMailUndo({
    viewerId,
    listCacheKey,
    hiddenRowsRef,
    setThreads,
    setSnoozedCount,
  });
  const {
    markUnread,
    moveToFolder,
    isOutlookAccount,
    archive,
    moveToInbox,
    toggleRead,
    trash,
    restoreFromTrash,
    setThreadJunk,
    snooze,
    unsnooze,
  } = useThreadActions({
    viewerId,
    listCacheKey,
    threads,
    setThreads,
    folder,
    tab,
    activeFolder,
    selected,
    setSelected,
    removeThread,
    openFolderName,
    noteLeftOpenFolder,
    hideRemovedRows,
    unhideRows,
    pushMailUndo,
    dropMailUndo,
    hiddenRowsRef,
    listViewIdRef,
    loadAbortRef,
    setSnoozedCount,
  });
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
  const {
    archivePerson,
    trashPerson,
    actOnSelection,
    dragCarriesSelection,
    moveManyToFolder,
  } = useBatchActions({
    threads,
    setThreads,
    viewMode,
    selectedPersonKey,
    setSelected,
    setSelectedPersonKey,
    landOnPerson,
    removeThread,
    noteLeftOpenFolder,
    hideRemovedRows,
    unhideRows,
    pushBatchUndo,
    selectedThreadsNow,
    successorAfterSelection,
    clearMultiSelection,
    personRowOrderRef,
  });
  const {
    personMenuAt,
    setPersonMenuAt,
    personSnooze,
    setPersonSnooze,
    personSnoozeSignal,
    askPersonSnooze,
    onPersonSnoozeOpenChange,
    togglePersonPin,
  } = usePersonMenu();
  const { togglePin, capturePinFlip } = usePinToggle({
    pins,
    listScrollRef,
    t,
  });
  const { purgeFrom, purgeAsk, askDeleteForever, runPurge, cancelPurge } =
    useDeleteForever({
      inTrashView,
      inJunkView,
      threads,
      setThreads,
      threadsRef,
      setSelected,
      setSelectedPersonKey,
      removeThread,
      hideRemovedRows,
      unhideRows,
      clearMultiSelection,
      loadThreads,
    });
  const startCompose = React.useCallback(
    (seed?: {
      to: string[];
      subject: string;
      continuedFromLabel: string;
      draftKey?: string;
    }) => {
      setSelected(null);
      setSelectedPersonKey(null);
      setListCollapsed(false);
      setListExpanded(false);
      setComposeSeed(seed ?? null);
      setComposing(true);
      // The second and last offer of the Mac address book, at the point it
      // would have helped. It shows nothing if the first one settled it.
      offerMacContacts();
    },
    [offerMacContacts, setComposing, setComposeSeed]
  );
  // An address clicked in a message body — in the plain-text view, or inside
  // the frame that renders HTML. Both ask through the same event.
  React.useEffect(
    () =>
      onMailComposeTo((address) =>
        startCompose({ to: [address], subject: "", continuedFromLabel: "" })
      ),
    [startCompose]
  );
  /*
    Which chat windows are really still open.

    The shell's window list is the truth, and it cannot be asked once per
    row on every repaint — so the threads this window popped out are kept
    (see `notePopoutOpened`) and checked against the shell whenever this
    window comes back to the front. Closing a chat hands focus here, which
    makes that the moment the answer changes. A handful of keys, so a
    handful of calls; outside the desktop app every answer is no and the
    set empties itself on the first pass.
  */
  React.useEffect(() => {
    let live = true;
    const check = async () => {
      const keys = believedPopoutKeys();
      if (!keys.length) return;
      const open = new Set<string>();
      for (const key of keys) {
        const at = key.indexOf("|");
        if (at < 0) continue;
        const account = key.slice(0, at);
        const threadId = key.slice(at + 1);
        if (await isChatPopoutOpen({ account, threadId })) open.add(key);
      }
      if (live) setOpenPopoutKeys(open);
    };
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  useMailWindowKeys({
    undoLastMailAction,
    hasMailUndo,
    startCompose,
    selected,
    activeFolder,
    setActiveFolder,
    adjustZoom,
    shortcuts,
    toggleListExpanded,
    detailOpen,
    uiScale,
    setUiScale,
    zoom,
    viewMode,
    selectedPersonKey,
    landOnPerson,
    personRowOrderRef,
    screenThreadOrderRef,
    openThreadRef,
    searchInputRef,
  });
  const { syncTurn, syncNow } = useSyncNow({
    selected,
    loadThreads,
    threadsRef,
  });
  const { heldMessages, actOnHeld } = useHeldMessages();
  const { editAsNewFromSource, editAsNewMessage, editAsNewMessageRef } =
    useEditAsNew({ startCompose, t });
  /**
   * A discard still inside its undo window when the window closes.
   *
   * Sending it beats losing it: the reader has had their chance to take it
   * back, and dropping the request would leave a draft in Gmail that this app
   * said it had thrown away. Best effort — a request started this late is not
   * guaranteed to finish, and if it does not, the draft simply stays.
   */
  React.useEffect(() => {
    const onHide = () => flushPendingDiscards();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  const { pendingForward, forwardStarted } = useWindowRequests({
    setComposing,
    setSelectedPersonKey,
    setSelected,
    startCompose,
    editAsNewMessageRef,
  });
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
    activeCustomList,
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
  // One row per correspondent for the People view.
  const { connecting, connect } = useMailConnect();
  const syncStates = useMailSyncStates();
  // A removed mailbox can leave a row behind; only the list's mailboxes count.
  const firstReads = React.useMemo(() => firstReadLines(syncStates, accounts), [syncStates, accounts]);
  const syncPaused = React.useMemo(() => pausedAfterFirstRead(syncStates, accounts), [syncStates, accounts]);
  /** Messages in hand while a mailbox's first read runs; 0 when none is. */
  const readSoFar = React.useMemo(
    () =>
      // Only while it runs: a paused mailbox is searched at its provider, whole.
      firstReads
        .filter((line) => line.folder === "" && line.state === "reading")
        .reduce((n, line) => n + line.done, 0),
    [firstReads]
  );
  /* What the empty state says about a search: that it could not run,
     that it ran over the part read so far, or that it found nothing. */
  const searchEmptyText = debouncedSearch
    ? unreadable.length
      ? t("searchFailed")
      : readSoFar
        ? t("noResultsSoFar", { query: debouncedSearch, count: readSoFar.toLocaleString() })
        : `No results for “${debouncedSearch}”.`
    : null;
  // A toast's Reconnect button asks; this is the one place that can answer.
  React.useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<MailReconnectRequest>).detail;
      if (!detail?.email) return;
      // The provider is known here from the mailbox list; the toast that
      // asked only guessed it from its own words, and a Graph error that
      // never says "Outlook" landed an Outlook address on Google's screen.
      connect(isOutlookAccount(detail.email) ? "outlook" : "gmail", detail.email);
    };
    window.addEventListener(MAIL_RECONNECT_REQUEST, onRequest);
    return () => window.removeEventListener(MAIL_RECONNECT_REQUEST, onRequest);
  }, [connect, isOutlookAccount]);
  const { personRows, personGroups } = usePersonRows({
    viewMode,
    accountEmails,
    visible,
    pendingTokens,
    debouncedSearch,
  });
  personRowOrderRef.current = personRows;
  const draftKeys = useThreadDraftKeys();
  const { paintedPersonKey, selectedPerson } = usePersonSelection({
    viewMode,
    selected,
    personRows,
    selectedPersonKey,
    setSelectedPersonKey,
    landOnPerson,
  });
  /**
   * The open thread's row in the list, when the list holds one.
   *
   * It carries the state the reader's own actions need to read — whether the
   * thread is unread, when it is snoozed until. A thread reached from a search
   * hit or a deep link can be open without being in the list at all.
   */
  const selectedRow = selected
    ? (threads.find((t) => rowStandsFor(t, selected)) ?? null)
    : null;
  const {
    openThread,
    pendingRowAction,
    setPendingRowAction,
    openPersonWindow,
    expandThreadRow,
    clickThreadRow,
    clickPersonRow,
  } = useRowOpening({
    listCacheKey,
    threads,
    setThreads,
    threadsRef,
    viewerId,
    setComposing,
    setListExpanded,
    setSelected,
    openThreadRef,
    selected,
    selectedPersonKey,
    selectRowWithModifier,
    clearMultiSelection,
    landOnPerson,
    screenThreadOrderRef,
    personRowOrderRef,
  });

  /**
   * Everything the row's menu needs that the list itself cannot answer.
   *
   * One bundle rather than nine props written out twice, because the list
   * is drawn in two places — grouped by date and grouped by person — and
   * two copies of this is two chances for them to drift apart.
   */
  const rowMenuActions = React.useCallback(
    (t: MailThreadSummary) => ({
      onAction: (action: MailThreadAction) => {
        /*
          Edit as new opens no thread. It is a copy of a message taken out
          of its conversation to be sent again as another one, so it goes
          straight to the composer — everything else here is something done
          to the thread, in the thread.
        */
        if (action === "editAsNew") {
          void editAsNewMessage(t);
          return;
        }
        openThread(t);
        setPendingRowAction({
          account: t.account,
          threadId: t.threadId,
          action,
        });
      },
      folders,
      onMoveToFolder: (folderName: string, create: boolean) =>
        moveToFolder(t, folderName, create),
      // Junk is a move, so it lives in the move menu — and only one way
      // round at a time: out of junk from inside it, into junk from
      // anywhere else.
      onJunk:
        inJunkView ? undefined : () => void setThreadJunk(t, true),
      onNotJunk:
        inJunkView ? () => void setThreadJunk(t, false) : undefined,
      onRestore:
        inTrashView ? () => void restoreFromTrash(t) : undefined,
      onDeleteForever: askDeleteForever
        ? () => askDeleteForever([{ account: t.account, threadId: t.threadId }])
        : undefined,
      // The rail's four in the move menu, and where this row is now.
      onMoveToInbox: () => void moveToInbox(t),
      here: hereNow,
    }),
    // `hereNow` is not in the list. It is declared below this callback, and
    // it is a new object on each render. It comes from the tab and the open
    // folder. `openThread` changes with the list key, and `moveToFolder`
    // changes with the rows. A new tab or folder changes the two, so this
    // callback is made again when `hereNow` moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      editAsNewMessage,
      folders,
      moveToFolder,
      moveToInbox,
      openThread,
      restoreFromTrash,
      setThreadJunk,
      inTrashView,
      inJunkView,
      askDeleteForever,
    ]
  );
  const chromeIconBtn = cn(
    "rounded-md p-1.5",
    chromeDark
      ? "text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
      : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-800"
  );
  /*
   * The title bar starts where the traffic lights end, in every layout.
   *
   * It used to start somewhere different in each: pinned 380px in from the
   * left so the search field met the reading pane's edge on the default
   * layout, tight against the window on some others, clear of the lights on
   * the rest. Moving the list moved the controls, and the row you reach for
   * without looking was never twice in the same place.
   */
  const folderApiAccount = mailboxScopeApiAccount(
    mailboxScopeEmails,
    accountEmails
  );
  const onMailboxVisibilityChange = React.useCallback(
    (email: string, inMailTab: boolean) => {
      const key = email.toLowerCase();
      setAccountEmails((prev) => {
        if (!inMailTab) {
          return prev.filter((e) => e.toLowerCase() !== key);
        }
        if (prev.some((e) => e.toLowerCase() === key)) return prev;
        return [...prev, email];
      });
      if (!inMailTab) {
        setMailboxScopeEmails((prev) =>
          prev.filter((e) => e.toLowerCase() !== key)
        );
      }
    },
    []
  );
  /**
   * Put one mailbox in front of another, from the folder rail.
   *
   * The whole arrangement is written down, not the one move: it is the
   * reader's own order of their mailboxes, and it belongs to them rather than
   * to Gmail or to Outlook — see `@/lib/mail/account-order` for why neither
   * provider can hold it. `before` is null for the end of the list.
   */
  const onReorderAccount = React.useCallback(
    (moved: string, before: string | null) => {
      setAccountEmails((prev) => {
        const next = moveAccountBefore(prev, moved, before);
        writeAccountOrder(next);
        return next;
      });
    },
    []
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
              ? null
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
  const filtersShowing = filterRowOpen || filterIsOn;
  /**
   * The last filter that was on, so the funnel can put it back.
   *
   * The button turns filtering off and on, and off and on again should
   * leave the list where it was: a reader who works in one of their own
   * lists and looks at everything for a moment is not choosing All, they
   * are glancing away from Familie.
   *
   * Kept for the session only. A filter still on when the app is closed is
   * still on when it opens, because the chosen tab is stored anyway.
   */
  const lastFilterRef = React.useRef<MailListTab | null>(null);
  React.useEffect(() => {
    if (filterIsOn) lastFilterRef.current = tab;
  }, [filterIsOn, tab]);
  /**
   * Is the mailbox row on screen to hold it?
   *
   * One mailbox needs no row to choose between mailboxes, and a folder
   * view has no row either — it is one mailbox's folder by definition.
   */
  const accountTabsShowing = accountEmails.length > 1 && !activeFolder;
  /**
   * A thread joined the CRM. Not always the thread on screen: the Update CRM
   * dialog stays open while the reader opens other mail.
   */
  const markThreadInCrm = (changed: { account: string; threadId: string }) => {
    const key = threadKey(changed);
    // Optimistically move the thread into In CRM before the list reload.
    setThreads((current) => {
      const next = current.map((t) =>
        threadKey(t) === key ? { ...t, tab: "people" as const } : t
      );
      patchCachedThreads(viewerId, listCacheKey, next);
      return next;
    });
    setSelected((current) =>
      current && threadKey(current) === key ? { ...current, inCrm: true } : current
    );
    // The thread has joined the CRM; which list is being read is a separate
    // question, and the reader answered it. This used to jump to In CRM so a
    // thread leaving Other did not seem to vanish — but it moved anybody
    // working in All or Other onto a filter they had not asked for, and with
    // the thread filed away after applying there is nothing waiting for them
    // there.
    void loadThreads();
  };

  return {
    accountEmails,
    accountFolders,
    accountLabels,
    accountTabsShowing,
    actOnHeld,
    actOnSelection,
    activeCustomList,
    activeFolder,
    adjustZoom,
    archive,
    archivePerson,
    askDeleteForever,
    askPersonSnooze,
    autoReplies,
    autoReplyAccount,
    autoReplyByAccount,
    autoReplyOpen,
    cancelPurge,
    capturePinFlip,
    chromeDark,
    chromeIconBtn,
    clearMultiSelection,
    clickPersonRow,
    clickThreadRow,
    closeAutoReply,
    closeCompose,
    colorMode,
    composeSeed,
    composing,
    connect,
    connecting,
    controlsWidth,
    customListById,
    debouncedSearch,
    detailOpen,
    draftKeys,
    drafts,
    draftsAccount,
    draftsLoading,
    draftsView,
    dragCarriesSelection,
    draggingAccount,
    editAsNewFromSource,
    editingBuiltin,
    editingList,
    endAutoReply,
    expandClip,
    expandListFromNarrow,
    expandThreadRow,
    filterIsOn,
    filtersShowing,
    firstReads,
    floatingCompose,
    floatingReply,
    folderApiAccount,
    folders,
    foldersLoading,
    forwardStarted,
    groups,
    heldMessages,
    hereNow,
    hideList,
    highlightTerms,
    inJunkView,
    inTrashView,
    isOutlookAccount,
    lastFilterRef,
    lastListTabRef,
    listBorderClass,
    listCacheKey,
    listChromeOnToolbar,
    listCollapsed,
    listControlsLeft,
    listCursor,
    listDensity,
    listEditor,
    listError,
    listExpandSliding,
    listExpanded,
    listFirst,
    listHeight,
    listMounted,
    listNarrow,
    listNearSnap,
    listOpen,
    listRowWide,
    listRowsOnPane,
    listScrollRef,
    listSlideOverlay,
    listSlideTransform,
    listSliding,
    listSplit,
    listVertical,
    listWidth,
    loadMoreThreads,
    loadThreads,
    loadingList,
    loadingMore,
    macAskTrigger,
    mailProviderNames,
    mailSurfaceRef,
    mailboxScopeEmails,
    markThreadInCrm,
    markUnread,
    moveManyToFolder,
    moveToFolder,
    moveToInbox,
    multiKeys,
    multiSelectedCount,
    noneFetching,
    onMailboxVisibilityChange,
    onOwnIdentityChange,
    onPersonSnoozeOpenChange,
    onReorderAccount,
    openAutoReply,
    openPersonWindow,
    openThread,
    ownIdentity,
    paintedPersonKey,
    paneRowRef,
    pauseChip,
    pauseMailUntil,
    pauseNow,
    pauseState,
    pausedLabel,
    pendingForward,
    pendingRowAction,
    pendingTokens,
    personGroups,
    personMenuAt,
    personRows,
    personSnooze,
    personSnoozeSignal,
    phone,
    phoneDockedDraft,
    pinKeySet,
    pinnedThreads,
    pins,
    purgeAsk,
    purgeFrom,
    quietUntilByAccount,
    railHidden,
    railInset,
    railOnRight,
    railResizing,
    railShowing,
    railSlideDuration,
    railSlideTransform,
    railSystemView,
    railWidth,
    readSoFar,
    refreshDrafts,
    refreshFolders,
    refreshing,
    restoreFromTrash,
    resumeFetching,
    resumeMail,
    rowMenuActions,
    runPurge,
    scheduleSentRefreshForAccount,
    search,
    searchDeleted,
    searchEmptyText,
    searchFocused,
    searchInputRef,
    searchedVisible,
    searchingMailboxCount,
    selected,
    selectedPerson,
    selectedRow,
    selectedThreadsNow,
    setAccountEmails,
    setActiveFolder,
    setFilterRowOpen,
    setFloatingCompose,
    setFloatingReply,
    setFollowAllHours,
    setListCollapsed,
    setListDensity,
    setListEditor,
    setMailQuietHours,
    setMailboxScopeEmails,
    setPendingRowAction,
    setPersonMenuAt,
    setPersonSnooze,
    setPhoneDockedDraft,
    setRailOpen,
    setSearch,
    setSearchDeleted,
    setSearchFocused,
    setSelected,
    setSelectedPersonKey,
    setTab,
    setTabOrder,
    setThreadJunk,
    setThreads,
    setViewMode,
    shortcuts,
    showPinnedBand,
    shownListWidth,
    shownRailWidth,
    snooze,
    snoozedCount,
    startCompose,
    startControlsResize,
    startListHeightResize,
    startListResize,
    startRailResize,
    storeAutoReply,
    syncNow,
    syncPaused,
    syncTurn,
    t,
    tab,
    tabOrder,
    tabReorderSensors,
    tabReorderSuppressClick,
    tabSchedules,
    threadListRef,
    threads,
    titlebarLeft,
    toggleListExpanded,
    togglePersonPin,
    togglePin,
    toggleRead,
    trash,
    trashPerson,
    unreadable,
    unsnooze,
    viewMode,
    viewerId,
    zoom,
  };
}

export type MailPageModel = ReturnType<typeof useMailPage>;
