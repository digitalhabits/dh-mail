"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component reads the page's slices that it needs (see
 * mail-page-slices.tsx). Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import { usePageAccounts, usePageCompose, usePageLayout, usePageList, usePageReader, usePageSync } from "@/components/mail/mail-page-slices";
import { useMailT } from "@/lib/mail/i18n";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import type { MailboxHideControls } from "@/components/mail/use-mailbox-hide";
import * as React from "react";
import { glideToNewPlaces } from "@/lib/mail/stack-glide";
import { HiddenStatus } from "@/components/mail/hidden-status";
import { TRIAGE_TAB, TriageListPane } from "@/components/mail/team-layer";
import { Loader2, Plus } from "lucide-react";
import { toast } from "@/lib/mail/toast";
import { mailHasTeamRecords } from "@/lib/mail/product-flavor";
import { teamWord } from "@/lib/mail/i18n-team";
import { deleteDraft, listHandedOverDraftKeys } from "@/lib/mail/local-drafts";
import { Button } from "@/components/ui/button";
import { MailDraftsList } from "@/components/mail/MailDraftsList";
import {
  draftsInView,
  draftWindowFor,
  openDraftRow,
  openDraftRowId,
} from "@/components/mail/draft-opening";
import { openMailDraftWindow, openMailThreadWindow } from "@/lib/mail/reader-window";
import {
  clearDraftSelection,
  clickDraftRow,
  draftRowKey,
  useDraftSelection,
} from "@/components/mail/draft-selection";
import { TYPING_TARGET } from "@/lib/mail/shortcuts";
import type { MailDraftRow, MailThreadSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";
import { MailListLoading } from "@/components/mail/MailListLoading";
import { accountPassesMailboxScope, gmailOauthHref, MAIL_OFF_TAB_VIEWS, mailboxScopeApiAccount, outlookOauthHref } from "@/components/mail/mail-list-state";
import { OlderMailRows } from "@/components/mail/mail-older-rows";
import { useOlderMail } from "@/components/mail/use-older-mail";
import { ThreadRows, PeopleRows, ListNotices, OutboxGroup } from "@/components/mail/mail-list-rows";
import { UndoSlotFoot } from "@/components/mail/undo-slot-row";
import { HiddenAccountsContext } from "@/components/mail/hidden-account-mark";

/**
 * The list's foot, while the list is seen: not put away, and not covered by
 * the reader on a phone.
 */
function ListUndoFoot() {
  const { detailOpen, listCollapsed, listNarrow, listOutForSearch, phone } = usePageLayout();
  const seen = phone ? !detailOpen : !listCollapsed || listOutForSearch;
  return <UndoSlotFoot place="list" on={seen} narrow={listNarrow} />;
}

/** The rows, with the banners over them and the load-more under them. */
export function ThreadListColumn({
  listTabsOrFolder,
  hide,
}: {
  listTabsOrFolder: React.ReactNode;
  /** Hidden mailboxes: with every one hidden, the list says so, not "connect". */
  hide?: MailboxHideControls;
}) {
  const t = useMailT();
  const pageList = usePageList();
  const { accountEmails } = usePageAccounts();
  const { chromeDark, listExpanded, listNarrow, listRowsOnPane, listVertical, phone, threadListRef } = usePageLayout();
  const { debouncedSearch, listCursor, listError, listScrollRef, loadingList, loadingMore, mailProviderNames, pinnedThreads, searchedVisible, tab, threads, viewMode } = usePageList();
  const { draftsView } = usePageCompose();
  const { readSoFar } = usePageSync();
  const older = useOlderSearch();
  const { loadMoreShown, loadNote } = useLoadMoreShown();
  // Stacks switched: the rows glide from where they were (lib/mail/stack-glide).
  React.useLayoutEffect(() => {
    glideToNewPlaces(listScrollRef.current);
  }, [viewMode, listScrollRef]);
  // The rows mark a hidden account's mail (hidden-account-mark).
  const hiddenSet = React.useMemo(
    () => new Set(pageList.hiddenSearch.emails.map((email) => email.toLowerCase())),
    [pageList.hiddenSearch.emails]
  );
  return (
    <HiddenAccountsContext.Provider value={hiddenSet}>
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
        {/* Archive, delete, move, snooze and send say so here, with Undo
            (undo-slot-row). */}
        <ListUndoFoot />
        <div
          ref={listScrollRef}
          data-mail-list-scroller
          className={cn(
            "h-full min-h-0 overflow-y-auto overscroll-none",
            listExpanded ? "pb-4" : "pb-6"
          )}
        >
          <ListNotices />
          {/* What will be sent later is in the Scheduled folder, and in its
              own conversation, not above the list (2026-10-28). */}
          {draftsView ? (
            <DraftsListView />
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
            ) : hide?.hidden.length ? (
            <HiddenMailboxesNotice hide={hide} />
            ) : (
            <NoMailboxNotice />
            )
          ) : tab === TRIAGE_TAB ? (
            // The ranked list, in the organization's build. It stands in for
            // the list rather than filtering it: the order is its own.
            <TriageListPane />
          ) : tab === "outbox" ? (
            // The Outbox view shows what is on its way out, and nothing of
            // the inbox the list still holds underneath.
            <div className="pt-2">
              <OutboxGroup />
            </div>
          ) : !searchedVisible.length && !pinnedThreads.length && !older.threads.length ? (
            <EmptyListNotice />
          ) : viewMode === "people" && tab !== "snoozed" && tab !== "sent" ? (
            <PeopleRows />
          ) : (
            <ThreadRows />
          )}
          {/* Below the local results: the server's matches in mail older
              than the copy's body window. */}
          {debouncedSearch && !draftsView && tab !== "outbox" ? (
            <OlderMailRows older={older} />
          ) : null}
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
          <LoadMoreNote note={loadNote} />
          {listCursor && !loadingList ? (
            <div
              className={cn("pb-2 pt-3", listNarrow ? "px-1" : "px-5")}
            >
              <button
                type="button"
                disabled={loadingMore}
                title={t("loadMore")}
                aria-label={loadingMore ? t("loadingMore") : t("loadMore")}
                onClick={() => void loadMoreShown()}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-inner py-2 text-xs font-medium text-[var(--mail-chrome-muted)] transition-colors hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)] disabled:opacity-60",
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
    </HiddenAccountsContext.Provider>
  );
}

