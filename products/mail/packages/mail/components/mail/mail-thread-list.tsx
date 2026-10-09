"use client";

/*
 * Part of MailPage's markup, moved out of MailPage.tsx.
 *
 * Each component takes the page's model (`m`, from useMailPage) and reads
 * the names it needs from it. Markup it shares with the rest of the page
 * comes in as props. The JSX is MailPage's own, word for word.
 */

import { isWindowsHost } from "@/lib/mail/host-os";
import * as React from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "@/lib/mail/toast";
import { mailHasTeamRecords } from "@/lib/mail/product-flavor";
import { teamWord } from "@/lib/mail/i18n-team";
import { deleteDraft, listHandedOverDraftKeys } from "@/lib/mail/local-drafts";
import { Button } from "@/components/ui/button";
import { MailDraftsList } from "@/components/mail/MailDraftsList";
import {
  draftsInView,
  openDraftRow,
  openDraftRowId,
} from "@/components/mail/draft-opening";
import {
  clearDraftSelection,
  clickDraftRow,
  draftRowKey,
  useDraftSelection,
} from "@/components/mail/draft-selection";
import { TYPING_TARGET } from "@/lib/mail/shortcuts";
import type { MailDraftRow } from "@/lib/mail/types";
import { cn } from "@/lib/utils";
import { MailListLoading } from "@/components/mail/MailListLoading";
import { gmailOauthHref, MAIL_OFF_TAB_VIEWS, mailboxScopeApiAccount, outlookOauthHref } from "@/components/mail/mail-list-state";
import { OlderMailRows } from "@/components/mail/mail-older-rows";
import { useOlderMail } from "@/components/mail/use-older-mail";
import type { MailPageModel } from "@/components/mail/use-mail-page";
import { ThreadRows, PeopleRows, ListNotices, OutboxGroup } from "@/components/mail/mail-list-rows";

/** The rows, with the banners over them and the load-more under them. */

export function ThreadListColumn({
  m,
  listTabsOrFolder,
}: {
  m: MailPageModel;
  listTabsOrFolder: React.ReactNode;
}) {
  const {
    accountEmails,
    chromeDark,
    debouncedSearch,
    draftsView,
    listCursor,
    listError,
    listExpanded,
    listNarrow,
    listRowsOnPane,
    listScrollRef,
    listVertical,
    loadMoreThreads,
    loadingList,
    loadingMore,
    mailProviderNames,
    phone,
    pinnedThreads,
    readSoFar,
    searchedVisible,
    t,
    tab,
    threadListRef,
    threads,
    viewMode,
  } = m;
  const older = useOlderSearch(m);
  return (
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
          <ListNotices m={m} />
          {draftsView ? (
            <DraftsListView m={m} />
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
            <NoMailboxNotice m={m} />
            )
          ) : tab === "outbox" ? (
            // The Outbox view shows what is on its way out, and nothing of
            // the inbox the list still holds underneath.
            <div className="pt-2">
              <OutboxGroup m={m} />
            </div>
          ) : !searchedVisible.length && !pinnedThreads.length && !older.threads.length ? (
            <EmptyListNotice m={m} />
          ) : viewMode === "people" && tab !== "snoozed" && tab !== "sent" ? (
            <PeopleRows m={m} />
          ) : (
            <ThreadRows m={m} />
          )}
          {/* Below the local results: the server's matches in mail older
              than the copy's body window. */}
          {debouncedSearch && !draftsView && tab !== "outbox" ? (
            <OlderMailRows m={m} older={older} />
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
}

/**
 * The "Older mail" search for the list on screen. Only for a search over
 * every folder: the server search is of All Mail, so a search inside a
 * folder or a view of its own does not reach past the copy.
 */
function useOlderSearch(m: MailPageModel) {
  const { accountEmails, activeFolder, debouncedSearch, draftsView, loadingList, mailboxScopeEmails, tab, threads } = m;
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

function DraftsListView({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    closeCompose,
    composeSeed,
    composing,
    debouncedSearch,
    drafts,
    draftsAccount,
    draftsLoading,
    refreshDrafts,
    selected,
    setSelected,
    setSelectedPersonKey,
    startCompose,
  } = m;
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
    />
  );
}

/**
 * What the list says when it has no rows to show: nothing found for a
 * search, nothing in the folder or tab, or nothing yet.
 */
function EmptyListNotice({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    activeCustomList,
    activeFolder,
    listNarrow,
    searchEmptyText,
    t,
    tab,
  } = m;
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
              // again here is the same sentence twice — and it was
              // the long form, the whole path, under a header that
              // had just spelt it out one part at a time.
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
}

/**
 * What the list shows before any mailbox is connected: how to connect one.
 */
function NoMailboxNotice({
  m,
}: {
  m: MailPageModel;
}) {
  const {
    connect,
    connecting,
    t,
  } = m;
  return (
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
  );
}
