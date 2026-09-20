"use client";

import { isWindowsHost } from "@/lib/mail/host-os";
import * as React from "react";
// One tempo for every pane sweep — see pane-slide. The local names say
// which movement each drives here.
import {
  PANE_SLIDE_MS as LIST_SLIDE_MS,
  PANE_SLIDE_EASE as LIST_SLIDE_EASE,
} from "@/lib/mail/pane-slide";
import { useMailPaneGeometry } from "@/components/mail/use-mail-pane-geometry";
import { flushPendingDiscards } from "@/lib/mail/pending-discard";
import { successorAfterRemoving, successorInEitherOrder } from "@/lib/mail/successor";
import { nextUiScaleStop } from "@/lib/mail/ui-scale";
import { useApplyUiScale, useUiScale } from "@/lib/mail/use-ui-scale";
import { useMailColorMode } from "@/lib/mail/theme";
import { onMailComposeTo } from "@/lib/mail/compose-to";
import { setOwnMailIdentity } from "@/lib/own-addresses";
import { groupThreadsByPerson, type PersonRow } from "@/lib/mail/person-participants";
import { buildPersonIdentity, type PersonIdentity } from "@/lib/mail/person-identity";
import { mailStore } from "@/lib/mail/store";
import { useMailConnect } from "@/components/mail/use-mail-connect";
import { useMailSyncStates } from "@/lib/mail/use-sync-states";
import { isMailPersonPinned, orderByPersonPin, toggleMailPersonPin } from "@/lib/mail/person-pins";
import { ComposeView } from "@/components/mail/ComposeView";
import { ThreadPane } from "@/components/mail/ThreadPane";
import { CrmProposalHost } from "@/components/mail/CrmProposalHost";
import { firstReadLines, pausedAfterFirstRead } from "@/lib/mail/first-read";
import { syncPauseKind } from "@/lib/mail/sync-pause";
import { formatSnoozeWakeLabel, SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { isInteractiveDoubleClickTarget, MAX_CONTROLS_WIDTH, MAX_LIST_ARIA, MIN_CONTROLS_WIDTH, MIN_LIST_HEIGHT, NARROW_LIST_WIDTH, useMailControlsWidth, useMailListHeight, useMailListPlacement, useMailListWidth, nextZoomStop, useMailZoom } from "@/components/mail/use-mail-layout";
import { SelectionPane } from "@/components/mail/SelectionPane";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy } from "@dnd-kit/sortable";
import { ListNotice, ListNoticeButton } from "@/components/mail/ListNotice";
import { MailFirstReadLine } from "@/components/mail/MailFirstReadLine";
import { AlertTriangle, ArrowLeft, Clock, Folder, Funnel, Loader2, Maximize2, Minimize2, Moon, Pin, Plus, Radio, Search, SquarePen, X, Paperclip } from "lucide-react";
import { MAIL_RECONNECT_REQUEST, toast, type MailReconnectRequest } from "@/lib/mail/toast";
import { beginNativeWindowDragOnMove, isChatPopoutOpen } from "@/lib/native-shell";
import { AutoReplyDialog, autoReplyActive, type AutoReplyDto } from "@/components/mail/AutoReplyDialog";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { bumpMailFolderCount, clearMailThreadDrag, draggingMailThread, FolderViewHeader, FoldersTabMenu, isMailThreadDrag, useDraggingMailAccount, useMailFolders } from "@/components/mail/MailFolders";
import { MailFolderRail, type MailSystemView } from "@/components/mail/MailFolderRail";
import { FOLDER_RAIL_MAX_WIDTH, FOLDER_RAIL_MIN_WIDTH, useFolderRailOpen, useFolderRailWidth } from "@/lib/mail/folder-rail";
import { MailCustomListEditor } from "@/components/mail/MailCustomListEditor";
import { CONTACTS_CHANGED_EVENT, ContactSourcesDialogHost } from "@/components/mail/ContactSourcesDialog";
import { MacContactsAskCard } from "@/components/mail/MacContactsAskCard";
import { createCustomList, customListTabId, deleteCustomList, parseCustomListTabId, threadMatchesCustomList, updateCustomList, type MailCustomList } from "@/lib/mail/custom-lists";
import { accountChipLabels, formatAccountChipLabel } from "@/lib/mail/account-labels";
import type { MailFolder } from "@/lib/mail/folder-types";
import { getMailFilterRowOpen, setMailFilterRowOpen } from "@/lib/mail/layout";
import { syncMailPinSummaries, toggleMailPin, unpinMailThread } from "@/lib/mail/pins";
import { attachmentUrl } from "@/components/mail/MailAttachments";
import { deleteDraft, listHandedOverDraftKeys, newComposeDraftKey, pruneExpiredMailDrafts, saveComposeDraft, threadDraftKey, type DraftAttachmentSnapshot } from "@/lib/mail/local-drafts";
import { sanitizeEmailHtml, stripQuotedHtml } from "@/components/mail/EmailHtmlView";
import { plainTextToEditorHtml } from "@/lib/client-email-html";
import { restoreAnchorsForEditing } from "@/lib/mail/soften-anchors";
import { dropRemoteImagesForEditing } from "@/lib/mail/editor-html";
import { formatEmailBody, stripQuotedReplies } from "@/lib/email-mime";
import { decodeHtmlEntities } from "@/lib/html-entities";
import { scheduleMailThreadPrefetch } from "@/lib/mail/prefetch-threads";
import { invalidateCachedMailThread } from "@/lib/mail/thread-cache";
import { useIsOutlookAccount, useMailProviderNames } from "@/lib/mail/use-outlook-accounts";
import { Button } from "@/components/ui/button";
import { mailPageCacheKey } from "@/lib/page-snapshot-cache";
import {
  openMailPersonWindow,
  openMailThreadWindow,
} from "@/lib/mail/reader-window";
import { hideRow, unhideRow } from "@/lib/mail/hidden-rows";
import { everyCopy, everyCopyOfEach, rowStandsFor, threadKey } from "@/lib/mail/thread-copies";
import { MailPauseMenu } from "@/components/mail/MailPauseMenu";
import { useMailPause } from "@/components/mail/use-mail-pause";
import { fetchingAccounts, mailPauseChip, mailPauseVerdictForAccount } from "@/lib/mail/quiet-hours";
import { currentMailLocale, mailSay, useMailT, type MailStringKey } from "@/lib/mail/i18n";
import { openMailAccountsMenu } from "@/lib/mail/open-mail-accounts-menu";
import { formatShortcut, shortcutMatchesEvent } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import type { MoveMenuHere } from "@/components/mail/MailFolders";
import { AutoReplyMark } from "@/components/mail/AutoReplyMark";
import { MailAccountTabs, MailRowButton } from "@/components/mail/MailAccountTabs";
import { setTabSchedule, useTabSchedules } from "@/lib/mail/tab-schedules";
import { MailRestPanel } from "@/components/mail/MailRestPanel";
import { MailPhoneShell, type MailPhoneDetail } from "@/components/mail/MailPhoneShell";
import { usePhoneLayout } from "@/lib/mail/use-phone-layout";
import { MailDraftsList } from "@/components/mail/MailDraftsList";
import { isStandaloneDraft, useMailDrafts } from "@/components/mail/use-mail-drafts";
import { preloadRichTextEditor } from "@/components/ui/RichTextEditor";
import { onScheduledChanged } from "@/lib/mail/scheduled-events";
import type { MailMessage, MailScheduledMessage, MailThreadAction, MailThreadDetail, MailThreadSummary } from "@/lib/mail/types";
import { MAIL_EDIT_AS_NEW_REQUEST_KEY, MAIL_FORWARD_REQUEST_KEY, believedPopoutKeys, readComposeSeed, readEditAsNewRequest, readForwardRequest, setOpenPopoutKeys, type MailForwardRequest } from "@/lib/mail/popout";
import { setMailAvatars } from "@/lib/mail/team-avatars";
import { cn } from "@/lib/utils";
import { MAIL_ACCOUNT_ORDER_EVENT, moveAccountBefore, readAccountOrder, sortAccountsByOrder, writeAccountOrder } from "@/lib/mail/account-order";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { mailApiFetch } from "@/lib/mail/api";
import { dayBucket, rowTime } from "@/lib/mail/date-format";
import { forgetThreadEverywhere, scrubLegacySharedMailCaches, type MailListCacheEntry } from "@/lib/mail/list-cache";
import { PersonPane } from "@/components/mail/PersonPane";
import { PersonAvatar } from "@/components/mail/PersonAvatar";
import { PersonRowActions } from "@/components/mail/PersonRowActions";
import { Highlighted } from "@/components/mail/Highlighted";
import { searchHighlightTerms } from "@/lib/mail/search-highlight";
import { ConfirmPurgeDialog } from "@/components/mail/ConfirmPurgeDialog";
import { deleteForeverWithUndo, sayDeletedForever } from "@/components/mail/undo-purge";
import { ThreadListRow, ThreadRowMenu, PersonRowMenu, ThreadMessageCount, DraftBadge, useThreadDraftKeys } from "@/components/mail/ThreadListRow";
import { ListDensityToggle, MailViewModeTabs, MailLayoutMenu, SyncIcon } from "@/components/mail/MailListControls";
import { SearchOptionsMenu } from "@/components/mail/SearchOptionsMenu";
import { SortableMailListTab, viewTabClass } from "@/components/mail/SortableMailListTab";
import { MailListLoading } from "@/components/mail/MailListLoading";
import { gmailOauthHref, outlookOauthHref, useMailPins, useMailPersonPins, MailListTab, MAIL_LIST_TABS, MAIL_OFF_TAB_VIEWS, mailBuiltinTabLabels, mailSearchPlaceholder, useMailCustomLists, useMailListTabOrder, patchCachedThreads, useMailViewMode, useMailListDensity, useMailListTab, isMailboxScopeAll, accountPassesMailboxScope, searchTokens, matchesTokens, threadHaystack, emailLocalWords, mailboxScopeKey, mailboxScopeApiAccount,
  type ActiveMailFolder,
} from "@/components/mail/mail-list-state";
import { useThreadListData } from "@/components/mail/use-thread-list-data";
import { readThreadRowRects, playThreadRowFlip } from "@/components/mail/thread-row-flip";
export { openMailAccountsMenu };


export type MailPageSnapshot = {
  /** Clerk user id (planner) or local owner id (Mac app). */
  ownerId: string;
  accounts: string[];
  /** Last-painted thread list (any folder/filter). */
  threads: MailThreadSummary[];
  listCacheKey: string;
  listCursor: string | null;
};