/** What the last Load more found nothing of, under the rows. */
function LoadMoreNote({ note }: { note: string | null }) {
  const { listNarrow } = usePageLayout();
  const { loadingList } = usePageList();
  if (!note || listNarrow || loadingList) return null;
  return (
    <p className="px-5 pt-3 text-center text-[11px] leading-snug text-[var(--mail-chrome-faint)]">
      {note}
    </p>
  );
}

/**
 * Load more, for what this view shows: the rows that pass its filters, the
 * Unread switch and the mailbox tab. It reads on until one of those comes;
 * when none does, it says so, rather than seem to do nothing (2026-10-27).
 */
function useLoadMoreShown() {
  const t = useMailT();
  const { loadMoreThreads, passesFilters, tab, unreadOnly } = usePageList();
  const { accountEmails, mailboxScopeEmails } = usePageAccounts();
  const [loadNote, setLoadNote] = React.useState<string | null>(null);
  const viewKey = `${tab}|${unreadOnly}|${mailboxScopeEmails.join(",")}`;
  const [noteFor, setNoteFor] = React.useState(viewKey);
  // A note is about the view it was said in.
  if (noteFor !== viewKey) {
    setNoteFor(viewKey);
    setLoadNote(null);
  }
  const loadMoreShown = async () => {
    setLoadNote(null);
    const shows = (row: MailThreadSummary) =>
      passesFilters(row) &&
      (!unreadOnly || Boolean(row.unread)) &&
      accountPassesMailboxScope(row.account, mailboxScopeEmails, accountEmails);
    const found = await loadMoreThreads(shows);
    if (found > 0) return;
    setLoadNote(t(unreadOnly ? "noMoreUnreadFound" : "noMoreInViewFound"));
  };
  return { loadMoreShown, loadNote };
}

/**
 * The "Older mail" search for the list on screen. Only for a search over
 * every folder: the server search is of All Mail, so a search inside a
 * folder or a view of its own does not reach past the copy.
 */
function useOlderSearch() {
  const { accountEmails, mailboxScopeEmails } = usePageAccounts();
  const { activeFolder, debouncedSearch, loadingList, tab, threads } = usePageList();
  const { draftsView } = usePageCompose();
  return useOlderMail({
    query: debouncedSearch,
    account: mailboxScopeApiAccount(mailboxScopeEmails, accountEmails),
    mailboxes: accountEmails,
    // Sent, Trash, Snoozed and the rest are views of their own.
    enabled: !activeFolder && !draftsView && !MAIL_OFF_TAB_VIEWS.includes(tab),
    localReady: !loadingList,
    localThreads: threads,
  });
}

/**
 * The Drafts view: the drafts of every mailbox (or the one in scope), which
 * open into their thread or a composer, and the button that clears the
 * copies handed to Outlook.
 *
 * Shift-click takes a range and Cmd-click adds a row or takes it out, as in
 * the inbox; a plain click opens one draft. Rows whose discard is waiting out
 * its Undo are not shown.
 */
/**
 * Down and Up in Drafts: the next draft, opened as a click opens it, and its
 * row given focus. Not while typing (an open draft's composer), and not in
 * a menu. Counted from the open draft; with none open, the top one.
 */