export function MailPage({
  accounts,
  viewerId,
  initialList,
  ownAddresses,
  ownDomains,
  avatars,
  ownIdentity,
  onOwnIdentityChange,
}: {
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
}) {
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
  const customLists = useMailCustomLists();
  const customListById = React.useMemo(() => {
    const map = new Map<string, MailCustomList>();
    for (const list of customLists) map.set(list.id, list);
    return map;
  }, [customLists]);
  const [tab, setTab] = useMailListTab(customLists);
  const [tabOrder, setTabOrder] = useMailListTabOrder(customLists);
  const tabReorderSuppressClick = React.useRef(false);
  const tabReorderSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  /** null = closed; create = new list; string = editing that list id. */
  const tabSchedules = useTabSchedules();
  const [listEditor, setListEditor] = React.useState<
    null | "create" | string
  >(null);
  /**
   * The built-in filter whose schedule is open, if that is what is open.
   *
   * The editor takes one of three things: nothing (a new list), one of the
   * reader's lists, or one of the four built-in filters — and for a built-in
   * there is only ever the schedule to change.
   */
  const editingBuiltin =
    typeof listEditor === "string" && MAIL_LIST_TABS.includes(listEditor)
      ? listEditor
      : null;
  const editingList =
    typeof listEditor === "string"
      ? customListById.get(listEditor) ?? null
      : null;
  const activeCustomListId = parseCustomListTabId(tab);
  const activeCustomList = activeCustomListId
    ? customListById.get(activeCustomListId) ?? null
    : null;
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
  /**
   * Asleep or awake — see use-mail-sleep, and the switch beside the search
   * field. Read here because this is where the fetching is decided.
   */
  const {
    state: pauseState,
    verdict: pause,
    now: pauseNow,
    pauseUntil: pauseMailUntil,
    resume: resumeMail,
    setQuietHours: setMailQuietHours,
    setFollowAllHours,
  } = useMailPause();
  const pauseChip = mailPauseChip(pauseState, accountEmails, pauseNow);
  const pauseChipUntil = pauseChip.until
    ? formatSnoozeWakeLabel(pauseChip.until.toISOString())
    : pauseChip.untilClock;
  const fetchingNow = fetchingAccounts(pauseState, accountEmails, pauseNow);
  const noneFetching =
    accountEmails.length > 0 && fetchingNow.length === 0;
  /** "Quiet until 12:00", or "team quiet until Mon" for one mailbox. */
  const pausedLabel = pauseChip.paused
    ? pauseChipUntil
      ? pauseChip.account
        ? t("mailPausedAccountUntil", {
            account: formatAccountChipLabel(pauseChip.account, accountLabels),
            time: pauseChipUntil,
          })
        : t("mailPausedUntil", { time: pauseChipUntil })
      : t("mailNotFetching")
    : "";
  const quietUntilByAccount = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const email of accountEmails) {
      const local = mailPauseVerdictForAccount(pauseState, email, pauseNow);
      if (!local.paused) continue;
      const time = local.until
        ? formatSnoozeWakeLabel(local.until.toISOString())
        : local.untilClock;
      if (!time) continue;
      map.set(
        email.trim().toLowerCase(),
        t("quietUntilTooltip", { time })
      );
    }
    return map;
  }, [accountEmails, pauseNow, pauseState, t]);

  const resumeFetching = React.useCallback(() => {
    if (pause.paused && pause.reason === "pause") {
      resumeMail();
      return;
    }
    for (const email of accountEmails) {
      if (mailPauseVerdictForAccount(pauseState, email, pauseNow).paused) {
        resumeMail(email);
      }
    }
  }, [accountEmails, pause.paused, pause.reason, pauseNow, pauseState, resumeMail]);
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
  const [autoReplyOpen, setAutoReplyOpen] = React.useState(false);
  // Which account the auto-reply dialog opens on (from Set up…/Edit links).
  const [autoReplyAccount, setAutoReplyAccount] = React.useState<string | null>(null);
  const [autoReplies, setAutoReplies] = React.useState<AutoReplyDto[]>([]);

  /**
   * Mailboxes answering on their own, for the mark on their tab.
   *
   * The same question the line above the tabs answers in a sentence, put on
   * each mailbox it is true of: whose auto-reply is on, and until when.
   */
  const autoReplyByAccount = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const reply of autoReplies) {
      if (!autoReplyActive(reply)) continue;
      const until =
        reply.endTime !== null
          ? ` ${t("outOfOfficeUntil", {
              date: new Date(reply.endTime - 1).toLocaleDateString(
                currentMailLocale(),
                { day: "numeric", month: "short" }
              ),
            })}`
          : "";
      map.set(
        reply.account.trim().toLowerCase(),
        `${t("autoReplyOn")}${until}`
      );
    }
    return map;
  }, [autoReplies, t]);

  const storeAutoReply = React.useCallback((updated: AutoReplyDto) => {
    setAutoReplies((prev) => [
      ...prev.filter((a) => a.account !== updated.account),
      updated,
    ]);
  }, []);

  // "End" link in the accounts menu: turn the responder off, keep its content.
  const endAutoReply = React.useCallback(
    async (account: string) => {
      const current = autoReplies.find((a) => a.account === account);
      if (!current) return;
      try {
        const res = await mailApiFetch("/api/mail/autoreply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...current, enabled: false }),
        });
        const json = (await res.json()) as {
          autoReply?: AutoReplyDto;
          error?: string;
        };
        if (!res.ok || !json.autoReply) {
          throw new Error(json.error || "Couldn't end the auto-reply");
        }
        storeAutoReply(json.autoReply);
        toast.success(`Out-of-office reply ended for ${account}`);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't end the auto-reply"
        );
      }
    },
    [autoReplies, storeAutoReply]
  );

  // Auto-reply is optional chrome (banner + accounts menu). Defer so we don't
  // compete with the inbox's Gmail traffic and trip concurrent-request 429s.
  React.useEffect(() => {
    // Not gated on the AI flavor. Reading and setting an out-of-office is a
    // plain provider setting; only the button that writes the message for you
    // needs a key, and that one is gated where it lives. Gating this hid the
    // whole feature on the standalone for a day.
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await mailApiFetch("/api/mail/autoreply");
          const json = (await res.json()) as { autoReplies?: AutoReplyDto[] };
          if (!cancelled && res.ok && json.autoReplies) {
            setAutoReplies(json.autoReplies);
          }
        } catch {
          // Badge is best-effort; the dialog surfaces errors when opened.
        }
      })();
    }, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
  const [composing, setComposing] = React.useState(false);
  /**
   * A reply floated out of its thread, so it can be written while other
   * threads are read. Only the address: the words live in the thread's
   * local draft, which the card and the pane both read and write. The card
   * shows wherever this thread is not on screen — on the thread itself the
   * pane's own composer picks the draft up, so the reply follows the
   * reader rather than doubling.
   */
  const [floatingReply, setFloatingReply] = React.useState<{
    account: string;
    threadId: string;
  } | null>(null);
  /**
   * A new message floated out of the composer, by its draft key. The words
   * are in that draft, which the card and the composer both read — the same
   * arrangement a floated reply has, and the same card.
   */
  const [floatingCompose, setFloatingCompose] = React.useState<string | null>(
    null
  );

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

  /** Optional prefill for new compose (e.g. deep-link). */
  const [composeSeed, setComposeSeed] = React.useState<{
    to: string[];
    subject: string;
    continuedFromLabel: string;
    /** Continue this stored draft rather than starting a new one. */
    draftKey?: string;
  } | null>(null);
  /**
   * Hide the mail list so compose/thread gets the full pane. Only allowed
   * while a detail pane is open — otherwise there'd be nothing left.
   */
  const [listCollapsed, setListCollapsed] = React.useState(false);
  /**
   * A composer put away on a phone with its words kept — the sheet swiped
   * down, not discarded. The bar above the footer brings it back on the
   * same draft. Opening any composer clears it. See MailPhoneShell.
   */
  const [phoneDockedDraft, setPhoneDockedDraft] = React.useState<{
    seed: typeof composeSeed;
  } | null>(null);
  React.useEffect(() => {
    if (composing) setPhoneDockedDraft(null);
  }, [composing]);
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
  const listPlacement = useMailListPlacement();
  const listVertical =
    listPlacement === "top" || listPlacement === "bottom";
  /**
   * Side by side and expanded: one column, controls over the rows.
   *
   * Splitting here used to pin the controls at the list's old width and
   * send the rows right, which left a column of buttons and empty space.
   * Stacked (top / bottom) still splits, because the list is a strip and
   * the controls need a column of their own.
   */
  const listSplit = listVertical;
  /** Folder and filter name the mail, so they stand before New email. */
  const listChromeOnToolbar = listExpanded && !listVertical;
  /**
   * Expanded rows sit on the pane, not the chrome.
   *
   * The wide list is the thing being read, so it takes the same white
   * (or dark pane) the split list used. The toolbar stays on the chrome
   * above it.
   */
  const listRowsOnPane = listSplit || listExpanded;
  const detailOpen = composing || selected != null;
  const [listWidth, startListResize, expandListFromNarrow] =
    useMailListWidth({
      canCollapse: detailOpen && !listExpanded,
      onCollapse: () => setListCollapsed(true),
      invertDrag: listPlacement === "right",
    });
  const [listHeight, startListHeightResize] = useMailListHeight({
    canCollapse: detailOpen && !listExpanded,
    onCollapse: () => setListCollapsed(true),
    invertDrag: listPlacement === "bottom",
  });
  const [controlsWidth, startControlsResize] = useMailControlsWidth();

  /** Whether the list was hidden when Expand was pressed — the sweep then
      opens from the reader's edge rather than from a strip nobody saw. */
  const expandedFromHiddenRef = React.useRef(false);
  /*
    Where everything stands — the measured pane, the squeeze a composer
    asks of the list and the folders, the sweeps and their numbers, the
    title bar's left edge. All of it is derivation, and it lives together
    in use-mail-pane-geometry; what comes back is read, not steered.
  */
  const {
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
  } = useMailPaneGeometry({
    listPlacement,
    listVertical,
    listExpanded,
    listCollapsed,
    detailOpen,
    listWidth,
    listHeight,
    controlsWidth,
    railOpen,
    railWidth,
    railResizing,
    expandedFromHidden: expandedFromHiddenRef,
  });
  const toggleListExpanded = React.useCallback(() => {
    setListExpanded((v) => {
      if (!v) {
        // Where the sweep starts — see the slide states. Read before the
        // collapse below erases the answer.
        expandedFromHiddenRef.current = listCollapsed && detailOpen;
        setListCollapsed(false);
        // Don't carry a 56px rail into the expanded list.
        if (listWidth <= NARROW_LIST_WIDTH) expandListFromNarrow();
      }
      return !v;
    });
  }, [expandListFromNarrow, listWidth, listCollapsed, detailOpen]);

  const closeCompose = React.useCallback(() => {
    setComposing(false);
    setComposeSeed(null);
    setListCollapsed(false);
  }, []);

  // Empty reading pane can't fill the space — always bring the list back.
  React.useEffect(() => {
    if (!detailOpen) setListCollapsed(false);
  }, [detailOpen]);

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

  const removeThread = React.useCallback(
    /** `alsoKeys`: copies of the same mail in other mailboxes, gone with it. */
    (key: string, alsoKeys: string[] = []) => {
      /**
       * Where to go next, worked out before the row is gone.
       *
       * The painted order is the one to follow — pins band, then the visible
       * flow — because that is what the reader is looking at. But it is put
       * into a ref while the component renders, and this runs from an event,
       * so the two can disagree about what is on screen. When they do, the
       * plain thread order is a worse answer than the painted one and a much
       * better answer than none: dropping to the empty pane after a delete
       * reads as though something went wrong.
       */
      const painted = screenThreadOrderRef.current;
      /*
        Removed means the row that stands for any of the going copies —
        by its own key, or by a copy folded into it. Matching the one key
        alone missed the row whenever it was standing on its other copy,
        and the row then survived its own deletion: still on screen,
        inviting the second press that lands on a conversation the reader
        never chose.
      */
      const gone = new Set([key, ...alsoKeys]);
      const isRemoved = (t: MailThreadSummary) =>
        gone.has(threadKey(t)) ||
        (t.alsoIn?.some((c) => gone.has(threadKey(c))) ?? false);
      const successor = successorInEitherOrder(
        painted,
        threadsRef.current,
        isRemoved
      );
      if (
        !successor &&
        !painted.some(isRemoved) &&
        !threadsRef.current.some(isRemoved)
      ) {
        console.warn(
          `[mail] ${key} was not in the list it was removed from — nothing to open next`
        );
      }

      setThreads((current) => {
        const next = current.filter((t) => !isRemoved(t));
        patchCachedThreads(viewerId, listCacheKey, next);
        return next;
      });
      // The row is gone from this list. It is gone from the others too, and
      // those are cached in storage with no expiry — so a folder or a search
      // the reader comes back to later would paint it again.
      forgetThreadEverywhere(viewerId, isRemoved);
      setSelected((current) => {
        if (!current || !gone.has(threadKey(current))) return current;
        // With a person digest open, fall back to it — the successor thread
        // in list order could belong to someone else entirely.
        if (viewMode === "people" && selectedPersonKey) return null;
        return successor
          ? {
              account: successor.account,
              threadId: successor.threadId,
              inCrm: successor.tab === "people",
              focusMessageId: successor.focusMessageId,
            }
          : null;
      });
    },
    [
      listCacheKey,
      viewMode,
      selectedPersonKey,
      setThreads,
      threadsRef,
      viewerId,
    ]
  );

  const markUnread = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      try {
        // One copy is enough to make the row bold again; it is the one
        // the reader is looking at.
        await apiJson("/api/mail/unread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: t.account, threadId: t.threadId }),
        });
        setThreads((current) => {
          const next = current.map((item) =>
            rowStandsFor(item, t) ? { ...item, unread: true } : item
          );
          patchCachedThreads(viewerId, listCacheKey, next);
          return next;
        });
        toast(mailSay("markedAsUnread"));
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't mark as unread"
        );
      }
    },
    [listCacheKey, setThreads, viewerId]
  );

  /**
   * An action on many conversations at once: a person's mail, or a
   * selection. It knows how to take itself back, so the stack only has to
   * keep it and run it.
   */
  type MailBatchUndoEntry = {
    id: string;
    kind: "batch";
    toastId: string | number;
    run: () => Promise<void>;
  };

  type MailThreadUndoEntry = {
    id: string;
    kind: "trash" | "archive" | "move" | "snooze";
    summary: MailThreadSummary;
    toastId: string | number;
    folderName?: string;
    /** The open folder this left, if it left one. Undo puts the count back. */
    leftFolderName?: string | null;
    /**
     * The request this takes back, while it is still on its way. The entry
     * goes on the stack when the row leaves the list, not when the provider
     * answers: Gmail can take a second, and a Command+Z inside that second
     * found an empty stack and did nothing. Undo waits for this first, so
     * the restore never overtakes the delete.
     */
    after?: Promise<unknown>;
  };

  type MailUndoEntry = MailThreadUndoEntry | MailBatchUndoEntry;

  /** Stack of archive/trash/move/snooze actions — each Cmd+Z pops exactly one. */
  const mailUndoStackRef = React.useRef<MailUndoEntry[]>([]);

  const applyMailUndo = React.useCallback(
    async (undo: MailUndoEntry) => {
      toast.dismiss(undo.toastId);
      if (undo.kind === "batch") {
        await undo.run();
        return;
      }
      if (undo.after) {
        try {
          await undo.after;
        } catch {
          // It never went, and the caller put the row back. Nothing to undo.
          return;
        }
      }
      // The row is coming back; nothing may keep hiding it. Every kind set
      // a hide when it removed the row, so every kind clears one here.
      unhideRow(hiddenRowsRef.current, threadKey(undo.summary));
      if (undo.leftFolderName)
        bumpMailFolderCount(undo.summary.account, undo.leftFolderName, 1);
      setThreads((current) => {
        const key = threadKey(undo.summary);
        if (current.some((t) => threadKey(t) === key)) return current;
        const next = [...current, undo.summary].sort(
          (a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt)
        );
        patchCachedThreads(viewerId, listCacheKey, next);
        return next;
      });
      try {
        if (undo.kind === "move") {
          await apiJson("/api/mail/folders/unmove", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: undo.summary.account,
              threadId: undo.summary.threadId,
              folderName: undo.folderName,
            }),
          });
          if (undo.folderName)
            bumpMailFolderCount(undo.summary.account, undo.folderName, -1);
          toast.success(mailSay("movedBackToInbox"));
        } else if (undo.kind === "snooze") {
          await apiJson("/api/mail/unsnooze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: undo.summary.account,
              threadId: undo.summary.threadId,
            }),
          });
          setSnoozedCount((n) => {
            const current = n == null ? 1 : n;
            return Math.max(0, current - 1);
          });
          toast.success(mailSay("snoozeCancelled"));
        } else {
          // Every copy that went — the row's own and the ones folded into
          // it — comes back, or the row would return as one of them and the
          // rest would stay wherever they were sent.
          await Promise.all(
            everyCopy(undo.summary, [undo.summary]).map((c) =>
              apiJson(
                undo.kind === "trash"
                  ? "/api/mail/untrash"
                  : "/api/mail/unarchive",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(c),
                }
              )
            )
          );
          toast.success(
            mailSay(
              undo.kind === "trash" ? "restoredToInbox" : "movedBackToInbox"
            )
          );
        }
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : mailSay("couldNotRestore")
        );
      }
    },
    [listCacheKey, hiddenRowsRef, setSnoozedCount, setThreads, viewerId]
  );

  const undoLastMailAction = React.useCallback(async () => {
    const undo = mailUndoStackRef.current.pop();
    if (!undo) return;
    await applyMailUndo(undo);
  }, [applyMailUndo]);

  /** Toast Undo undoes that specific action even if newer ones followed. */
  const undoMailActionById = React.useCallback(
    async (id: string) => {
      const stack = mailUndoStackRef.current;
      const idx = stack.findIndex((entry) => entry.id === id);
      if (idx < 0) return;
      const [undo] = stack.splice(idx, 1);
      await applyMailUndo(undo);
    },
    [applyMailUndo]
  );

  const pushMailUndo = React.useCallback(
    (
      kind: "trash" | "archive" | "move" | "snooze",
      summary: MailThreadSummary,
      label: string,
      folderName?: string,
      leftFolderName?: string | null,
      after?: Promise<unknown>
    ): string => {
      const id = `${kind}-${threadKey(summary)}-${Date.now()}`;
      const toastId =
        kind === "move"
          ? toast.success(label, {
              action: {
                label: "Undo",
                onClick: () => void undoMailActionById(id),
              },
              duration: 8000,
            })
          : toast(label, {
              action: {
                label: "Undo",
                onClick: () => void undoMailActionById(id),
              },
              duration: 8000,
            });
      mailUndoStackRef.current.push({
        id,
        kind,
        summary,
        toastId,
        folderName,
        leftFolderName,
        after,
      });
      if (mailUndoStackRef.current.length > 50) {
        mailUndoStackRef.current.shift();
      }
      return id;
    },
    [undoMailActionById]
  );

  /** An action that failed has nothing to take back: off the stack, toast gone. */
  const dropMailUndo = React.useCallback((id: string | null) => {
    if (!id) return;
    const stack = mailUndoStackRef.current;
    const idx = stack.findIndex((entry) => entry.id === id);
    if (idx < 0) return;
    const [entry] = stack.splice(idx, 1);
    toast.dismiss(entry.toastId);
  }, []);

  /**
   * The toast and the Command+Z entry for an action on many conversations.
   *
   * These two were toasts with an Undo button and nothing on the stack, so
   * Command+Z after deleting a person's mail, or a selection, did nothing —
   * and the people view deletes no other way.
   */
  const pushBatchUndo = React.useCallback(
    (label: string, run: () => Promise<void>) => {
      const id = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const toastId = toast(label, {
        action: {
          label: mailSay("undo"),
          onClick: () => void undoMailActionById(id),
        },
        duration: 8000,
      });
      mailUndoStackRef.current.push({ id, kind: "batch", toastId, run });
      if (mailUndoStackRef.current.length > 50) {
        mailUndoStackRef.current.shift();
      }
    },
    [undoMailActionById]
  );

  /**
   * A conversation left the folder we have open, so that folder holds one
   * fewer. Only for the folder on screen: leaving the inbox is not leaving a
   * folder, and the counts we keep are for named folders only.
   */
  const openFolderName = activeFolder?.name ?? null;
  const noteLeftOpenFolder = React.useCallback(
    (account: string) => {
      if (openFolderName) bumpMailFolderCount(account, openFolderName, -1);
    },
    [openFolderName]
  );

  /**
   * Keep an optimistically removed row from being resurrected.
   *
   * Longer than any list response that was already in flight when the row
   * was removed, and long enough for the provider's own listing to catch
   * up. The abort drops the response most likely to carry it back.
   */
  const REMOVED_ROW_HIDE_MS = 60_000;
  const hideRemovedRows = React.useCallback((keys: string[]) => {
    const until = Date.now() + REMOVED_ROW_HIDE_MS;
    // In this view only: the row is shown in the view it went to. It was
    // hidden in every view, and a mail sent to Trash was not in Trash.
    for (const rowKey of keys) {
      hideRow(hiddenRowsRef.current, rowKey, listViewIdRef.current, until);
    }
    loadAbortRef.current?.abort();
  }, [hiddenRowsRef, listViewIdRef, loadAbortRef]);
  const unhideRows = React.useCallback((keys: string[]) => {
    for (const rowKey of keys) unhideRow(hiddenRowsRef.current, rowKey);
  }, [hiddenRowsRef]);

  const moveToFolder = React.useCallback(
    async (
      t: { account: string; threadId: string },
      folderName: string,
      create: boolean
    ) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      removeThread(key);
      hideRemovedRows([key]);
      try {
        const json = await apiJson<{
          folderName: string;
          movedOut?: boolean;
        }>(
          "/api/mail/folders/move",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: t.account,
              threadId: t.threadId,
              folderName,
              create,
            }),
          }
        );
        bumpMailFolderCount(t.account, json.folderName, 1);
        // Outlook keeps a message in one folder, so it has left this one.
        // Gmail keeps every label it had, so it has not.
        if (json.movedOut) noteLeftOpenFolder(t.account);
        if (summary) {
          pushMailUndo(
            "move",
            summary,
            mailSay("movedToFolder", { name: json.folderName }),
            json.folderName,
            json.movedOut ? openFolderName : null
          );
        } else {
          toast.success(mailSay("movedToFolder", { name: json.folderName }));
        }
      } catch (err) {
        unhideRows([key]);
        setThreads(before);
        throw err;
      }
    },
    [
      threads,
      removeThread,
      pushMailUndo,
      noteLeftOpenFolder,
      openFolderName,
      hideRemovedRows,
      unhideRows,
      setThreads,
    ]
  );

  /*
   * Toasts name the provider that did the deed, so they ask which one it
   * was. "Archived in Gmail" over an Outlook mailbox was the app talking
   * about itself instead of the account in front of it — the mail had in
   * fact gone to Outlook, and the sentence said otherwise.
   */
  const isOutlookAccount = useIsOutlookAccount();
  const archive = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      const provider = isOutlookAccount(t.account) ? "Outlook" : "Gmail";
      /*
        One press has raised three of these, word for word.

        Each call shows one toast and archives every copy behind the row in
        the one go, so three toasts are three calls — and the three named the
        same subject, which several of these threads share. Whether that is
        one control firing three times or three threads being archived at
        once cannot be told from the toast, so the call says where it came
        from. The first frames of the stack name it outright.
      */
      console.info(
        `[mail] archive ${key} "${summary?.subject ?? "(not in the list)"}"`,
        new Error("called from").stack?.split("\n").slice(1, 5).join("\n")
      );
      // Every copy behind the row — the same reason as in `trash`.
      const copies = everyCopy(t, threads);
      const keys = copies.map(threadKey);
      removeThread(key, keys);
      hideRemovedRows(keys);
      const sent = Promise.all(
        copies.map((c) =>
          apiJson("/api/mail/archive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          })
        )
      );
      // On the stack now, not when the provider answers — see `after`.
      const undoId = summary
        ? pushMailUndo(
            "archive",
            summary,
            `"${summary.subject}" archived in ${provider}`,
            undefined,
            undefined,
            sent
          )
        : null;
      try {
        await sent;
        if (!summary) toast(mailSay("archivedIn", { provider }));
      } catch (err) {
        dropMailUndo(undoId);
        unhideRows(keys);
        setThreads(before);
        toast.error(err instanceof Error ? err.message : "Couldn't archive");
      }
    },
    [
      threads,
      removeThread,
      pushMailUndo,
      dropMailUndo,
      hideRemovedRows,
      unhideRows,
      isOutlookAccount,
      setThreads,
    ]
  );

  /**
   * Back to the inbox.
   *
   * The fourth of the rail's places in the move menu, and the only one with
   * no button of its own: archiving, junking and deleting all have one, and
   * the way back from any of them is this. On Gmail it is the inbox label
   * put back; on Outlook a move to the inbox folder. The endpoint knows
   * which — it is the one undo has always used.
   */
  const moveToInbox = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      const copies = everyCopy(t, threads);
      const keys = copies.map(threadKey);
      // Where the reader is standing decides whether the row should go: in
      // the inbox it has arrived, anywhere else it has left.
      const leaves = folder !== "inbox" || Boolean(activeFolder);
      /*
        And where it comes back from decides how.

        Out of Junk it is "not junk", out of Trash it is "untrash", and from
        anywhere else it is the undo of an archive. It used to be the undo of
        an archive every time. On Gmail that only puts the inbox label back,
        and a thread still in Spam or Trash stays there — the copy even looks
        for it in All Mail, where a junked thread is not. The mail moved out
        of Junk never reached the inbox.
      */
      const endpoint =
        !activeFolder && folder === "junk"
          ? "/api/mail/not-junk"
          : !activeFolder && folder === "trash"
            ? "/api/mail/untrash"
            : "/api/mail/unarchive";
      if (leaves) {
        removeThread(key, keys);
        // Not hidden, only the list load in flight dropped. A row hidden
        // after it is removed stays hidden in every list for a minute — the
        // inbox included, which is exactly where this one is going.
        loadAbortRef.current?.abort();
      }
      try {
        await Promise.all(
          copies.map((c) =>
            apiJson(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(c),
            })
          )
        );
        toast(
          summary
            ? `"${summary.subject}" moved to ${mailSay("viewInbox")}`
            : mailSay("viewInbox")
        );
      } catch (err) {
        if (leaves) setThreads(before);
        toast.error(err instanceof Error ? err.message : "Couldn't move");
      }
    },
    [threads, folder, activeFolder, removeThread, loadAbortRef, setThreads]
  );

  /**
   * Archive every conversation with someone.
   *
   * Not the per-thread `archive` called in a loop: that pushes an undo toast
   * each time, so archiving a person you write to often would stack twenty of
   * them, and undoing would mean twenty clicks. One request per thread is
   * unavoidable — the providers have no batch — but one toast is not.
   */
  const archivePerson = React.useCallback(
    async (row: PersonRow) => {
      const targets = row.threads.map((t) => ({
        account: t.account,
        threadId: t.threadId,
      }));
      if (!targets.length) return;
      const before = threads;

      // Work out where to go before the rows are gone. The one below, or the
      // one above when this was the last — the same rule the thread list uses
      // in removeThread, so archiving behaves the same in either view.
      const wasOpen = selectedPersonKey === row.key;
      const successor = successorAfterRemoving(
        personRowOrderRef.current,
        (r) => r.key === row.key
      );

      const targetKeys = targets.map((t) => threadKey(t));
      for (const rowKey of targetKeys) removeThread(rowKey);
      hideRemovedRows(targetKeys);
      if (wasOpen) landOnPerson(successor);

      const results = await Promise.allSettled(
        targets.map((t) =>
          apiJson("/api/mail/archive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(t),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === targets.length) {
        unhideRows(targetKeys);
        setThreads(before);
        toast.error(`Couldn't archive ${row.name}'s mail`);
        return;
      }
      // Some through, some not: the list is rebuilt from the server on the
      // next load anyway, so say what happened rather than guessing.
      if (failed) {
        toast.error(`${failed} of ${targets.length} couldn't be archived`);
        return;
      }

      const archived = targets.length;
      toast(
        archived === 1
          ? `Conversation with ${row.name} archived`
          : `${archived} conversations with ${row.name} archived`,
        {
          action: {
            label: "Undo",
            onClick: () => {
              void (async () => {
                try {
                  await Promise.all(
                    targets.map((t) =>
                      apiJson("/api/mail/unarchive", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(t),
                      })
                    )
                  );
                  unhideRows(targetKeys);
                  setThreads(before);
                } catch (err) {
                  toast.error(
                    err instanceof Error ? err.message : "Couldn't undo"
                  );
                }
              })();
            },
          },
          duration: 8000,
        }
      );
    },
    [
      threads,
      removeThread,
      hideRemovedRows,
      unhideRows,
      landOnPerson,
      selectedPersonKey,
      setThreads,
    ]
  );

  /**
   * Delete every conversation with someone.
   *
   * `archivePerson` with the two things deleting adds: a pin and a cached
   * body outlive an archived thread but not a deleted one, so both go with
   * it, and the folder counts are told that something left.
   *
   * The caller asks first — this is the one action here that empties a list
   * — and Trash is what makes the asking enough. Nothing is destroyed, so
   * the answer to a mistake is the provider's Trash rather than an undo
   * that has to reach across a dozen requests.
   */
  const trashPerson = React.useCallback(
    async (row: PersonRow) => {
      const targets = row.threads.map((t) => ({
        account: t.account,
        threadId: t.threadId,
      }));
      if (!targets.length) return;
      const before = threads;

      const wasOpen = selectedPersonKey === row.key;
      const successor = successorAfterRemoving(
        personRowOrderRef.current,
        (r) => r.key === row.key
      );

      const targetKeys = targets.map((t) => threadKey(t));
      for (const target of targets) {
        unpinMailThread(target.account, target.threadId);
        invalidateCachedMailThread(target.account, target.threadId);
      }
      for (const rowKey of targetKeys) removeThread(rowKey);
      hideRemovedRows(targetKeys);
      if (wasOpen) landOnPerson(successor);

      const results = await Promise.allSettled(
        targets.map((t) =>
          apiJson("/api/mail/trash", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(t),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === targets.length) {
        unhideRows(targetKeys);
        setThreads(before);
        toast.error(mailSay("couldNotDeletePersonMail", { name: row.name }));
        return;
      }
      noteLeftOpenFolder(targets[0].account);
      if (failed) {
        toast.error(
          mailSay("someCouldNotBeDeleted", {
            failed,
            count: targets.length,
          })
        );
        return;
      }
      // One Undo for the batch, the way archiving does it. Trash is still
      // where these have gone, and the dialog said so — this is the quick
      // way back for the answer given half a second ago. On the stack too,
      // so Command+Z is the same way back.
      pushBatchUndo(
        targets.length === 1
          ? mailSay("conversationDeletedWith", { name: row.name })
          : mailSay("conversationsDeletedWith", {
              count: targets.length,
              name: row.name,
            }),
        async () => {
          try {
            await Promise.all(
              targets.map((t) =>
                apiJson("/api/mail/untrash", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(t),
                })
              )
            );
            unhideRows(targetKeys);
            setThreads(before);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : mailSay("couldNotUndo")
            );
          }
        }
      );
    },
    [
      threads,
      removeThread,
      hideRemovedRows,
      unhideRows,
      noteLeftOpenFolder,
      selectedPersonKey,
      landOnPerson,
      pushBatchUndo,
      setThreads,
    ]
  );

  /*
   * More than one row at a time.
   *
   * Shift-click takes everything between the open row and the one clicked;
   * Cmd-click adds one row, or takes it out again. The keys are thread keys
   * in the thread view and person keys in the people view — one set serves
   * both, because the two views are never on screen together.
   *
   * The open row is the anchor and stays open underneath. Nothing else is
   * opened by extending a selection: opening marks a thread read, and a
   * reader sweeping thirty rows to archive them has not read thirty rows.
   */
  const [multiKeys, setMultiKeys] = React.useState<Set<string>>(
    () => new Set()
  );
  const clearMultiSelection = React.useCallback(() => {
    setMultiKeys((current) => (current.size ? new Set() : current));
  }, []);
  // A new view, folder or search is a new list; a selection made in the old
  // one would name rows that are no longer there.
  React.useEffect(() => {
    clearMultiSelection();
  }, [viewMode, listCacheKey, clearMultiSelection]);

  const selectRowWithModifier = React.useCallback(
    (
      event: React.MouseEvent | undefined,
      rowKey: string,
      anchorKey: string | null,
      order: () => string[]
    ): boolean => {
      if (!event) return false;
      const extend = event.shiftKey;
      const toggle = event.metaKey || event.ctrlKey;
      if (!extend && !toggle) return false;
      event.preventDefault();
      setMultiKeys((current) => {
        if (extend) {
          // From the anchor if there is one; a shift-click with nothing open
          // is a click.
          if (!anchorKey) return new Set([rowKey]);
          const keys = order();
          const a = keys.indexOf(anchorKey);
          const b = keys.indexOf(rowKey);
          if (a < 0 || b < 0) return new Set([anchorKey, rowKey]);
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          return new Set(keys.slice(lo, hi + 1));
        }
        const next = new Set(current);
        // The anchor is part of it from the first Cmd-click, or the reader
        // is told two rows are selected while one of them is not marked.
        if (!next.size && anchorKey) next.add(anchorKey);
        if (next.has(rowKey)) next.delete(rowKey);
        else next.add(rowKey);
        return next;
      });
      return true;
    },
    []
  );

  /**
   * The threads a selection stands for, whichever view made it.
   *
   * In the people view a selected person is every open thread with them,
   * which is what archiving or deleting the person means.
   */
  const selectedThreadsNow = React.useCallback((): MailThreadSummary[] => {
    if (multiKeys.size < 2) return [];
    if (viewMode === "people") {
      return personRowOrderRef.current
        .filter((row) => multiKeys.has(row.key))
        .flatMap((row) => row.threads);
    }
    // The painted order, pins band included — the same list the selection
    // was made on. Read at the moment of acting, which is the only moment it
    // is needed.
    const seen = new Set<string>();
    const out: MailThreadSummary[] = [];
    for (const t of screenThreadOrderRef.current) {
      const key = threadKey(t);
      if (!multiKeys.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
    return out;
  }, [multiKeys, viewMode]);
  /** How many rows are selected — threads or people, as the view has it. */
  const multiSelectedCount = multiKeys.size >= 2 ? multiKeys.size : 0;

  /**
   * Where to land once the selected rows are gone: the first row after the
   * last selected one that is not itself selected, else the last before.
   * Worked out before anything is removed, from the painted order, for the
   * same reason `removeThread` does.
   */
  const successorAfterSelection = React.useCallback((): MailThreadSummary | null => {
    const painted = screenThreadOrderRef.current;
    const isSelected = (t: MailThreadSummary) => multiKeys.has(threadKey(t));
    let lastIdx = -1;
    painted.forEach((t, i) => {
      if (isSelected(t)) lastIdx = i;
    });
    for (let i = lastIdx + 1; i < painted.length; i += 1) {
      if (!isSelected(painted[i])) return painted[i];
    }
    for (let i = lastIdx - 1; i >= 0; i -= 1) {
      if (!isSelected(painted[i])) return painted[i];
    }
    return null;
  }, [multiKeys]);

  /**
   * Archive or delete every selected row.
   *
   * One request per thread — the providers have no batch — but one toast
   * and one Undo, the way `archivePerson` does it: thirty toasts for thirty
   * rows would be thirty things to dismiss and thirty clicks to undo.
   */
  const actOnSelection = React.useCallback(
    async (kind: "archive" | "trash") => {
      const targets = selectedThreadsNow().map((t) => ({
        account: t.account,
        threadId: t.threadId,
      }));
      if (!targets.length) return;
      const before = threads;
      const people = viewMode === "people";
      const successor = people ? null : successorAfterSelection();
      const targetKeys = targets.map((t) => threadKey(t));

      if (kind === "trash") {
        for (const target of targets) {
          unpinMailThread(target.account, target.threadId);
          invalidateCachedMailThread(target.account, target.threadId);
        }
      }
      for (const rowKey of targetKeys) removeThread(rowKey);
      hideRemovedRows(targetKeys);
      clearMultiSelection();
      if (people) {
        setSelected(null);
        setSelectedPersonKey(null);
      } else {
        setSelected(
          successor
            ? {
                account: successor.account,
                threadId: successor.threadId,
                inCrm: successor.tab === "people",
                focusMessageId: successor.focusMessageId,
              }
            : null
        );
      }

      const path = kind === "archive" ? "/api/mail/archive" : "/api/mail/trash";
      const results = await Promise.allSettled(
        targets.map((t) =>
          apiJson(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(t),
          })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      // The conversations, in the by-person view too: "3 people deleted"
      // said something that did not happen.
      const noun = mailSay(
        targets.length === 1 ? "conversationOne" : "conversationsMany",
        { count: targets.length }
      );
      if (failed === targets.length) {
        unhideRows(targetKeys);
        setThreads(before);
        toast.error(
          mailSay(kind === "archive" ? "couldNotArchiveThese" : "couldNotDeleteThese", {
            what: noun,
          })
        );
        return;
      }
      if (kind === "trash") noteLeftOpenFolder(targets[0].account);
      if (failed) {
        toast.error(
          mailSay(kind === "archive" ? "someCouldNotBeArchived" : "someCouldNotBeDeleted", {
            failed,
            count: targets.length,
          })
        );
        return;
      }
      const undoPath =
        kind === "archive" ? "/api/mail/unarchive" : "/api/mail/untrash";
      pushBatchUndo(
        mailSay(kind === "archive" ? "selectionArchived" : "selectionDeleted", {
          what: noun,
        }),
        async () => {
          try {
            await Promise.all(
              targets.map((t) =>
                apiJson(undoPath, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(t),
                })
              )
            );
            unhideRows(targetKeys);
            setThreads(before);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : mailSay("couldNotUndo")
            );
          }
        }
      );
    },
    [
      selectedThreadsNow,
      viewMode,
      threads,
      successorAfterSelection,
      removeThread,
      hideRemovedRows,
      unhideRows,
      clearMultiSelection,
      noteLeftOpenFolder,
      pushBatchUndo,
      setThreads,
    ]
  );

  /**
   * Read when anything is unread; otherwise the newest back to unread.
   *
   * One button for both, because they are the same intent seen from either
   * side: "I have dealt with this" and "I have not, after all". Which way it
   * goes is read off the rows, so the button always does the thing the icon
   * shows.
   *
   * Marking read clears every thread given. Marking unread touches one — the
   * newest — since bringing back eleven messages nobody asked for is not what
   * unread means to a reader.
   */
  const toggleRead = React.useCallback(
    async (rows: MailThreadSummary[], label: string) => {
      const unread = rows.filter((t) => t.unread);
      const before = threads;
      const call = (path: string, t: { account: string; threadId: string }) =>
        apiJson(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: t.account, threadId: t.threadId }),
        });

      if (unread.length) {
        setThreads((current) =>
          current.map((t) =>
            unread.some((u) => threadKey(u) === threadKey(t))
              ? { ...t, unread: false }
              : t
          )
        );
        // Every copy behind each row, or the row comes back bold from
        // the mailbox that was not told. A row is undone only when none
        // of its copies could be told: one mailbox being out must not
        // put back every row, nor the copies that did go through.
        const outcomes = await Promise.all(
          unread.map(async (t) => {
            const results = await Promise.allSettled(
              everyCopy(t, before).map((c) => call("/api/mail/read", c))
            );
            return { key: threadKey(t), ok: results.some((r) => r.status === "fulfilled") };
          })
        );
        const undone = new Set(outcomes.filter((o) => !o.ok).map((o) => o.key));
        if (undone.size) {
          setThreads((current) =>
            current.map((t) => (undone.has(threadKey(t)) ? { ...t, unread: true } : t))
          );
          toast.error(`Couldn't mark ${label} read`);
        }
        return;
      }

      // Newest first in the list, so the newest thread is the one at the top.
      const newest = rows[0];
      if (!newest) return;
      setThreads((current) =>
        current.map((t) =>
          threadKey(t) === threadKey(newest) ? { ...t, unread: true } : t
        )
      );
      try {
        await call("/api/mail/unread", newest);
      } catch (err) {
        setThreads(before);
        toast.error(
          err instanceof Error ? err.message : "Couldn't mark unread"
        );
      }
    },
    [threads, setThreads]
  );

  /**
   * The right-click menu on a person: whose row, and where the pointer was.
   *
   * One piece of state for the whole list, because one menu is up at a
   * time. The row itself is looked up when it is drawn, so a list that
   * reloads under an open menu cannot leave it pointing at a stale pile.
   */
  const [personMenuAt, setPersonMenuAt] = React.useState<
    { key: string; x: number; y: number } | null
  >(null);
  /**
   * The thread a "Snooze…" in that menu is about, and where to hang the
   * times. Held apart from the menu because the menu closes as it opens
   * this, and the picker must outlive it.
   */
  const [personSnooze, setPersonSnooze] = React.useState<{
    thread: MailThreadSummary;
    x: number;
    y: number;
  } | null>(null);
  const [personSnoozeSignal, setPersonSnoozeSignal] = React.useState(0);
  /**
   * Whether the times have actually been up yet.
   *
   * The picker reports itself closed once as it mounts, before it has ever
   * been open — and a picker that puts itself away on that report is one
   * that never appears at all.
   */
  const personSnoozeShown = React.useRef(false);
  const askPersonSnooze = React.useCallback(
    (thread: MailThreadSummary, x: number, y: number) => {
      personSnoozeShown.current = false;
      setPersonSnooze({ thread, x, y });
      setPersonSnoozeSignal((n) => n + 1);
    },
    []
  );

  const togglePersonPin = React.useCallback((row: PersonRow) => {
    const pinned = toggleMailPersonPin(row.key);
    toast(pinned ? `${row.name} pinned to the top` : `${row.name} unpinned`);
  }, []);

  const pinFlipFromRef = React.useRef<Map<string, DOMRect> | null>(null);
  const pinFlipFocusRef = React.useRef<string | null>(null);

  const capturePinFlip = React.useCallback((focusKey: string) => {
    pinFlipFromRef.current = readThreadRowRects(listScrollRef.current);
    pinFlipFocusRef.current = focusKey;
  }, []);

  const togglePin = React.useCallback(
    (summary: MailThreadSummary) => {
      capturePinFlip(threadKey(summary));
      const nowPinned = toggleMailPin(summary);
      toast(nowPinned ? t("pinned") : t("unpinned"));
    },
    [capturePinFlip, t]
  );

  // After pin/unpin reflow, glide rows from their old spots (FLIP).
  React.useLayoutEffect(() => {
    const from = pinFlipFromRef.current;
    if (!from) return;
    const focus = pinFlipFocusRef.current;
    pinFlipFromRef.current = null;
    pinFlipFocusRef.current = null;
    playThreadRowFlip(listScrollRef.current, from, focus);
  }, [pins]);

  const trash = React.useCallback(
    async (
      t: { account: string; threadId: string },
      /** Which control asked, for the line below. */
      from: "reader" | "row" | "drop" | "person" = "row"
    ) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      const provider = isOutlookAccount(t.account) ? "Outlook" : "Gmail";
      /*
        Every copy, not the one the row happens to stand for.

        A mail that arrived in two of the reader's mailboxes is one row —
        see dedupeThreadsByTip. Deleting only the row's own copy left the
        other one to take the row's place on the next refresh, the same
        subject in the same spot, so it read as though nothing had happened
        and the reader deleted again. By then the selection had moved to
        the next conversation, so what went the second time was a mail
        they had never meant to touch.
      */
      /*
        Say what is going, from where, and what was on screen when it went.

        A delete has twice taken a conversation that was neither open nor
        selected, and the toast named it correctly — so the wrong one was
        chosen before the key was pressed. This line says which control
        asked and what the reader had, which is the difference between a
        guess and an answer.
      */
      console.info(
        `[mail] trash from ${from}: ${key} "${
          summary?.subject ?? "(not in the list)"
        }" · selected ${selected ? threadKey(selected) : "(none)"}`
      );
      const copies = everyCopy(t, threads);
      const keys = copies.map(threadKey);
      // Trash removes the conversation — drop pin + body cache with it.
      for (const c of copies) {
        unpinMailThread(c.account, c.threadId);
        invalidateCachedMailThread(c.account, c.threadId);
      }
      removeThread(key, keys);
      hideRemovedRows(keys);
      const sent = Promise.all(
        copies.map((c) =>
          apiJson("/api/mail/trash", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(c),
          })
        )
      );
      // On the stack now, not when the provider answers — see `after`. The
      // folder count goes down only once it went, and undo waits for that,
      // so the count undo puts back is one that was taken.
      const undoId = summary
        ? pushMailUndo(
            "trash",
            summary,
            `"${summary.subject}" moved to Trash in ${provider}`,
            undefined,
            openFolderName,
            sent
          )
        : null;
      try {
        await sent;
        // Neither provider counts a deleted conversation in a folder.
        noteLeftOpenFolder(t.account);
        if (!summary) toast(`Conversation moved to Trash in ${provider}`);
      } catch (err) {
        dropMailUndo(undoId);
        unhideRows(keys);
        setThreads(before);
        toast.error(err instanceof Error ? err.message : "Couldn't delete");
      }
    },
    [
      threads,
      removeThread,
      pushMailUndo,
      dropMailUndo,
      noteLeftOpenFolder,
      openFolderName,
      hideRemovedRows,
      unhideRows,
      isOutlookAccount,
      selected,
      setThreads,
    ]
  );

  /**
   * Put a deleted conversation back where it came from.
   *
   * Only offered from the Trash view, which is the only place a thread is
   * known to be deleted. "Delete forever" stands beside it: see `purgeAsk`.
   */
  const restoreFromTrash = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      const key = threadKey(t);
      const before = threads;
      invalidateCachedMailThread(t.account, t.threadId);
      removeThread(key);
      setSelected(null);
      try {
        await apiJson("/api/mail/untrash", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        });
        toast.success(mailSay("movedOutOfTrash"));
      } catch (err) {
        setThreads(before);
        toast.error(
          err instanceof Error ? err.message : mailSay("couldNotRestore")
        );
      }
    },
    [threads, removeThread, setThreads]
  );

  /**
   * Mail deleted for good, from Trash or from Junk.
   *
   * This is the one action in the list that nothing can undo once it is
   * done, so it never runs from its button. The button sets `purgeAsk`, the
   * dialog asks, and only its red button calls `runPurge`. Even then the
   * provider is not told for a few seconds: a navy pill counts down with
   * Undo, as it does for Send. Undo there means "it was not done yet". See
   * `undo-purge.tsx`.
   *
   * It acts only on conversations that the reader has picked: the open one,
   * a row's own menu, or a selection of rows. There is no "empty the folder"
   * and there will not be one. A reader who wants Trash empty selects what
   * is in it, and so sees what goes.
   *
   * `purgeFrom` is the folder on screen when it is Trash or Junk, and null
   * everywhere else. No other view offers the action.
   */
  const purgeFrom: "trash" | "junk" | null = inTrashView ? "trash" : inJunkView ? "junk" : null;
  const [purgeAsk, setPurgeAsk] = React.useState<{
    from: "trash" | "junk";
    /** How many rows the reader picked. The question counts these. */
    count: number;
    /**
     * What goes: those rows and every copy folded into them. A mail that
     * arrived in two of the reader's mailboxes is one row in the list, and
     * can be one in Gmail and one in Outlook.
     */
    targets: { account: string; threadId: string }[];
  } | null>(null);

  /** Ask the question about these conversations. Null outside Trash and Junk. */
  const askDeleteForever = React.useMemo(
    () =>
      purgeFrom
        ? (rows: { account: string; threadId: string }[]) => {
            if (!rows.length) return;
            setPurgeAsk({
              from: purgeFrom,
              count: rows.length,
              // The list as it is now, read at the moment of asking.
              targets: everyCopyOfEach(rows, threadsRef.current),
            });
          }
        : undefined,
    [purgeFrom, threadsRef]
  );

  const runPurge = React.useCallback(() => {
    const ask = purgeAsk;
    if (!ask || !ask.targets.length) return;
    setPurgeAsk(null);
    const before = threads;
    const keys = ask.targets.map((t) => threadKey(t));
    // The rows go now. `hideRemovedRows` keeps them out of a list that is
    // read again during the count, while the mail is still on the server.
    for (const key of keys) removeThread(key);
    hideRemovedRows(keys);
    clearMultiSelection();
    setSelected(null);
    // The by-person page too: its conversations are the ones that just went.
    setSelectedPersonKey(null);

    const putBack = () => {
      unhideRows(keys);
      setThreads(before);
    };

    deleteForeverWithUndo({
      onUndo: putBack,
      onRun: async () => {
        for (const target of ask.targets) {
          invalidateCachedMailThread(target.account, target.threadId);
        }
        const results = await Promise.allSettled(
          ask.targets.map((target) =>
            apiJson("/api/mail/delete-forever", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...target, from: ask.from }),
            })
          )
        );
        const failed = results.filter((r) => r.status === "rejected");
        if (!failed.length) {
          sayDeletedForever();
          return;
        }
        // What failed is still on the server, so it is shown again. What
        // went is gone, and the list is read again to say so.
        unhideRows(keys);
        if (failed.length === ask.targets.length) {
          setThreads(before);
          const first = (failed[0] as PromiseRejectedResult).reason;
          toast.error(
            first instanceof Error ? first.message : mailSay("couldNotDeleteForever")
          );
          return;
        }
        toast.error(
          mailSay("someCouldNotBeDeletedForever", {
            failed: failed.length,
            count: ask.targets.length,
          })
        );
        void loadThreads({ fresh: true });
      },
    });
  }, [
    purgeAsk,
    threads,
    removeThread,
    hideRemovedRows,
    unhideRows,
    clearMultiSelection,
    loadThreads,
    setThreads,
  ]);

  /**
   * File a conversation as junk, or take it back out.
   *
   * Filing, not reporting: it moves the mail and syncs everywhere, and
   * teaches neither provider anything about the sender. See
   * `markMailThreadJunk`.
   */
  const setThreadJunk = React.useCallback(
    async (t: { account: string; threadId: string }, junk: boolean) => {
      const key = threadKey(t);
      const before = threads;
      // Every copy behind the row — the same reason as in `trash`.
      const copies = everyCopy(t, threads);
      const keys = copies.map(threadKey);
      for (const c of copies) invalidateCachedMailThread(c.account, c.threadId);
      removeThread(key, keys);
      if (junk) hideRemovedRows(keys);
      setSelected(null);
      try {
        await Promise.all(
          copies.map((c) =>
            apiJson(junk ? "/api/mail/junk" : "/api/mail/not-junk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(c),
            })
          )
        );
        // Junk is out of every folder search, the same as Trash. Taking one
        // back out of Junk happens in the Junk view, where no folder is open.
        if (junk) noteLeftOpenFolder(t.account);
        toast.success(
          mailSay(junk ? "movedToJunk" : "movedBackToTheInbox")
        );
      } catch (err) {
        unhideRows(keys);
        setThreads(before);
        toast.error(
          err instanceof Error
            ? err.message
            : mailSay(junk ? "couldNotMoveToJunk" : "couldNotMoveBack")
        );
      }
    },
    [
      threads,
      removeThread,
      noteLeftOpenFolder,
      hideRemovedRows,
      unhideRows,
      setThreads,
    ]
  );

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
    [offerMacContacts]
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

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A key can land on the document itself, which has no `closest`.
      const target = e.target instanceof Element ? e.target : null;
      const typing = Boolean(
        target?.closest('input, textarea, [contenteditable="true"]')
      );
      /**
       * A key pressed inside an open menu belongs to that menu.
       *
       * These shortcuts live on the window, so they answered keys pressed
       * anywhere — including inside a popover the reader had just opened.
       * Down in the snooze menu moved the selected thread, which is the
       * one thing that must not happen while you are choosing what to do
       * with the thread you are on.
       */
      if (
        target?.closest(
          '[data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]'
        )
      ) {
        return;
      }

      // Escape → leave the open folder (back to inbox tabs).
      if (
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        e.key === "Escape" &&
        activeFolder
      ) {
        e.preventDefault();
        setActiveFolder(null);
        return;
      }

      /**
       * Down and Up move the selection to the next message.
       *
       * They were scrolling the list and leaving the selection where it was,
       * which is not what a list with a selection in it does — the reader
       * loses sight of the row they are on and nothing follows the keys.
       */
      if (
        !typing &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        (e.key === "ArrowDown" || e.key === "ArrowUp")
      ) {
        /*
          In the by-person view the list is people, so the keys walk people.

          They walked threads there too, because this handler knew only one
          kind of list. The rows under the reader's eyes did not move, and a
          thread they could not see opened in the pane beside them.
        */
        if (viewMode === "people") {
          const people = personRowOrderRef.current;
          if (!people.length) return;
          e.preventDefault();
          const from = selectedPersonKey
            ? people.findIndex((r) => r.key === selectedPersonKey)
            : -1;
          const to =
            from === -1
              ? 0
              : e.key === "ArrowDown"
                ? Math.min(from + 1, people.length - 1)
                : Math.max(from - 1, 0);
          const person = people[to];
          if (!person || to === from) return;
          // The same landing a click makes, so a person with one thread
          // opens it here too rather than showing a card to press.
          landOnPerson(person);
          const wantedKey = person.key;
          requestAnimationFrame(() => {
            for (const row of document.querySelectorAll<HTMLElement>(
              "[data-person-key]"
            )) {
              if (row.dataset.personKey !== wantedKey) continue;
              row.focus({ preventScroll: true });
              row.scrollIntoView({ block: "nearest" });
              break;
            }
          });
          return;
        }
        const rows = screenThreadOrderRef.current;
        if (!rows.length) return;
        e.preventDefault();
        const at = selected
          ? rows.findIndex((t) => rowStandsFor(t, selected))
          : -1;
        // Nothing selected yet: the first key press takes the top row rather
        // than counting from a place the reader never was.
        const next =
          at === -1
            ? 0
            : e.key === "ArrowDown"
              ? Math.min(at + 1, rows.length - 1)
              : Math.max(at - 1, 0);
        const target = rows[next];
        // Already at the end being asked for. Re-opening the same row would
        // refetch and re-focus it for no movement at all.
        if (!target || next === at) return;
        openThreadRef.current?.(target);
        // After the row is painted as selected, and only as far as it needs
        // to go — a selection two rows down should not re-centre the list.
        // Found by reading the keys rather than by a selector, because a
        // thread id is not safe to put in one.
        const wanted = threadKey(target);
        requestAnimationFrame(() => {
          for (const row of document.querySelectorAll<HTMLElement>(
            "[data-thread-key]"
          )) {
            if (row.dataset.threadKey !== wanted) continue;
            // Focus as well as select. Each row is focusable, so the ring the
            // browser draws stays on whichever one was last clicked — it sat
            // on the row at the top while the selection walked away from it,
            // marking a row that was no longer the one in hand.
            row.focus({ preventScroll: true });
            row.scrollIntoView({ block: "nearest" });
            break;
          }
        });
        return;
      }

      // Backspace deletes, and Cmd+Shift+A archives. Both are thread
      // shortcuts now, and editable — see lib/mail/shortcuts and ThreadPane.

      // Cmd/Ctrl+Option+F → the mail search box, from anywhere including an
      // open thread. Apple Mail puts mailbox search here and Forward on
      // Cmd+Shift+F, which is where the thread shortcuts put it too. Plain
      // Cmd+F belongs to find-in-thread; see `use-thread-find.ts`.
      //
      // `code` rather than `key`: macOS turns Option+F into "ƒ".
      if (
        (e.metaKey || e.ctrlKey) &&
        e.altKey &&
        !e.shiftKey &&
        e.code === "KeyF"
      ) {
        e.preventDefault();
        const field = searchInputRef.current;
        field?.focus();
        field?.select();
        return;
      }

      // Option+Cmd+Plus/Minus/0 → the app text size, in every state.
      //
      // Always the app. It does not depend on a thread being open or focused.
      // Cmd+Plus/Minus keeps meaning the thing being read or written.
      //
      // `code` rather than `key`: Option turns those keys into other marks
      // (≠, –, º), the same trap as Option+F above. The Cmd+Plus/Minus
      // branch below still reads `key`, because that is what is right
      // without Option.
      //
      // It fires while typing as well. The composer is part of what is
      // resized, and someone who resizes the app while writing means it.
      if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey) {
        if (e.code === "Equal") {
          e.preventDefault();
          setUiScale(nextUiScaleStop(uiScale, 1));
          return;
        }
        if (e.code === "Minus") {
          e.preventDefault();
          setUiScale(nextUiScaleStop(uiScale, -1));
          return;
        }
        if (e.code === "Digit0") {
          e.preventDefault();
          setUiScale(1);
          return;
        }
      }

      // Cmd/Ctrl+Plus and Cmd/Ctrl+Minus → the text size the +/− controls set
      // when a thread or a composer is open. With nothing open they step the
      // app size instead, so the keys are never dead.
      //
      // That fallthrough is a convenience. Option+Cmd+Plus/Minus is the rule:
      // it is the app in every state, including this one, where both do the
      // same thing.
      //
      // The test is `detailOpen`. It is visible on the screen. Do not use
      // focus. Focus is invisible, and the two scales then drift with nobody
      // able to tell which key moved which.
      //
      // This sits above the Shift test below on purpose. A US keyboard makes
      // "+" with Shift, and a Danish one has a key for it, so the Shift state
      // says nothing here. Both layouts are read by `key`, not `code`.
      //
      // It fires while typing as well: the composer shows the same control,
      // and no text field does anything else with these.
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.key === "+" || e.key === "=") {
          // Without this the webview zooms the whole window instead.
          e.preventDefault();
          if (detailOpen) {
            // To the next round size, not a tenth on from wherever a pinch
            // happened to stop — see `nextZoomStop`.
            adjustZoom(nextZoomStop(zoom, 1) - zoom);
          } else {
            setUiScale(nextUiScaleStop(uiScale, 1));
          }
          return;
        }
        if (e.key === "-" || e.key === "_") {
          e.preventDefault();
          if (detailOpen) {
            adjustZoom(nextZoomStop(zoom, -1) - zoom);
          } else {
            setUiScale(nextUiScaleStop(uiScale, -1));
          }
          return;
        }
      }

      // Option+Cmd+L expands the list. The next line used to drop every
      // Option chord, so this has to be read first.
      if (shortcutMatchesEvent(e, shortcuts.expandList)) {
        if (typing || e.repeat) return;
        e.preventDefault();
        toggleListExpanded();
        return;
      }

      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();

      // Cmd/Ctrl+N → Compose (block the browser's New Window).
      if (key === "n") {
        e.preventDefault();
        startCompose();
        return;
      }

      // Cmd/Ctrl+Z → undo one archive/trash (not while typing — editor undo).
      if (key === "z") {
        if (typing || e.repeat || mailUndoStackRef.current.length === 0) return;
        e.preventDefault();
        void undoLastMailAction();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    undoLastMailAction,
    startCompose,
    selected,
    archive,
    activeFolder,
    adjustZoom,
    shortcuts,
    toggleListExpanded,
    // Which of the two scales Cmd+Plus/Minus moves — see the branch.
    detailOpen,
    uiScale,
    setUiScale,
    // Read to work out the next round size to step to.
    zoom,
    // Which list the arrow keys are walking, and where in it.
    viewMode,
    selectedPersonKey,
    landOnPerson,
  ]);

  /**
   * The selection a drag is carrying, or nothing when it carries one row.
   *
   * A row that is part of the selection takes the whole of it: the reader
   * ticked three conversations and dragged one of them, which is how every
   * list says "these". A row that is not in the selection is just itself,
   * and the selection stays where it is.
   */
  const dragCarriesSelection = React.useCallback(
    (thread: { account: string; threadId: string }): MailThreadSummary[] => {
      const chosen = selectedThreadsNow();
      const key = threadKey(thread);
      const carried =
        chosen.length > 1 && chosen.some((t) => threadKey(t) === key);
      return carried ? chosen : [];
    },
    [selectedThreadsNow]
  );

  /**
   * File several at once, and say so once.
   *
   * The single case keeps its own path above: it has an undo that puts one
   * conversation back where it came from. This one reports how many went
   * and where, and a failure puts every one of them back.
   */
  const moveManyToFolder = React.useCallback(
    async (targets: MailThreadSummary[], folderName: string) => {
      const before = threads;
      const keys = targets.map((t) => threadKey(t));
      for (const key of keys) removeThread(key);
      hideRemovedRows(keys);
      clearMultiSelection();
      const results = await Promise.allSettled(
        targets.map((t) =>
          apiJson<{ folderName: string; movedOut?: boolean }>(
            "/api/mail/folders/move",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                account: t.account,
                threadId: t.threadId,
                folderName,
                create: false,
              }),
            }
          )
        )
      );
      const done = results.filter(
        (r): r is PromiseFulfilledResult<{ folderName: string; movedOut?: boolean }> =>
          r.status === "fulfilled"
      );
      if (!done.length) {
        unhideRows(keys);
        setThreads(before);
        toast.error(mailSay("couldNotMove"));
        return;
      }
      const landed = done[0].value.folderName;
      for (const [i, result] of results.entries()) {
        if (result.status !== "fulfilled") continue;
        bumpMailFolderCount(targets[i].account, result.value.folderName, 1);
        if (result.value.movedOut) noteLeftOpenFolder(targets[i].account);
      }
      if (done.length < targets.length) {
        toast.error(
          mailSay("someCouldNotBeMoved", {
            failed: targets.length - done.length,
            count: targets.length,
          })
        );
        return;
      }
      toast.success(
        mailSay("movedManyToFolder", { count: targets.length, name: landed })
      );
    },
    [
      threads,
      removeThread,
      hideRemovedRows,
      unhideRows,
      clearMultiSelection,
      noteLeftOpenFolder,
      setThreads,
    ]
  );

  const snooze = React.useCallback(
    async (t: { account: string; threadId: string }, untilIso: string) => {
      const key = threadKey(t);
      const before = threads;
      const summary = threads.find((x) => threadKey(x) === key);
      const onSnoozedTab = !activeFolder && tab === "snoozed";
      const untilMs = Date.parse(untilIso);
      if (!onSnoozedTab && Number.isFinite(untilMs)) {
        // Only until the server has caught up, not until the wake time.
        // The server's filter owns the hiding after that — and it can end
        // a snooze early when a reply arrives, which a row vetoed here
        // until the original wake time would never show.
        hideRow(
          hiddenRowsRef.current,
          key,
          listViewIdRef.current,
          Math.min(untilMs, Date.now() + REMOVED_ROW_HIDE_MS)
        );
        // Drop any in-flight list response built before this snooze.
        loadAbortRef.current?.abort();
      }
      if (onSnoozedTab) {
        setThreads((current) => {
          const next = current
            .map((row) =>
              threadKey(row) === key
                ? { ...row, snoozedUntil: untilIso }
                : row
            )
            .sort(
              (a, b) =>
                Date.parse(a.snoozedUntil ?? a.lastAt) -
                Date.parse(b.snoozedUntil ?? b.lastAt)
            );
          patchCachedThreads(viewerId, listCacheKey, next);
          return next;
        });
      } else {
        removeThread(key);
      }
      try {
        await apiJson("/api/mail/snooze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...t, until: untilIso }),
        });
        const when = formatSnoozeWakeLabel(untilIso);
        if (!onSnoozedTab) {
          setSnoozedCount((n) => {
            const current = n == null ? 0 : n;
            return current + 1;
          });
        }
        if (summary && !onSnoozedTab) {
          pushMailUndo("snooze", summary, `Snoozed until ${when}`);
        } else {
          toast(`Snoozed until ${when}`);
        }
      } catch (err) {
        unhideRow(hiddenRowsRef.current, key);
        setThreads(before);
        toast.error(err instanceof Error ? err.message : "Couldn't snooze");
      }
    },
    [
      threads,
      removeThread,
      pushMailUndo,
      activeFolder,
      tab,
      listCacheKey,
      hiddenRowsRef,
      listViewIdRef,
      loadAbortRef,
      setSnoozedCount,
      setThreads,
      viewerId,
    ]
  );

  const unsnooze = React.useCallback(
    async (t: { account: string; threadId: string }) => {
      const key = threadKey(t);
      const before = threads;
      unhideRow(hiddenRowsRef.current, key);
      removeThread(key);
      try {
        await apiJson("/api/mail/unsnooze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(t),
        });
        setSnoozedCount((n) => {
          const current = n == null ? 1 : n;
          return Math.max(0, current - 1);
        });
        toast.success(mailSay("snoozeCancelled"));
      } catch (err) {
        setThreads(before);
        toast.error(
          err instanceof Error ? err.message : "Couldn't cancel snooze"
        );
      }
    },
    [threads, removeThread, hiddenRowsRef, setSnoozedCount, setThreads]
  );

  /**
   * Sync, as the reader means it: everything, including the thread on screen.
   *
   * Refreshing the list alone was not enough. A thread's body is cached and
   * held fresh while its newest message is unchanged — and a reply written in
   * Gmail is a draft, not a message, so the thread's tip does not move and
   * nothing here had any reason to look again. The draft stayed invisible
   * however many times Sync was pressed.
   */
  /**
   * The button spins for at least one turn.
   *
   * A poll that finds nothing new answers in a moment, and the icon started
   * and stopped inside a fifth of a second — a twitch, in the middle of a
   * rotation, which reads as a sync that failed rather than one that found
   * nothing. A whole turn is a movement, and it ends where it began.
   *
   * `animate-spin` is a one second rotation, so the floor is one second: any
   * other number stops the icon mid-way round.
   */
  const [syncTurn, setSyncTurn] = React.useState(false);
  const syncTurnRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (syncTurnRef.current) clearTimeout(syncTurnRef.current);
    },
    []
  );

  const syncNow = React.useCallback(() => {
    if (selected) {
      invalidateCachedMailThread(selected.account, selected.threadId);
    }
    setSyncTurn(true);
    if (syncTurnRef.current) clearTimeout(syncTurnRef.current);
    syncTurnRef.current = setTimeout(() => {
      syncTurnRef.current = null;
      setSyncTurn(false);
    }, 1000);
    /*
      And say what came in, when something did.

      A poll that finds nothing changes nothing on screen, which is the right
      answer and an easy one to read as "it did not run". The turn of the icon
      says it ran; this says what it found, and stays quiet when the answer is
      nothing — a message saying "no new mail" after every press is a message
      nobody thanks you for.
    */
    const before = new Set(threadsRef.current.map((t) => threadKey(t)));
    void loadThreads({ fresh: true, incremental: true }).then((ok) => {
      if (!ok) return;
      const arrived = threadsRef.current.filter(
        (t) => !before.has(threadKey(t))
      ).length;
      if (!arrived) return;
      toast.success(
        arrived === 1
          ? mailSay("syncFoundOne")
          : mailSay("syncFoundMany", { count: arrived })
      );
    });
  }, [loadThreads, selected, threadsRef]);

  /**
   * What the providers are holding, across every mailbox that can hold.
   *
   * Its own group above the days, and only when there is something in it —
   * an empty heading is one more thing to read and rule out. Refreshed on a
   * slow timer so a row leaves the group when its message goes.
   */
  const [heldMessages, setHeldMessages] = React.useState<
    MailScheduledMessage[]
  >([]);
  const loadHeldMessages = React.useCallback(async () => {
    try {
      const json = await apiJson<{ messages?: MailScheduledMessage[] }>(
        "/api/mail/scheduled"
      );
      setHeldMessages(json.messages ?? []);
    } catch {
      // No Outlook, or the provider would not say. Show no group.
      setHeldMessages([]);
    }
  }, []);
  /** Try a failed message again, or let it go. */
  const actOnHeld = React.useCallback(
    async (held: MailScheduledMessage, action: "sendNow" | "cancel") => {
      try {
        await apiJson("/api/mail/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account: held.account, id: held.id, action }),
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't change the message");
      }
      void loadHeldMessages();
    },
    [loadHeldMessages]
  );
  React.useEffect(() => {
    void loadHeldMessages();
    const timer = window.setInterval(() => void loadHeldMessages(), 60_000);
    const onFocus = () => void loadHeldMessages();
    window.addEventListener("focus", onFocus);
    // The thread says so the moment one is cancelled, sent, or edited. The
    // timer is for messages that leave on their own, at their time.
    const stopListening = onScheduledChanged(() => void loadHeldMessages());
    // And the worker says when one has gone, or has been given up, so the
    // Outbox changes as it happens rather than at the next minute.
    let cancelled = false;
    const unlisten: (() => void)[] = [];
    const tauriEvent = (window as unknown as {
      __TAURI__?: { event?: { listen: (name: string, cb: () => void) => Promise<() => void> } };
    }).__TAURI__?.event;
    if (tauriEvent?.listen) {
      for (const name of ["mail-sync-sent", "mail-sync-send-failed"]) {
        void tauriEvent
          .listen(name, () => void loadHeldMessages())
          .then((fn) => {
            if (cancelled) fn();
            else unlisten.push(fn);
          })
          .catch(() => {});
      }
    }
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      stopListening();
      for (const fn of unlisten) fn();
    };
  }, [loadHeldMessages]);

  const openThread = React.useCallback((t: MailThreadSummary) => {
    setComposing(false);
    setListExpanded(false);
    setSelected({
      account: t.account,
      threadId: t.threadId,
      inCrm: t.tab === "people",
      focusMessageId: t.focusMessageId,
    });
    /**
     * Tell the provider it has been read.
     *
     * Fetching the thread does this too, but only when the fetch is actually
     * made. A thread whose body was prefetched paints straight from the cache
     * and asks the server nothing — the prefetch deliberately passes
     * `markRead=0` so warming a body does not clear unread badges, and the
     * open that follows never sends anything at all. So the read state stayed
     * on this machine, looked right, and the next sync put the bold back.
     * Marking read by hand from the settings menu always worked, because that
     * has an endpoint of its own; opening a thread had none.
     */
    if (t.unread) {
      // Every copy behind the row: a thread cc'd to two mailboxes is one
      // row, unread while either copy is. Marking one read left the row
      // read for a moment and then bold again from the other.
      for (const c of everyCopy(t, threadsRef.current)) {
        void apiJson("/api/mail/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        }).catch((err) => {
          console.warn("[mail] could not mark the thread read:", err);
        });
      }
    }
    setThreads((current) => {
      const next = current.map((item) =>
        rowStandsFor(item, t) ? { ...item, unread: false } : item
      );
      patchCachedThreads(viewerId, listCacheKey, next);
      return next;
    });
  }, [listCacheKey, setThreads, threadsRef, viewerId]);
  openThreadRef.current = openThread;

  /**
   * What the right-click menu on a row asked the reader to do.
   *
   * Reply, forward, print and pop out all need the messages, and a row has
   * a summary. So the thread is opened and the action travels with it; the
   * reader does it as soon as it has something to do it to, and says so,
   * which clears this. Held with the thread it belongs to, so an action
   * meant for one conversation cannot land on the next one opened.
   */
  const [pendingRowAction, setPendingRowAction] = React.useState<{
    account: string;
    threadId: string;
    action: MailThreadAction;
  } | null>(null);

  /**
   * Everything the row's menu needs that the list itself cannot answer.
   *
   * One bundle rather than nine props written out twice, because the list
   * is drawn in two places — grouped by date and grouped by person — and
   * two copies of this is two chances for them to drift apart.
   */
  /**
   * A message's attachments, as the snapshots a draft carries.
   *
   * The bytes, not a reference: a draft holds what it will send, so it
   * survives the message it came from being archived or deleted. One that
   * cannot be fetched is left out rather than left broken — the strip
   * shows what is really there.
   */
  const draftAttachmentsOf = React.useCallback(
    async (
      account: string,
      message: MailMessage
    ): Promise<DraftAttachmentSnapshot[]> => {
      const out: DraftAttachmentSnapshot[] = [];
      for (const attachment of message.attachments ?? []) {
        try {
          const res = await mailApiFetch(
            attachmentUrl({ account, messageId: message.id, attachment })
          );
          if (!res.ok) continue;
          const blob = await res.blob();
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const url = String(reader.result || "");
              resolve(url.slice(url.indexOf(",") + 1));
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          out.push({
            id: `att-copy-${out.length}-${attachment.filename}`,
            filename: attachment.filename,
            mimeType: attachment.mimeType || blob.type,
            size: blob.size,
            progress: null,
            contentBase64: base64,
          });
        } catch {
          // Left out. A file that will not come is not one to promise.
        }
      }
      return out;
    },
    []
  );

  /**
   * A message copied out as a new one, to send again.
   *
   * The words and the subject, and nobody in To. A mail worth reusing is a
   * mail being sent to somebody else — carrying the old recipients over
   * would put the last person one keystroke away from getting it twice.
   */
  const editAsNewFromSource = React.useCallback(
    async (account: string, subject: string, source: MailMessage) => {
      try {
        const key = newComposeDraftKey();
        await saveComposeDraft({
          key,
          kind: "compose",
          from: account,
          // The subject without the marks a conversation put on it: this
          // is the first message of another one.
          subject: subject
            .replace(/^\s*((re|fwd?|sv|vs)\s*(\[\d+\])?:\s*)+/i, "")
            .trim(),
          /*
            Its own words, without the conversation under them.

            A mail carries the tail of what it answered, and one being
            reused as a template is being taken out of that conversation —
            so the quoted history is somebody else's message, pasted into
            a new one going to a third party.
          */
          body: source.bodyHtml
            ? (() => {
                const safe = sanitizeEmailHtml(source.bodyHtml);
                const split = stripQuotedHtml(safe);
                const kept =
                  split.hadQuote && split.html.trim() ? split.html : safe;
                // The reader softens every link into a span for its click
                // bridge. An editor knows nothing of that bridge and would
                // keep the words while dropping the address, so the links
                // are put back before the copy is written.
                return dropRemoteImagesForEditing(
                  restoreAnchorsForEditing(kept)
                );
              })()
            : plainTextToEditorHtml(
                stripQuotedReplies(
                  decodeHtmlEntities(formatEmailBody(source.bodyText || ""))
                ).trim() || source.bodyText || ""
              ),
          toList: [],
          ccList: [],
          bccList: [],
          showCc: false,
          showBcc: false,
          includeSignature: false,
          // Its files as well. Most of what is worth sending again is worth
          // sending again with the programme, the invoice or the slides
          // that made it worth sending the first time.
          attachments: await draftAttachmentsOf(account, source),
        });
        startCompose({
          to: [],
          subject: "",
          continuedFromLabel: "",
          draftKey: key,
        });
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("editAsNewFailed")
        );
      }
    },
    [draftAttachmentsOf, startCompose, t]
  );

  /**
   * Our own first message in the thread, because a mail reused as a
   * template is the one we wrote to start it. Failing that, the first
   * one there is.
   *
   * Pass a message id to take that message instead — the hover menu on a
   * bubble does, so a later mail in the thread can be the copy.
   */
  const editAsNewMessage = React.useCallback(
    async (
      row: { account: string; threadId: string },
      messageId?: string
    ) => {
      try {
        if (messageId) {
          const params = new URLSearchParams({
            account: row.account,
            id: row.threadId,
            markRead: "0",
            around: messageId,
          });
          const json = await apiJson<{ thread: MailThreadDetail }>(
            `/api/mail/thread?${params.toString()}`
          );
          const source = json.thread.messages.find((m) => m.id === messageId);
          if (!source) {
            toast.error(t("editAsNewFailed"));
            return;
          }
          await editAsNewFromSource(row.account, json.thread.subject, source);
          return;
        }

        // The open thread loads the newest page. The first mail we sent
        // is at the other end, so this walks from the start until it
        // finds one of ours.
        let after: string | null = null;
        let subject = "";
        let source: MailMessage | undefined;
        let first: MailMessage | undefined;
        for (let page = 0; page < 20; page += 1) {
          const params = new URLSearchParams({
            account: row.account,
            id: row.threadId,
            markRead: "0",
          });
          if (after) params.set("after", after);
          else params.set("oldest", "1");
          const json = await apiJson<{ thread: MailThreadDetail }>(
            `/api/mail/thread?${params.toString()}`
          );
          subject = json.thread.subject;
          const messages = json.thread.messages;
          if (!first) first = messages[0];
          source = messages.find((m) => m.own);
          if (source) break;
          const last = messages[messages.length - 1];
          if (!json.thread.hasNewer || !last) break;
          after = last.id;
        }
        source = source ?? first;
        if (!source) {
          toast.error(t("editAsNewEmpty"));
          return;
        }
        await editAsNewFromSource(row.account, subject, source);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("editAsNewFailed")
        );
      }
    },
    [editAsNewFromSource, t]
  );
  const editAsNewMessageRef = React.useRef(editAsNewMessage);
  editAsNewMessageRef.current = editAsNewMessage;

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

  /**
   * A forward asked for from a chat popout.
   *
   * That window has no recipient picker and no subject line, so it asks this
   * one. Open the thread and hand the message to the reader, which does have
   * a composer. Both channels, for the same reason the sent signal uses both.
   */
  const [pendingForward, setPendingForward] =
    React.useState<MailForwardRequest | null>(null);

  React.useEffect(() => {
    const take = (raw: unknown) => {
      const request = readForwardRequest(raw);
      if (!request) return;
      setComposing(false);
      setSelectedPersonKey(null);
      setSelected({
        account: request.account,
        threadId: request.threadId,
        inCrm: false,
      });
      setPendingForward(request);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MAIL_FORWARD_REQUEST_KEY || !event.newValue) return;
      take(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const tauriEvent = (
      window as unknown as {
        __TAURI__?: {
          event?: {
            listen?: (
              name: string,
              handler: (event: { payload: unknown }) => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__?.event;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-forward", (event) => take(event.payload))
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      unlisten?.();
    };
  }, []);

  /**
   * A message written by the planner, to open in the composer.
   *
   * The Facilitators tab writes the joining details for a course and hands
   * them to the shell (see readComposeSeed). Written here as a draft under
   * a fresh key, then the composer is opened on that key, the way a draft
   * continued from the list is. Heard as an event while this is up, and
   * asked for on load in case it was written before this was.
   */
  React.useEffect(() => {
    let cancelled = false;
    const take = async (raw: unknown) => {
      const seed = readComposeSeed(raw);
      if (!seed || cancelled) return;
      const recipient = (email: string) => ({ kind: "email" as const, email });
      const key = newComposeDraftKey();
      const attachments: DraftAttachmentSnapshot[] = seed.attachments.map(
        (file, index) => ({
          id: `${key}-${index}`,
          filename: file.filename,
          mimeType: file.mimeType,
          size: Math.floor((file.contentBase64.length * 3) / 4),
          progress: null,
          contentBase64: file.contentBase64,
        })
      );
      await saveComposeDraft({
        key,
        kind: "compose",
        from: "",
        subject: seed.subject,
        body: seed.bodyHtml,
        toList: seed.to.map(recipient),
        ccList: seed.cc.map(recipient),
        bccList: seed.bcc.map(recipient),
        showCc: seed.cc.length > 0,
        showBcc: seed.bcc.length > 0,
        includeSignature: true,
        attachments,
      });
      if (cancelled) return;
      startCompose({
        to: seed.to,
        subject: seed.subject,
        continuedFromLabel: "",
        draftKey: key,
      });
    };
    const bridge = (
      window as unknown as {
        __TAURI__?: {
          core?: { invoke?: (cmd: string) => Promise<unknown> };
          event?: {
            listen?: (
              name: string,
              handler: (event: { payload: unknown }) => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__;
    if (!bridge) return;
    let unlisten: (() => void) | null = null;
    if (bridge.event?.listen) {
      void bridge.event
        .listen("mail-compose-seed", (event) => void take(event.payload))
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    if (bridge.core?.invoke) {
      void bridge.core
        .invoke("take_mail_compose_seed")
        .then((seed) => (seed ? take(seed) : undefined))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [startCompose]);

  /**
   * Edit as new asked for from a chat popout.
   *
   * Same channels as a forward, but this goes straight to the composer.
   * Opening the thread would copy the newest mail, which is the thing the
   * reader is trying not to do.
   */
  React.useEffect(() => {
    const take = (raw: unknown) => {
      const request = readEditAsNewRequest(raw);
      if (!request) return;
      void editAsNewMessageRef.current(request, request.messageId);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MAIL_EDIT_AS_NEW_REQUEST_KEY || !event.newValue) {
        return;
      }
      take(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    const tauriEvent = (
      window as unknown as {
        __TAURI__?: {
          event?: {
            listen?: (
              name: string,
              handler: (event: { payload: unknown }) => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__?.event;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-edit-as-new", (event) => take(event.payload))
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      unlisten?.();
    };
  }, []);

  // Keep pin snapshots fresh when the inbox refetch returns newer rows.
  React.useEffect(() => {
    if (threads.length) syncMailPinSummaries(threads);
  }, [threads]);

  /**
   * Does this conversation belong to what the list is showing?
   *
   * The same question the list asks of every row — see `visible` above,
   * which this follows. A folder and the views that are places of their
   * own hold whatever they hold; the rest are slices of the inbox, and a
   * slice is what a filter is.
   */
  const inCurrentSlice = React.useCallback(
    (t: MailThreadSummary) => {
      if (MAIL_OFF_TAB_VIEWS.includes(tab) || tab === "all") return true;
      if (activeCustomList) return threadMatchesCustomList(t, activeCustomList);
      return t.tab === tab;
    },
    [activeCustomList, tab]
  );

  /**
   * Pinned conversations stand at the top wherever the list is the inbox.
   *
   * It used to be All and a folder alone, so a reader with In contacts
   * chosen — or one of their own lists — pressed Pin, was told the thread
   * was pinned, and watched nothing happen. The pin was kept; there was
   * simply nowhere on screen for it to show.
   *
   * Only where the pinned thread belongs, though: a filter that quietly
   * held something it excludes is not a filter. Sent, Drafts, Trash, Junk
   * and Snoozed are places rather than slices, and a search answers with
   * what it found and nothing else.
   */
  const showPinnedBand =
    viewMode === "threads" &&
    !debouncedSearch &&
    (activeFolder != null || !MAIL_OFF_TAB_VIEWS.includes(tab));

  const pinnedThreads: MailThreadSummary[] = showPinnedBand
    ? pins
        .flatMap((pin) => {
          const live = threads.find(
            (t) => t.account === pin.account && t.threadId === pin.threadId
          );
          if (live) return [live];
          // Archived pins stay in All; don't leak them into a label folder.
          if (activeFolder) return [];
          return [pin.summary];
        })
        .filter(inCurrentSlice)
        .filter((t) =>
          accountPassesMailboxScope(
            t.account,
            mailboxScopeEmails,
            accountEmails
          )
        )
    : [];

  /**
   * Tokens to narrow by while waiting, and empty once the server has answered.
   *
   * The search is debounced and runs across every mailbox, so it feels stuck
   * if nothing moves until it returns. Narrowing the rows already on screen
   * gives an answer on the first keystroke. As soon as results for this exact
   * query land, `resultsQuery` matches and this empties — the server's answer
   * is then shown whole, including hits it found in message bodies that no
   * local check could see.
   */
  const pendingTokens = React.useMemo(
    () => (search.trim() === resultsQuery ? [] : searchTokens(search)),
    [search, resultsQuery]
  );

  const searchedVisible = pendingTokens.length
    ? visible.filter((t) => matchesTokens(threadHaystack(t), pendingTokens))
    : visible;

  const flowThreads = showPinnedBand
    ? searchedVisible.filter((t) => !pinKeySet.has(threadKey(t)))
    : searchedVisible;

  // Keep successor lookup in sync with what the list actually shows.
  const screenThreadOrder = showPinnedBand
    ? [...pinnedThreads, ...flowThreads]
    : flowThreads;
  screenThreadOrderRef.current = screenThreadOrder;

  // Warm top-of-list bodies so open / post-delete successor paints from cache.
  // Wait until the list is idle so prefetch does not compete with mailbox refresh.
  const prefetchOrderKey = screenThreadOrder
    .slice(0, 15)
    .map((t) => `${threadKey(t)}@${t.lastAt}`)
    .join("|");
  React.useEffect(() => {
    if (loadingList || refreshing) return;
    if (!screenThreadOrderRef.current.length) return;
    return scheduleMailThreadPrefetch(screenThreadOrderRef.current, {
      delayMs: 800,
    });
  }, [listCacheKey, prefetchOrderKey, loadingList, refreshing]);

  // Browse: group by day. Search / snoozed: one flat list (no day buckets).
  const groups: {
    /** The day heading's key, or "" for a flat list with no headings. */
    label: MailStringKey | "";
    items: MailThreadSummary[];
  }[] = [];
  if (debouncedSearch || tab === "snoozed") {
    if (flowThreads.length) groups.push({ label: "", items: flowThreads });
  } else {
    for (const t of flowThreads) {
      const label = dayBucket(t.lastAt);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.items.push(t);
      else groups.push({ label, items: [t] });
    }
  }

  // One row per correspondent for the People view.
  const { connecting, connect } = useMailConnect();
  const syncStates = useMailSyncStates();
  const firstReads = React.useMemo(() => firstReadLines(syncStates), [syncStates]);
  const syncPaused = React.useMemo(() => pausedAfterFirstRead(syncStates), [syncStates]);
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
  const personPins = useMailPersonPins();
  /**
   * By-person list, narrowed by the same waiting rule as the thread list.
   *
   * Grouped from the unnarrowed rows, then matched on the person as well as
   * their mail: someone found by CRM name or by the words in their address
   * must survive even when no thread text carries the query.
   */
  /*
    Who an address belongs to, from the address books — see person-identity.

    Read when the People view is shown, and again when the mailboxes
    change. A host without the contact mirrors (the web planner) answers
    with nothing, and every address stands for itself as before.
  */
  const [personIdentity, setPersonIdentity] =
    React.useState<PersonIdentity | null>(null);
  React.useEffect(() => {
    if (viewMode !== "people") return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await mailStore().contactSources.listVisible(accountEmails);
        if (!cancelled) setPersonIdentity(() => buildPersonIdentity(rows));
      } catch {
        if (!cancelled) setPersonIdentity(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viewMode, accountEmails]);

  const personRows = React.useMemo(() => {
    if (viewMode !== "people") return [];
    const grouped = orderByPersonPin(
      groupThreadsByPerson(visible, personIdentity ?? undefined)
    );
    if (!pendingTokens.length) return grouped;
    return grouped.filter((row) =>
      matchesTokens(
        [
          row.name,
          row.email,
          row.crmName ?? "",
          emailLocalWords(row.email),
          // Every address the person has written from, not only the newest.
          ...row.people.flatMap((p) => [p.email, emailLocalWords(p.email)]),
          ...row.threads.map(threadHaystack),
        ].join(" "),
        pendingTokens
      )
    );
    // pendingTokens is derived from search + resultsQuery each render.
  }, [viewMode, visible, pendingTokens, personIdentity]);
  /**
   * The same day headings the thread list uses.
   *
   * A person row is still mail from a day. Search stays flat, because
   * the hits are not a day. Pinned people stay above the days, so a
   * pin does not land under Earlier.
   */
  const personGroups: {
    label: MailStringKey | "";
    items: PersonRow[];
  }[] = [];
  if (debouncedSearch) {
    if (personRows.length) personGroups.push({ label: "", items: personRows });
  } else {
    const pinnedPeople: PersonRow[] = [];
    const flowPeople: PersonRow[] = [];
    for (const row of personRows) {
      if (isMailPersonPinned(row.key)) pinnedPeople.push(row);
      else flowPeople.push(row);
    }
    if (pinnedPeople.length) {
      personGroups.push({ label: "", items: pinnedPeople });
    }
    for (const row of flowPeople) {
      const label = dayBucket(row.lastAt);
      const last = personGroups[personGroups.length - 1];
      if (last && last.label === label) last.items.push(row);
      else personGroups.push({ label, items: [row] });
    }
  }
  personRowOrderRef.current = personRows;
  // Read so the list re-sorts the moment a pin changes.
  void personPins;
  const draftKeys = useThreadDraftKeys();
  /**
   * The open thread names the person row, on this paint.
   *
   * An effect was a frame late: the last person key still sat in state,
   * so the list marked somebody else while the reader kept the thread.
   * When a thread is open, the row that holds it is the selected person.
   */
  const personKeyFromOpenThread =
    viewMode === "people" && selected
      ? (personRows.find((r) =>
          r.threads.some((t) => rowStandsFor(t, selected))
        )?.key ?? null)
      : null;
  const paintedPersonKey = personKeyFromOpenThread ?? selectedPersonKey;
  const selectedPerson = paintedPersonKey
    ? (personRows.find((r) => r.key === paintedPersonKey) ?? null)
    : null;
  React.useLayoutEffect(() => {
    if (!personKeyFromOpenThread) return;
    if (personKeyFromOpenThread === selectedPersonKey) return;
    setSelectedPersonKey(personKeyFromOpenThread);
  }, [personKeyFromOpenThread, selectedPersonKey]);

  /**
   * The person who was open has no mail left: open the next one.
   *
   * Archiving or deleting a whole person moves the selection on itself, and
   * always has. Doing it a thread at a time did not: the last conversation
   * with somebody leaves their row with nothing in it, the row goes, and the
   * key in hand names nobody — so the pane empties and the reader is left
   * looking at nothing, mid-pass, with no way to tell whether the last act
   * worked.
   *
   * Here rather than in each action, because every one of them ends the same
   * way — archived, deleted, filed in a folder, marked as junk, or moved by
   * a rule while the reader watched. What matters is that the row went, not
   * which verb sent it.
   */
  const paintedPeopleRef = React.useRef<PersonRow[]>([]);
  React.useEffect(() => {
    const painted = paintedPeopleRef.current;
    paintedPeopleRef.current = personRows;
    if (viewMode !== "people" || !selectedPersonKey) return;
    if (personRows.some((r) => r.key === selectedPersonKey)) return;
    const successor = successorAfterRemoving(
      painted,
      (r) => r.key === selectedPersonKey
    );
    // The painted row names who is next; the live row says what they still
    // have, which is what decides whether a thread opens.
    landOnPerson(
      successor
        ? (personRows.find((r) => r.key === successor.key) ?? successor)
        : null
    );
  }, [viewMode, personRows, selectedPersonKey, landOnPerson]);

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

  const openPerson = React.useCallback(
    (row: PersonRow) => {
      setComposing(false);
      setListExpanded(false);
      landOnPerson(row);
    },
    [landOnPerson]
  );

  /**
   * Two clicks on a person: their mail in a window of its own — the pane
   * this view shows for them, or the one conversation when that is all
   * there is, the way a double-clicked thread opens. The first click has
   * opened them here; the row itself travels with the window, since the
   * window has no list to work them out from. See openMailPersonWindow.
   */
  const openPersonWindow = (row: PersonRow) => {
    clearMultiSelection();
    openPerson(row);
    void openMailPersonWindow(row).catch((err: unknown) => {
      console.error("person window:", err);
      toast.error(
        typeof err === "string" && err
          ? err
          : err instanceof Error
            ? err.message
            : "Couldn't open it"
      );
    });
  };

  /**
   * Two clicks on a thread row: read it in a window of its own.
   *
   * The whole reader — header, actions, reply box — under the system's own
   * title bar, the way Outlook opens a message. It used to put the list
   * away instead, which the expand button on the reader still does. The
   * first click has already opened the thread here; what travels with the
   * window is what the list knows and the window cannot learn — the copies
   * the row stands for, so an archive over there takes what an archive
   * here would, and the snooze for its button.
   */
  const expandThreadRow = React.useCallback(
    (t: MailThreadSummary) => {
      clearMultiSelection();
      openThread(t);
      void openMailThreadWindow({
        account: t.account,
        threadId: t.threadId,
        name: t.fromName,
        email: t.fromEmail,
        subject: t.subject,
        handoff: {
          copies: everyCopy(t, threads),
          snoozedUntil: t.snoozedUntil,
          // Not the row's unread: the first click marked it read.
        },
      }).catch((err: unknown) => {
        // The desktop shell rejects with a plain string — the ACL's own
        // words, or the window builder's — and that string is the one thing
        // worth reading when the window does not come. Show it as it is.
        console.error("reader window:", err);
        toast.error(
          typeof err === "string" && err
            ? err
            : err instanceof Error
              ? err.message
              : "Couldn't open it"
        );
      });
    },
    [clearMultiSelection, openThread, threads]
  );

  /** A click on a thread row, with whatever keys were held. */
  const clickThreadRow = React.useCallback(
    (t: MailThreadSummary, event?: React.MouseEvent) => {
      // The anchor is the row that stands for the open thread — its own
      // key when the row is standing on its other copy would anchor the
      // range to a row the list does not hold.
      const anchorRow = selected
        ? screenThreadOrderRef.current.find((row) =>
            rowStandsFor(row, selected)
          )
        : null;
      const anchorKey = anchorRow
        ? threadKey(anchorRow)
        : selected
          ? threadKey(selected)
          : null;
      const handled = selectRowWithModifier(
        event,
        threadKey(t),
        anchorKey,
        () => screenThreadOrderRef.current.map((row) => threadKey(row))
      );
      if (handled) return;
      clearMultiSelection();
      openThread(t);
    },
    [selected, selectRowWithModifier, clearMultiSelection, openThread]
  );

  /** A click on a person row, with whatever keys were held. */
  const clickPersonRow = React.useCallback(
    (row: PersonRow, event?: React.MouseEvent) => {
      const handled = selectRowWithModifier(
        event,
        row.key,
        selectedPersonKey,
        () => personRowOrderRef.current.map((r) => r.key)
      );
      if (handled) return;
      clearMultiSelection();
      openPerson(row);
    },
    [selectedPersonKey, selectRowWithModifier, clearMultiSelection, openPerson]
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

  const foldersMenu = (iconOnly: boolean) => (
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

  const folderRail = (
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
  const foldersButton = (
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

  /**
   * Is the mailbox row on screen to hold it?
   *
   * One mailbox needs no row to choose between mailboxes, and a folder
   * view has no row either — it is one mailbox's folder by definition.
   */
  const accountTabsShowing = accountEmails.length > 1 && !activeFolder;

  const filterButton = (
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

  /** The filter chips: the built-in lists, the reader's own, and New list. */
  const filterChips = (
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

  const filterRow =
    listChromeOnToolbar && !filtersShowing ? null : (
    <div className="mt-2 flex items-center gap-2">
      {accountTabsShowing || listChromeOnToolbar ? null : foldersButton}
      {listChromeOnToolbar ? null : filterButton}

      {filtersShowing ? filterChips : null}
    </div>
  );

  /** The mailbox row: All, then one tab per mailbox. */
  const accountTabs = (
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

  const listTabsOrFolder = activeFolder ? (
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
  );

  /** Display & accounts, with Settings, shortcuts and contact sources in it. */
  const layoutMenu = (
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
            onSetUpAutoReply={(account) => {
              setAutoReplyAccount(account);
              setAutoReplyOpen(true);
            }}
            onEndAutoReply={(account) => void endAutoReply(account)}
            ownIdentity={ownIdentity}
            onOwnIdentityChange={onOwnIdentityChange}
          />
  );

  /** The rows, with the banners over them and the load-more under them. */
  const threadListColumn = (
        <div
          ref={threadListRef}
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
            // Pane under the rows so they sit on white, not cream.
            listRowsOnPane && "bg-[var(--mail-pane)]"
          )}
        >
          {listVertical && !listNarrow && !phone ? (
            <div className="shrink-0 px-5 pt-3">{listTabsOrFolder}</div>
          ) : null}

        <div className="relative min-h-0 flex-1">
        <div
          ref={listScrollRef}
          className={cn(
            "h-full min-h-0 overflow-y-auto overscroll-none",
            listExpanded ? "pb-4" : "pb-6"
          )}
        >
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
                      <ListNotice kind="offline" title={t("syncOffline", { account: s.account })}>
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
              onCancel={() => setPurgeAsk(null)}
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
          {draftsView ? (
            <MailDraftsList
              rows={
                draftsAccount
                  ? drafts.filter(
                      (row) =>
                        row.account.toLowerCase() ===
                        draftsAccount.toLowerCase()
                    )
                  : drafts
              }
              loading={draftsLoading}
              /*
                Discard every copy that went to Outlook.

                Asked for rather than done: this app cannot know a handed-over
                message was ever sent, so it never throws one away on its own
                — but the reader knows, and one press is the right price for
                a morning's worth of them.
              */
              onClearHandedOver={() => {
                void (async () => {
                  const keys = await listHandedOverDraftKeys();
                  await Promise.all(keys.map((key) => deleteDraft(key)));
                  refreshDrafts();
                  toast.success(
                    keys.length === 1
                      ? "Discarded 1 copy"
                      : `Discarded ${keys.length} copies`
                  );
                })();
              }}
              // Which one is open: the draft the composer is on, or the
              // thread a reply draft belongs to.
              openKey={
                composing
                  ? (composeSeed?.draftKey ?? null)
                  : (selected?.threadId ?? null)
              }
              onOpen={(row) => {
                // A reply opens its thread, where the composer picks the
                // draft up — ours from IndexedDB, the provider's from the
                // thread itself. A new message has no thread worth reading,
                // so it opens straight into a composer on its own key.
                if (row.threadId && !isStandaloneDraft(row)) {
                  setSelectedPersonKey(null);
                  setSelected({
                    account: row.account,
                    threadId: row.threadId,
                    inCrm: false,
                  });
                  return;
                }
                if (row.origin === "here") {
                  startCompose({
                    to: row.to,
                    subject: row.subject,
                    continuedFromLabel: "",
                    draftKey: row.id,
                  });
                  return;
                }
                // A provider draft that is not a reply still belongs to a
                // thread of its own; opening it shows an empty thread with
                // the draft in the composer.
                if (row.threadId) {
                  setSelectedPersonKey(null);
                  setSelected({
                    account: row.account,
                    threadId: row.threadId,
                    inCrm: false,
                  });
                }
              }}
            />
          ) : loadingList &&
          accountEmails.length > 0 &&
          !threads.length &&
          !pinnedThreads.length ? (
            <MailListLoading
              provider={mailProviderNames}
              onNavy={chromeDark}
              narrow={listNarrow}
            />
          ) : listError && !threads.length && !pinnedThreads.length ? (
            <p
              className={cn(
                "py-6 text-sm text-red-300",
                listNarrow ? "px-1 text-center text-[10px] leading-tight" : "px-5"
              )}
              title={listError}
            >
              {listNarrow ? "Error" : listError}
            </p>
          ) : !accountEmails.length ? (
            listNarrow ? (
              <p
                className="px-1 py-6 text-center text-[10px] leading-tight text-[var(--mail-chrome-muted)]"
                title={t("connectFromSettings")}
              >
                {t("connect")}
              </p>
            ) : (
            <div className="px-5 py-8">
              <p className="text-sm font-medium text-[var(--mail-chrome-fg)]">
                {t("connectToStart")}
              </p>
              <p className="mt-1 text-sm text-[var(--mail-chrome-muted)]">
                {t("connectIntro")}
              </p>
              {/* Only where it happens — see MailAccountsPanel. */}
              {isWindowsHost() ? null : (
                <p className="mt-1 text-sm text-[var(--mail-chrome-muted)]">
                  {t("connectKeychainHint")}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button asChild size="sm" className="gap-1.5">
                  <a
                    href={gmailOauthHref()}
                    onClick={(event) => {
                      // The href is the fallback for a page whose script never
                      // ran. When it did, the host decides what connect means.
                      event.preventDefault();
                      connect("gmail");
                    }}
                  >
                    {connecting === "gmail" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("openingProvider", { provider: "Gmail" })}
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        {t("connectProvider", { provider: "Gmail" })}
                      </>
                    )}
                  </a>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-[var(--mail-chrome-chip-border)] bg-transparent text-[var(--mail-chrome-fg)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
                >
                  <a
                    href={outlookOauthHref()}
                    onClick={(event) => {
                      // The href is the fallback for a page whose script never
                      // ran. When it did, the host decides what connect means.
                      event.preventDefault();
                      connect("outlook");
                    }}
                  >
                    {connecting === "outlook" ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t("openingProvider", { provider: "Outlook" })}
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        {t("connectProvider", { provider: "Outlook" })}
                      </>
                    )}
                  </a>
                </Button>
              </div>
            </div>
            )
          ) : !searchedVisible.length && !pinnedThreads.length ? (
            <p
              className={cn(
                "py-6 text-sm text-[var(--mail-chrome-muted)]",
                listNarrow ? "px-1 text-center text-[10px] leading-tight" : "px-5"
              )}
              title={
                searchEmptyText
                  ? searchEmptyText
                  : activeFolder
                    ? `No mail in ${activeFolder.name}.`
                    : undefined
              }
            >
              {listNarrow
                ? "Empty"
                : searchEmptyText
                  ? searchEmptyText
                  : activeFolder
                    ? // The breadcrumb above names the folder, so naming it
                      // again here is the same sentence twice — and it was
                      // the long form, the whole path, under a header that
                      // had just spelt it out one part at a time.
                      "No mail in here."
                    : activeCustomList
                      ? `No mail from people in “${activeCustomList.name}”.`
                      : tab === "people"
                        ? mailUsesCrmPeople()
                          ? "No mail from CRM contacts right now."
                          : "No mail from your contacts right now."
                        : tab === "sent"
                          ? "No sent mail found."
                          : tab === "trash"
                            ? "Nothing in Trash."
                            : tab === "junk"
                              ? "Nothing in Junk."
                              : tab === "snoozed"
                            ? "Nothing snoozed — enjoy the quiet."
                            : tab === "all"
                              ? "Inbox zero — enjoy the quiet."
                              : "Nothing else — enjoy the quiet."}
            </p>
          ) : viewMode === "people" && tab !== "snoozed" && tab !== "sent" ? (
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
                  onOpenChange={(open) => {
                    if (open) {
                      personSnoozeShown.current = true;
                      return;
                    }
                    if (!personSnoozeShown.current) return;
                    personSnoozeShown.current = false;
                    setPersonSnooze(null);
                  }}
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
          ) : (
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
          )}
          {/* Results in hand, and more of them behind the button below. A
              search that has answered still looks finished, so say it is not. */}
          {debouncedSearch && listCursor && !loadingList && !listNarrow ? (
            <p className="px-5 pt-3 text-[11px] leading-snug text-[var(--mail-chrome-faint)]">
              {t("firstMatches")}
            </p>
          ) : null}
          {/* Results from a copy still filling. They are real, and they
              are from the part in hand; say so, or the reader takes a
              miss in the older part for a miss. */}
          {debouncedSearch && readSoFar && !loadingList && !listNarrow && searchedVisible.length ? (
            <p className="px-5 pt-3 text-[11px] leading-snug text-[var(--mail-chrome-faint)]">
              {t("searchedSoFar", { count: readSoFar.toLocaleString() })}
            </p>
          ) : null}
          {listCursor && !loadingList ? (
            <div
              className={cn("pb-2 pt-3", listNarrow ? "px-1" : "px-5")}
            >
              <button
                type="button"
                disabled={loadingMore}
                title={t("loadMore")}
                aria-label={loadingMore ? t("loadingMore") : t("loadMore")}
                onClick={() => void loadMoreThreads()}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-md py-2 text-xs font-medium text-[var(--mail-chrome-muted)] transition-colors hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)] disabled:opacity-60",
                  listNarrow && "px-0"
                )}
              >
                {loadingMore ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : listNarrow ? (
                  <Plus className="h-3.5 w-3.5" />
                ) : null}
                {listNarrow ? null : loadingMore ? t("loading") : t("loadMore")}
              </button>
            </div>
          ) : null}
        </div>
        {/* Soft fade so rows ease into the list surface at the edge. */}
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t to-transparent",
            listRowsOnPane
              ? "from-[var(--mail-pane)]"
              : "from-[var(--mail-fade-from)]"
          )}
        />
        </div>
        </div>
  );

  /** What the reading pane holds: a composer, a thread, a person, or the rest picture. */
  const readingPaneContent = composing ? (
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
              /*
                In the Drafts view the draft was the reason this pane was
                open. Once it is gone the pane held either an empty
                conversation — a provider draft has no messages behind it
                — or a thread the reader never asked to read.
              */
              onDraftDiscarded={
                draftsView
                  ? () => {
                      setSelected(null);
                      refreshDrafts();
                    }
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
                // A pin is kept by the list row's summary. A thread opened
                // from a search hit or a deep link has no row here, so
                // there is nothing to pin it as; say so rather than nothing.
                if (selectedRow) togglePin(selectedRow);
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
              onForwardStarted={() => setPendingForward(null)}
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
        );

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

  /* Update CRM, for whichever pane asked. Here and not in the pane: the pane
     is made again for every thread, and the dialog stays until the reader
     presses Skip or Apply. */
  const crmProposalHost = (
    <CrmProposalHost
      onCrmChanged={markThreadInCrm}
      onArchive={(origin) => void archive(origin)}
    />
  );

  const autoReplyDialog = (
      <AutoReplyDialog
        open={autoReplyOpen}
        initialAccount={autoReplyAccount}
        onClose={() => setAutoReplyOpen(false)}
        onSaved={storeAutoReply}
      />
  );
  const contactDialogs = (
    <>
      <ContactSourcesDialogHost />
      <MacContactsAskCard
        trigger={macAskTrigger}
        onGranted={() =>
          window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT))
        }
      />
    </>
  );

  if (phone) {
    // Which list this is, for the top row with one mailbox and for the
    // way back over an open thread.
    const phoneHeading =
      activeFolder?.name ??
      activeCustomList?.name ??
      (tab === "all"
        ? t("phoneInbox")
        : (mailBuiltinTabLabels(t)[tab] ?? t("phoneInbox")));
    const phoneDetail: MailPhoneDetail | null = composing
      ? { kind: "compose", node: readingPaneContent }
      : multiSelectedCount
        ? { kind: "selection", node: readingPaneContent }
        : selected
          ? { kind: "thread", node: readingPaneContent }
          : viewMode === "people" && selectedPerson
            ? { kind: "person", node: readingPaneContent }
            : null;
    return (
      <MailPhoneShell
        surfaceRef={mailSurfaceRef}
        colorMode={colorMode}
        heading={phoneHeading}
        accountTabs={accountTabsShowing ? accountTabs : null}
        filterChips={filterChips}
        filterOn={filterIsOn}
        folder={activeFolder ? { name: activeFolder.name } : null}
        onLeaveFolder={() => setActiveFolder(null)}
        searchInputRef={searchInputRef}
        searchPlaceholder={mailSearchPlaceholder({
          folderName: activeFolder?.name ?? null,
          customListName: activeCustomList?.name ?? null,
          tab,
          t,
        })}
        onSearchChange={setSearch}
        liveMenu={
          <MailPauseMenu
            state={pauseState}
            now={pauseNow}
            accounts={accountEmails}
            labels={accountLabels}
            isOutlookAccount={isOutlookAccount}
            onPause={pauseMailUntil}
            onResume={resumeMail}
            onQuietHoursChange={setMailQuietHours}
            onFollowAllHours={setFollowAllHours}
            trigger={
              <button
                type="button"
                title={pauseChip.paused ? pausedLabel : t("mailAwakeTitle")}
                aria-label={pauseChip.paused ? pausedLabel : t("mailAwake")}
                className={cn(
                  "mail-phone-live flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                  pauseChip.paused ? "text-indigo-600" : "text-teal-700"
                )}
              >
                {pauseChip.paused ? (
                  <Moon className="h-4 w-4" aria-hidden />
                ) : (
                  <Radio className="h-4 w-4" aria-hidden />
                )}
              </button>
            }
          />
        }
        list={threadListColumn}
        folderRail={folderRail}
        folderKey={`${activeFolder?.account ?? ""}|${activeFolder?.name ?? ""}|${railSystemView}`}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        settingsMenu={layoutMenu}
        onCompose={() => startCompose()}
        detail={phoneDetail}
        onBack={() => {
          // Down from the composer keeps the words: the draft is written
          // as the composer leaves, and the bar over the footer brings it
          // back. Back from anything else is one step towards the list.
          if (composing) {
            setPhoneDockedDraft({ seed: composeSeed });
            closeCompose();
            return;
          }
          if (multiSelectedCount) {
            clearMultiSelection();
            return;
          }
          if (selected) {
            setSelected(null);
            return;
          }
          setSelectedPersonKey(null);
        }}
        dockedDraft={
          phoneDockedDraft
            ? {
                label: `${t("draft")} · ${
                  phoneDockedDraft.seed?.subject || t("newEmail")
                }`,
                onResume: () => startCompose(phoneDockedDraft.seed ?? undefined),
                onHide: () => setPhoneDockedDraft(null),
              }
            : null
        }
      >
        {autoReplyDialog}
        {crmProposalHost}
        {contactDialogs}
      </MailPhoneShell>
    );
  }

  return (
    <div
      ref={mailSurfaceRef}
      // The window's height in the app's own pixels — see use-ui-scale.
      // `h-dvh` is not scaled by zoom, so at any size but 100% it was
      // taller than the window it sat in.
      className="mail-shell flex h-[var(--mail-viewport-h,100dvh)] min-h-0 flex-1 flex-col overflow-hidden bg-[var(--mail-chrome)]"
      data-theme={colorMode}
      style={
        {
          "--mail-list-controls-left": `${listControlsLeft}px`,
          // How long anything following that column takes to catch up
          // with it — see railSlideDuration in use-mail-pane-geometry.
          "--mail-rail-slide": railSlideDuration,
        } as React.CSSProperties
      }
    >
      {/* Overlay title bar — same height as the Mac traffic-light strip
          (matches .dh-titlebar / NativeTitleDragStrip h-11). Search sits in
          this row like Outlook, not in a second toolbar underneath.
          `deep` makes empty chrome draggable; inputs stay interactive. */}
      <div
        data-tauri-drag-region="deep"
        className="mail-titlebar mail-chrome-strip relative flex h-11 shrink-0 items-center gap-3 border-b bg-[var(--mail-chrome)] transition-[padding-left] ease-out motion-reduce:transition-none"
        style={{
          borderColor: "var(--mail-chrome-border)",
          // Where the row stops. A shell that puts window buttons at the
          // right of the strip (the standalone app on Windows) sets this.
          paddingRight: "var(--mail-titlebar-right, 12px)",
          // Where the controls start — see `titlebarLeft`.
          paddingLeft: titlebarLeft,
          // At the speed of the rail, so the row follows the folders rather
          // than jumping while they are still sliding.
          transitionDuration: "var(--mail-rail-slide)",
        }}
      >
        {/* Density, settings and thread/person, then search takes the
            rest — the whole row standing over the list column, at New
            email's own left edge. A shell can put the search first instead
            — see the standalone app's Windows window in
            apps/mail/src/standalone.css. */}
        <div className="mail-titlebar-controls -ml-[4px] flex min-w-0 max-w-3xl flex-1 items-center gap-2">
          <ListDensityToggle
            density={listDensity}
            onChange={setListDensity}
            onNavy={chromeDark}
          />
          {layoutMenu}
          <MailViewModeTabs
            viewMode={viewMode}
            onChange={setViewMode}
            onNavy={chromeDark}
          />
          <label
            className={cn(
              "mail-titlebar-search",
              // h-7 (~28px) centers with traffic lights in the 44px strip.
              // Its own colours, not stone: on the dark theme the blanket
              // rewrite made this the same shade as the bar it sits in, so
              // the box a reader types into had no edges.
              "relative flex h-7 min-w-0 flex-1 items-center rounded-full border border-[var(--mail-field-border-soft)] bg-[var(--mail-field-bg)] shadow-sm",
              "focus-within:ring-2 focus-within:ring-[var(--mail-title-search-ring)]"
            )}
          >
            {/* Which mailboxes to search is which mailbox the tabs are
                showing, so no menu for that here any more. What is left is
                the one thing that is about the searching rather than about
                the list: whether deleted mail answers. */}
            <SearchOptionsMenu
              includeDeleted={searchDeleted}
              onIncludeDeletedChange={setSearchDeleted}
            />
            <Search
              className="pointer-events-none h-3.5 w-3.5 shrink-0 text-stone-400"
              aria-hidden
            />
            <input
              ref={searchInputRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // A search is names and half-words; macOS offered to
              // capitalise and respell them in a bubble under the box.
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              // An empty box with the cursor in it shows the words it
              // reads — from:, has:attachment, "a phrase" — in place of
              // its name. Gone with the first letter typed.
              placeholder={
                searchFocused && !search
                  ? t("searchHint")
                  : mailSearchPlaceholder({
                      folderName: activeFolder?.name ?? null,
                      customListName: activeCustomList?.name ?? null,
                      tab,
                      t,
                    })
              }
              className="h-full min-w-0 flex-1 border-0 bg-transparent py-1 pl-2 pr-8 text-[13px] text-[var(--mail-chrome-fg)] outline-none placeholder:text-[var(--mail-placeholder)] shadow-none [&::-webkit-search-cancel-button]:hidden"
            />
            {search ? (
              <button
                type="button"
                title={t("clearSearch")}
                aria-label={t("clearSearch")}
                className="absolute right-1.5 flex h-5 w-5 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                onPointerDown={beginNativeWindowDragOnMove}
                onClick={() => setSearch("")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>
          {/* Beside the search field, because it is about this mailbox as a
              whole rather than about any list in it — and because a mailbox
              that has stopped fetching has to say so where the eye already
              goes. */}
          <MailPauseMenu
            state={pauseState}
            now={pauseNow}
            accounts={accountEmails}
            labels={accountLabels}
            isOutlookAccount={isOutlookAccount}
            onPause={pauseMailUntil}
            onResume={resumeMail}
            onQuietHoursChange={setMailQuietHours}
            onFollowAllHours={setFollowAllHours}
            trigger={
              <button
                type="button"
                title={pauseChip.paused ? pausedLabel : t("mailAwakeTitle")}
                className={cn(
                  // h-7, the search field's height: the two stand side by
                  // side at the end of the row, and a pill shorter than the
                  // box beside it reads as a label on the box.
                  "flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium",
                  pauseChip.paused
                    ? // Paused draws itself, because that is the state
                      // worth seeing from across the room.
                      "border border-indigo-200 bg-indigo-50 text-indigo-800"
                    : cn(
                        // Awake does not: nothing is wrong, and a bordered
                        // pill beside the search box asks to be read as
                        // often as the box itself. It comes up under the
                        // pointer, like the other quiet controls in the row.
                        "text-[var(--mail-chrome-muted)]",
                        chromeDark
                          ? "hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
                          : "hover:bg-stone-200/70 hover:text-stone-800"
                      )
                )}
              >
                {pauseChip.paused ? (
                  <Moon className="h-3 w-3" aria-hidden />
                ) : (
                  <Radio className="h-3 w-3" aria-hidden />
                )}
                {pauseChip.paused ? pausedLabel : t("mailAwake")}
              </button>
            }
          />
        </div>
      </div>

      {/* The rail stands outside the pane row rather than inside it: the
          pane may be laid out top-to-bottom (list over reader), and the
          folders run down the side of both however that is set. */}
      <div
        ref={paneRowRef}
        // `relative`: the sliding columns stand absolute against this row,
        // and its overflow-hidden is what cuts them off at the window's
        // edge as they travel.
        className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
      >
      {/* The folders travel with the list: they are its heading, so they
          leave with it rather than blinking out from beside a list that is
          still going. Mounted for as long as the list is, and closing to
          the same width of nothing on the way. */}
      {listMounted ? (
        <div
          style={{
            order: railOnRight ? 3 : 1,
            /*
              Two lives. At rest, a box in the flow whose width the rail's
              own 200ms toggle still animates — that toggle moves one thin
              strip and one title bar, and is cheap enough to stay as it
              was. While the list slides, absolute over the pane row at
              full width, travelling by transform with the list — see the
              note over `listSlideOverlay`.
            */
            ...(listSlideOverlay
              ? {
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  ...(railOnRight ? { right: 0 } : { left: 0 }),
                  width: railInset,
                  zIndex: 10,
                  transform: railSlideTransform,
                  willChange: "transform",
                  transitionDuration: `${LIST_SLIDE_MS}ms`,
                  transitionTimingFunction: LIST_SLIDE_EASE,
                }
              : { width: railShowing ? shownRailWidth : 0 }),
          }}
          className={cn(
            "relative shrink-0 overflow-hidden",
            // Closed and finished closing: out of the tab order, rather
            // than a strip of nothing that can still be tabbed into.
            railHidden && "invisible",
            // Not while it is being dragged. The rail's own toggle and the
            // drag animate the same property, so a rail being resized
            // would trail the pointer by the length of the opening.
            //
            // Transform while the list is moving; its own width toggle
            // when the reader is only asking for the folders. Both stay
            // classes so `motion-reduce` turns the whole thing off.
            !railResizing &&
              (listSlideOverlay
                ? "transition-transform motion-reduce:transition-none"
                : "transition-[width] duration-200 ease-out motion-reduce:transition-none")
          )}
        >
          {/*
            Its own width, held against the right edge of the box whose
            width is changing.

            Its own width, because a rail laid out again at every width on
            the way would re-wrap every folder name sixty times per slide.
            Held to the right, because that is what makes it a slide: the
            box's right edge is where the thread list starts, so the rail
            travels left with it and is cut off against the pane's own left
            edge, the way a drawer goes back into a cabinet.

            One property moving, and not two. This used to also translate
            the rail left as the box narrowed, so the content left the
            screen at twice the rate the gap closed — gone halfway through,
            with an empty gap still shutting after it. That is what made
            hiding feel abrupt when showing did not.

            Held to the other edge when the rail is on the right, for the
            same reason: the cabinet is on that side now, so the drawer has
            to go back into it that way.
          */}
          <div
            className={cn(
              "absolute inset-y-0",
              railOnRight ? "left-0" : "right-0"
            )}
            style={{ width: shownRailWidth }}
          >
            {folderRail}
          </div>
        </div>
      ) : null}
      {/* Between the rail and the pane, like the one between the list and
          the reader. Only while the rail is all the way out and standing
          in the flow: half way through a slide there is no edge to take
          hold of, and a grab strip left behind by a rail that is out of
          the flow would stand over nothing. */}
      {railShowing && !hideList && listMounted && !listSliding ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("resizeFolders")}
          aria-valuenow={Math.round(railWidth)}
          aria-valuemin={FOLDER_RAIL_MIN_WIDTH}
          aria-valuemax={FOLDER_RAIL_MAX_WIDTH}
          title={t("dragToResizeFolders")}
          // On the right, the rail grows as the pointer goes left.
          onPointerDown={(e) => startRailResize(e, { invertDrag: railOnRight })}
          /*
            It takes hold of the seam without taking any of it.

            Four pixels of column between the rail and the list is four
            pixels the list cannot paint, and the bar down the side of the
            open thread stopped short of the rail because of it. The strip
            lies over the list's first four pixels instead — negative margin
            to give the width back, `relative` so it stays above the list and
            keeps the drag, and transparent so what it lies over shows
            through.
          */
          className={cn(
            "relative z-10 w-1 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-[var(--mail-chrome-border)] active:bg-[var(--mail-chrome-border)]",
            railOnRight ? "-ml-1" : "-mr-1"
          )}
          style={{ order: 2 }}
        />
      ) : null}
      <div
        className={cn(
          /*
            What shows through the transparent resize gutter, so it has to
            be what is on both sides of it — the chrome, which is what the
            list is painted in and what the reader's own frame is.
            
            It has been wrong twice in the same way: white while the reader
            was white, then the reading surface once that stepped away from
            the chrome, which on the dark theme is lighter than either
            neighbour and read as a lit strip down the join. The list's own
            border-r is what separates the two; this is only the colour
            behind a 4px gap.
          */
          // `relative`: the sliding list anchors to this box — the same
          // geometry as the pane row while a slide runs, since the rail is
          // out of the flow then, and the right frame for the expand sweep,
          // which covers the pane but never the rail.
          "relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--mail-thread-chrome)]",
          listVertical ? "flex-col" : "flex-row"
        )}
        // Before the rail when the rail is on the right; after it otherwise.
        style={{ order: railOnRight ? 1 : 3 }}
      >
      {/* ------------------------------------------------ thread list */}
      {listMounted ? (
      /*
        The box the list stands in, and the thing that slides.

        At rest it holds the list's place in the flow at the width the
        reader dragged. While a slide runs it steps out of the flow —
        absolute against the pane row, at that same size and place — and
        travels by transform toward the edge the list lives against,
        where the pane row's own overflow cuts it off: a drawer going
        back into a cabinet. The reader behind it is laid out once, at
        its final width, under cover of the column — see the note over
        the three slide states.

        The inner element keeps the list at its own fixed size, pinned to
        the reader's edge, so the rows are never re-wrapped by anything
        the box does — that matters to the rail's 200ms toggle and to the
        squeeze a composer asks for, which still move the box's width.
      */
      <div
        className={cn(
          "relative overflow-hidden",
          listExpanded && listOpen ? "min-h-0 min-w-0 flex-1" : "shrink-0",
          listSlideOverlay &&
            "transition-transform motion-reduce:transition-none",
          listExpandSliding &&
            "transition-[clip-path] motion-reduce:transition-none"
        )}
        style={{
          order: listFirst ? 1 : 3,
          /*
            The expand sweep — see the note over `listGrown`. Absolute over
            the pane at full size, laid out once in its expanded shape, and
            a clip edge travels between the list's resting strip and the
            whole of the pane.
          */
          ...(listExpandSliding
            ? {
                position: "absolute",
                inset: 0,
                zIndex: 10,
                clipPath: expandClip,
                willChange: "clip-path",
                transitionDuration: `${LIST_SLIDE_MS}ms`,
                transitionTimingFunction: LIST_SLIDE_EASE,
              }
            : listSlideOverlay
            ? {
                position: "absolute",
                zIndex: 10,
                transform: listSlideTransform,
                willChange: "transform",
                transitionDuration: `${LIST_SLIDE_MS}ms`,
                transitionTimingFunction: LIST_SLIDE_EASE,
                // Its resting place, measured from the pane row: clear of
                // the rail on the side the rail holds, so the two travel
                // as neighbours rather than one over the other.
                ...(listVertical
                  ? {
                      left: railInset,
                      right: 0,
                      height: listHeight,
                      ...(listFirst ? { top: 0 } : { bottom: 0 }),
                    }
                  : {
                      top: 0,
                      bottom: 0,
                      width: shownListWidth,
                      ...(listFirst
                        ? { left: railInset }
                        : { right: railInset }),
                    }),
              }
            : listExpanded && listOpen
              ? undefined
              : listVertical
                ? { height: listOpen ? listHeight : 0 }
                : { width: listOpen ? shownListWidth : 0 }),
        }}
      >
      <div
        className={cn(
          // Explicit border colour + side (listBorderClass) so the divider
          // between list and reader stays visible against cream chrome.
          "flex overflow-hidden border-[var(--mail-chrome-border)]",
          // Pane behind the rows when they are the reading surface —
          // stacked above/below, or expanded — so chrome cannot bleed
          // into the table.
          listRowsOnPane ? "bg-[var(--mail-pane)]" : "bg-[var(--mail-chrome)]",
          listBorderClass,
          // Top/bottom: controls | thread list side-by-side.
          listSplit ? "min-h-0 w-full flex-row" : "min-w-0 flex-col"
        )}
        style={{
          // Expanded shape during the sweep as well: the clip above is what
          // meters how much of it shows.
          ...(listExpandSliding || (listExpanded && listOpen)
            ? { position: "absolute", inset: 0 }
            : listVertical
              ? {
                  position: "absolute",
                  left: 0,
                  right: 0,
                  height: listHeight,
                  ...(listFirst ? { bottom: 0 } : { top: 0 }),
                }
              : {
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  width: shownListWidth,
                  ...(listFirst ? { right: 0 } : { left: 0 }),
                }),
          opacity: listNearSnap ? 0.45 : 1,
          transition: listNearSnap ? undefined : "opacity 120ms ease",
        }}
      >
        {listNarrow ? (
          <div className="flex shrink-0 flex-col items-center gap-0.5 border-b border-[var(--mail-chrome-border)] px-1 py-2">
            <button
              type="button"
              title={t("newEmail")}
              aria-label={t("newEmail")}
              className={chromeIconBtn}
              onClick={() => startCompose()}
            >
              <SquarePen className="h-4 w-4" />
            </button>
            <div
              className="my-1 h-px w-6 bg-[var(--mail-chrome-border)]"
              aria-hidden
            />
            <button
              type="button"
              title={noneFetching ? pausedLabel : t("syncInbox")}
              aria-label={noneFetching ? t("mailResume") : t("syncInbox")}
              className={cn(chromeIconBtn, noneFetching && "text-indigo-500")}
              onClick={noneFetching ? resumeFetching : syncNow}
            >
              {noneFetching ? (
                <Moon className="h-4 w-4" />
              ) : (
                <SyncIcon className="h-4 w-4" spinning={refreshing || syncTurn} />
              )}
            </button>
            {foldersMenu(true)}
            {activeFolder ? (
              <button
                type="button"
                title={`Back to inbox (from ${activeFolder.name})`}
                aria-label={`Back to inbox from ${activeFolder.name}`}
                className={chromeIconBtn}
                onClick={() => setActiveFolder(null)}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : (
        <div
          className={cn(
            // Always a column flex so the New email control is a flex item
            // (avoids a ~3px inline-flex whitespace offset in block layout).
            "mail-chrome-strip flex flex-col px-5",
            listSplit
              ? "shrink-0 overflow-y-auto border-r border-[var(--mail-chrome-border)] bg-[var(--mail-chrome)] pb-3 pt-2"
              : cn(
                  "bg-[var(--mail-chrome)] pb-1 pt-2",
                  listChromeOnToolbar &&
                    "border-b border-[var(--mail-chrome-border)] pb-1"
                )
          )}
          style={listSplit ? { width: controlsWidth } : undefined}
          /* The whole head of the list, not the first row of it.

             A double click on a bar of controls is how a window is opened
             out on a Mac, and the reader aims at whatever empty chrome is
             nearest — the space under the mailbox tabs as readily as the
             space beside Sync. With only the top row listening, most of
             what looks like the same bar did nothing.

             Not on a control: a double click on the expand button is two
             presses of it, and that is already an answer. */
          onDoubleClick={(e) => {
            if (isInteractiveDoubleClickTarget(e.target)) return;
            toggleListExpanded();
          }}
        >
          {/* h-11 + pt-2 on the column match ThreadPane's action strip so
              New email / Sync share a midline with Reply / Archive / ….
              Settings + density live in the title bar. */}
          {/* No margin under this row: what follows brings its own, and two
              stacked read as a gap twice over. */}
          <div className="-ml-[4px] flex h-11 items-center gap-1">
            {listChromeOnToolbar ? foldersButton : null}
            {listChromeOnToolbar ? filterButton : null}
            <Button
              type="button"
              title={t("newEmail")}
              aria-label={t("newEmail")}
              variant={chromeDark ? "default" : "outline"}
              className={cn(
                // flex overrides Button's inline-flex so it sits flush in the row.
                // h-9 matches ThreadAction; keep padding inside that height.
                // A pill, and the same one the thread's Reply is.
                "flex h-9 max-w-[9rem] flex-1 gap-1.5 rounded-full px-3 py-0 text-sm font-semibold shadow-none",
                /*
                  Not `bg-white text-stone-800`, which is what this asked
                  for and never got: the shell rewrites both of those for
                  the dark theme, so the one button meant to be the thing
                  you press came out the same navy as the page behind it.

                  A lifted slate rather than white or cream: on a dark page
                  those are too big a jump to make with a button, and the
                  eye reads a hole rather than a surface. The same three
                  the thread's Reply and Forward use — see --mail-action.
                */
                chromeDark &&
                  "border border-[var(--mail-action-border)] bg-[var(--mail-action)] text-[var(--mail-action-fg)] hover:bg-[var(--mail-action-hover)]"
              )}
              onPointerDown={beginNativeWindowDragOnMove}
              onClick={() => startCompose()}
            >
              <SquarePen className="h-4 w-4" />
              {listChromeOnToolbar || listWidth >= 250
                ? t("newEmail")
                : t("newShort")}
            </Button>
            <button
              type="button"
              title={noneFetching ? pausedLabel : t("syncInbox")}
              aria-label={noneFetching ? t("mailResume") : t("syncInbox")}
              onPointerDown={beginNativeWindowDragOnMove}
              /* Paused, this is the way out of it: the one control that
                 would have fetched is the one that says why nothing is. */
              onClick={noneFetching ? resumeFetching : syncNow}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium",
                noneFetching && "text-indigo-600 hover:text-indigo-700",
                chromeDark
                  ? "text-[var(--mail-chrome-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
                  : "text-stone-500 hover:bg-stone-200/70 hover:text-stone-800"
              )}
            >
              {noneFetching ? (
                <Moon className="h-4 w-4" />
              ) : (
                <SyncIcon className="h-4 w-4" spinning={refreshing || syncTurn} />
              )}
              {/* Quiet, this is the moon and nothing else: the badge beside
                  the search says until when, and the same words twice in
                  one corner is one of them saying nothing. The hover still
                  carries them, and so does the label a screen reader reads. */}
              {noneFetching ? null : t("sync")}
            </button>
            <button
              type="button"
              title={`${t(listExpanded ? "restoreListSize" : "expandList")} (${formatShortcut(
                shortcuts.expandList
              )})`}
              aria-label={`${t(listExpanded ? "restoreListSize" : "expandList")} (${formatShortcut(
                shortcuts.expandList
              )})`}
              aria-pressed={listExpanded}
              className={cn(
                chromeIconBtn,
                // Beside Sync, not out at the far edge: it belongs with the
                // controls it sits among, and a button alone across the row
                // reads as belonging to nothing.
                "flex h-8 w-8 shrink-0 items-center justify-center p-0"
              )}
              onClick={toggleListExpanded}
              onDoubleClick={(e) => {
                if (isInteractiveDoubleClickTarget(e.target)) return;
                toggleListExpanded();
              }}
            >
              {listExpanded ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          </div>

          {(() => {
            /*
              A line, not a band.

              An amber block the width of the pane was more weight than the
              news deserves — the auto-reply is a thing the reader turned on
              themselves, and the tabs already carry a mark on each mailbox
              it is on for. So this says how many and until when, and offers
              the way in to change it.

              One end date is only named when every mailbox shares it.
              Otherwise the count stands alone and the dialog has the
              detail, which the hover carries too.
            */
            const on = autoReplies.filter((a) => autoReplyActive(a));
            if (!on.length) return null;
            const day = (at: number) =>
              new Date(at - 1).toLocaleDateString(currentMailLocale(), {
                day: "numeric",
                month: "short",
              });
            const ends = on.map((a) => a.endTime);
            const shared =
              ends[0] !== null && ends.every((end) => end === ends[0])
                ? day(ends[0])
                : null;
            const who =
              on.length === 1
                ? formatAccountChipLabel(on[0].account, accountLabels)
                : t("autoReplyAccounts", { count: on.length });
            return (
              <div
                className="mt-2 flex items-center gap-1.5 px-0.5 text-xs text-[var(--mail-chrome-muted)]"
                title={on
                  .map(
                    (a) =>
                      formatAccountChipLabel(a.account, accountLabels) +
                      (a.endTime !== null
                        ? ` ${t("outOfOfficeUntil", { date: day(a.endTime) })}`
                        : "")
                  )
                  .join(", ")}
              >
                <AutoReplyMark className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {t("autoReplyOnFor", { who })}
                  {shared ? ` ${t("outOfOfficeUntil", { date: shared })}` : ""}
                </span>
                <span aria-hidden>·</span>
                <button
                  type="button"
                  className="shrink-0 font-semibold text-teal-700 hover:underline"
                  onClick={() => {
                    setAutoReplyAccount(on[0].account);
                    setAutoReplyOpen(true);
                  }}
                >
                  {t("manage")}
                </button>
              </div>
            );
          })()}

          {!listVertical ? listTabsOrFolder : null}
        </div>
        )}

        {listSplit ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("resizeControls")}
            aria-valuenow={Math.round(controlsWidth)}
            aria-valuemin={MIN_CONTROLS_WIDTH}
            aria-valuemax={MAX_CONTROLS_WIDTH}
            title={t("dragToResize")}
            onPointerDown={startControlsResize}
            // Sit on the pane side of the border (no -ml overlap) so chrome
            // never paints past the controls column edge.
            className="w-2 shrink-0 cursor-col-resize touch-none bg-transparent transition-colors hover:bg-stone-200/50 active:bg-stone-200/70"
          />
        ) : null}

        {threadListColumn}
      </div>
      </div>
      ) : null}

      {/* Drag handle for resizing the thread list. Not while the list is
          sliding: it is out of the flow then, and a handle in the flow
          would stand a sliver of reader off its edge until it lands. */}
      {listMounted && !hideList && !listExpanded && !listSliding &&
      !listExpandSliding ? (
      <div
        role="separator"
        aria-orientation={listVertical ? "horizontal" : "vertical"}
        aria-valuenow={Math.round(listVertical ? listHeight : listWidth)}
        aria-valuemin={
          detailOpen
            ? 0
            : listVertical
              ? MIN_LIST_HEIGHT
              : NARROW_LIST_WIDTH
        }
        aria-valuemax={MAX_LIST_ARIA}
        title={
          listNarrow
            ? "Drag out or double-click to expand list"
            : listVertical
              ? detailOpen
                ? "Drag to resize — pull small to hide"
                : t("dragToResize")
              : detailOpen
                ? "Drag to resize — narrow for avatars, smaller to hide"
                : "Drag to resize — narrow for avatar rail"
        }
        onPointerDown={listVertical ? startListHeightResize : startListResize}
        onDoubleClick={(e) => {
          if (listVertical || !listNarrow) return;
          e.preventDefault();
          expandListFromNarrow();
        }}
        className={cn(
          // Transparent: parent chrome cream shows through, so the action
          // band meets the list without a white notch. List keeps border-r.
          //
          // Above the reader: ThreadPane pulls its action strip and subject
          // left over this gutter so cream meets the list. Those bands used
          // to sit on top and steal the drag below the title bar.
          "relative z-20 shrink-0 touch-none bg-transparent transition-colors hover:bg-[var(--mail-chrome-hover)] active:bg-white/20",
          listVertical
            ? "h-2 w-full cursor-row-resize"
            : "w-2 cursor-col-resize"
        )}
        style={{ order: 2 }}
      />
      ) : null}

      {/* ------------------------------------------------ reading pane */}
      {/* Held through the expand sweep: what the clip edge covers or
          uncovers has to be the pane itself, not its absence. */}
      {!listExpanded || listExpandSliding ? (
      <div
        // No overflow clip here — the action band must paint over the resize
        // gutter to the list border. Message scrolling is on ThreadPane.
        // `relative z-0` keeps that paint inside this pane so the handle
        // above it still takes the drag from the title bar down.
        //
        /*
          The chrome, which is what the mailbox list beside it is painted in.
          
          Only three states ever show this: the resting picture, the wait for
          a first inbox, and the note that no mailbox is connected. Anything
          that draws a message — the thread, the composer — paints the
          reading surface over the top of it. So what this colour is for is
          the app at rest, and at rest the two halves of the window should
          be the one colour, which is what light has always done.
        */
        className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--mail-thread-chrome)]"
        style={{ order: listFirst ? 3 : 1 }}
      >
        {readingPaneContent}
      </div>
      ) : null}
      </div>
      </div>

      {autoReplyDialog}
      {crmProposalHost}
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
          account={floatingReply.account}
          accounts={accountEmails}
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
          inCrm
          counterpartName=""
          counterpartEmail=""
          onChatPromoted={() => {}}
          onChatThreadChanged={() => {}}
          onCrmChanged={() => {}}
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
              inCrm: summary?.tab === "people",
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
          accounts={accountEmails}
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
      {contactDialogs}
    </div>
  );
}