function useDraftKeys(rows: MailDraftRow[], openKey: string | null, open: (row: MailDraftRow) => void) {
  const walk = React.useRef<(e: KeyboardEvent) => void>(() => {});
  React.useEffect(() => {
    walk.current = (e) => {
      if (!rows.length) return;
      e.preventDefault();
      const at = openKey ? rows.findIndex((row) => row.id === openKey) : -1;
      const next = at === -1 ? 0 : e.key === "ArrowDown" ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0);
      if (next === at) return;
      const row = rows[next];
      open(row);
      requestAnimationFrame(() => {
        for (const el of document.querySelectorAll<HTMLElement>("[data-draft-key]")) {
          if (el.dataset.draftKey !== row.id) continue;
          el.focus({ preventScroll: true });
          el.scrollIntoView({ block: "nearest" });
          break;
        }
      });
    };
  });
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(`${TYPING_TARGET}, [data-radix-popper-content-wrapper], [role="dialog"], [role="menu"], [role="listbox"]`)) return;
      walk.current(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function DraftsListView() {
  const { closeCompose, composeSeed, composing, drafts, draftsAccount, draftsLoading, refreshDrafts, startCompose } = usePageCompose();
  const { debouncedSearch } = usePageList();
  const { selected, setSelected, setSelectedPersonKey } = usePageReader();
  const selection = useDraftSelection();
  // A selection is of this view's rows; leaving the view lets go of it.
  React.useEffect(() => clearDraftSelection, []);
  const rows = draftsInView(drafts, draftsAccount, debouncedSearch).filter(
    (row) => !selection.hidden.has(draftRowKey(row))
  );
  // Which one is open: the draft the composer is on, or the thread a reply
  // draft belongs to.
  // The row last opened by a click or the keys: see openDraftRowId.
  const [chosen, setChosen] = React.useState<string | null>(null);
  const openKey = openDraftRowId(rows, {
    composeKey: composing ? (composeSeed?.draftKey ?? null) : null,
    thread: composing ? null : selected,
    chosen,
  });
  const openRow = openKey ? rows.find((row) => row.id === openKey) : undefined;
  useDraftKeys(rows, openKey, (row) => {
    setChosen(row.id);
    openDraftRow(row, { setSelected, setSelectedPersonKey, startCompose, closeCompose }, { keepFocus: true });
  });
  return (
    <MailDraftsList
      rows={rows}
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
      openKey={openKey}
      selectedKeys={selection.keys}
      onOpen={(row, event) => {
        const plain = clickDraftRow(
          row,
          { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey },
          () => rows.map(draftRowKey),
          openRow ? draftRowKey(openRow) : null
        );
        if (!plain) return;
        setChosen(row.id);
        openDraftRow(row, {
          setSelected,
          setSelectedPersonKey,
          startCompose,
          closeCompose,
        });
      }}
      onExpand={(row) => {
        // A reply opens its thread in a window of its own, where the
        // composer picks the draft up. A new message of ours opens in a
        // window that holds a composer only. The first click opened it here
        // too, so this composer closes first: one draft, one place to type.
        const target = draftWindowFor(row);
        if (!target) return;
        if (target.kind === "draft") closeCompose();
        const opening =
          target.kind === "draft"
            ? openMailDraftWindow(target)
            : openMailThreadWindow({
                account: target.account,
                threadId: target.threadId,
                name: row.to[0] ?? "",
                email: row.to[0] ?? "",
                subject: target.subject,
              });
        void opening.catch((err: unknown) => {
          console.error("reader window:", err);
          toast.error(typeof err === "string" && err ? err : err instanceof Error ? err.message : "Couldn't open it");
        });
      }}
    />
  );
}

/**
 * What the list says when it has no rows to show: nothing found for a
 * search, nothing in the folder or tab, or nothing yet.
 */
const EmptyListNotice = React.memo(function EmptyListNotice() {
  const t = useMailT();
  const { activeCustomList, activeFolder, searchEmptyText, tab } = usePageList();
  const { listNarrow } = usePageLayout();
  return (
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
              // again here is the same sentence twice. The name is
              // also the long form, the whole path, under a header that
              // spells it out one part at a time.
              "No mail in here."
            : activeCustomList
              ? `No mail from people in “${activeCustomList.name}”.`
              : tab === "people"
                ? (mailHasTeamRecords() && teamWord(t, "peopleEmpty")) ||
                  "No mail from your contacts right now."
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
  );
});

/**
 * What the list shows when every connected mailbox is hidden: that they are,
 * how, and a way to show one now. It said "Connect an account" before, which
 * is wrong for a mailbox hidden by its schedule. The reading pane shows it
 * too, for a list that is folded away.
 */
export function HiddenMailboxesNotice({ hide }: { hide: MailboxHideControls }) {
  const t = useMailT();
  
  return (
    <div className="px-5 py-8">
      <p className="text-sm font-medium text-[var(--mail-chrome-fg)]">{t("mailboxesHiddenTitle")}</p>
      <ul className="mt-3 space-y-3">
        {hide.hidden.map((email) => {
          const status = hide.statusOf(email);

          return (
            <li key={email} className="text-sm">
              <span className="block truncate text-[var(--mail-chrome-fg)]">{email}</span>
              <HiddenStatus status={status} className="flex text-[var(--mail-chrome-muted)]" />
              <button
                type="button"
                className="mt-1 text-sm font-medium text-teal-600 underline-offset-2 hover:underline"
                onClick={() => hide.showNow(email)}
              >
                {t("showMailboxNow")}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * What the list shows before any mailbox is connected: how to connect one.
 */
const NoMailboxNotice = React.memo(function NoMailboxNotice() {
  const t = useMailT();
  const { connect, connecting } = usePageAccounts();
  return (
    <div className="px-5 py-8">
      <p className="text-sm font-medium text-[var(--mail-chrome-fg)]">
        {t("connectToStart")}
      </p>
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
        {/* Exchange on-prem, in the desktop app only, as in Settings. */}
        {tauriInvoke() ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 border-[var(--mail-chrome-chip-border)] bg-transparent text-[var(--mail-chrome-fg)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-chrome-fg)]"
            disabled={connecting === "exchange"}
            onClick={() => connect("exchange")}
          >
            {connecting === "exchange" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t("connectProvider", { provider: "Exchange" })}
          </Button>
        ) : null}
      </div>
    </div>
  );
});
