"use client";

/*
 * The thread list's data, off the page component: the rows on screen and
 * the cursor after them, the caches they warm and are warmed from, the
 * loader that asks every connected mailbox and merges what answers, the
 * quiet poll behind a visible window, and the after-send Sent refresh.
 * MailPage hands in the view the reader chose and a way to keep its open
 * thread honest; what comes back is the list and the levers.
 */

import {
  newHiddenRows,
  pruneHiddenRows,
  rowIsHidden,
  type HiddenRows,
} from "@/lib/mail/hidden-rows";
import { SYNC_CHANGED_WINDOW_EVENT } from "@/lib/mail/local-store";
import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { CONTACTS_CHANGED_EVENT } from "@/components/mail/ContactSourcesDialog";
import { shouldIgnoreFetchError } from "@/lib/mail/ignore-fetch-error";
import { getPageSnapshot, setPageSnapshot } from "@/lib/page-snapshot-cache";
import { dedupeThreadsByTip, threadKey } from "@/lib/mail/thread-copies";
import { mailPauseVerdictForAccount } from "@/lib/mail/quiet-hours";
import { mailSay } from "@/lib/mail/i18n";
import type { MailThreadSummary } from "@/lib/mail/types";
import { MAIL_POPOUT_SENT_KEY } from "@/lib/mail/popout";
import { MAIL_CHANGED_KEY } from "@/lib/mail/reader-window";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { mailListCacheKey, markMailWarm, readCachedList, writeCachedList } from "@/lib/mail/list-cache";
import { decodeCursorTokens, encodeCursorTokens, SERVER_FOLDER_VIEWS, peekMountCachedList, mailboxScopeApiAccount } from "@/components/mail/mail-list-state";
import type { MailPageSnapshot } from "@/components/mail/MailPage";
import {
  ROLE_VIEW,
  folderViewToken,
  type ActiveMailFolder,
} from "@/components/mail/mail-list-state";
import type { MailListCacheEntry } from "@/lib/mail/list-cache";
import type { MailPauseState } from "@/lib/mail/quiet-hours";

/**
 * What a mailbox's refusal means, in words the reader can act on.
 *
 * The raw message is a Gmail status line with a JSON body behind it. Two
 * refusals have a remedy worth naming: a request limit clears by itself,
 * and a lost grant is fixed by connecting the mailbox again. Anything
 * else is shown as it came, without the JSON.
 */
function plainFailure(failure: { email: string; reason: string }): {
  email: string;
  reason: string;
} {
  const raw = failure.reason;
  if (/rateLimitExceeded|userRateLimitExceeded|Quota exceeded|Too Many Requests/i.test(raw)) {
    return { email: failure.email, reason: mailSay("mailboxOverLimit") };
  }
  if (/needs reconnect|invalid_grant|insufficient/i.test(raw)) {
    return { email: failure.email, reason: mailSay("mailboxNeedsReconnect") };
  }
  const brace = raw.indexOf("{");
  const plain = (brace > 0 ? raw.slice(0, brace) : raw).replace(/[:\s—-]+$/, "").trim();
  return { email: failure.email, reason: plain.slice(0, 160) };
}

export function useThreadListData(input: {
  viewerId: string;
  pageSnapKey: string;
  initialList?: (MailListCacheEntry & { key: string }) | null;
  /** How many mailboxes are connected — only read on first render. */
  accountCount: number;
  accountEmails: string[];
  mailboxScopeEmails: string[];
  folder: string;
  activeFolder: ActiveMailFolder | null;
  debouncedSearch: string;
  searchScopeKey: string;
  pauseState: MailPauseState;
  noneFetching: boolean;
  /** The mail surface, for the poll's is-this-tab-even-visible check. */
  mailSurfaceRef: React.RefObject<HTMLDivElement | null>;
  /** Keep the open thread's In CRM flag in sync after a list refresh. */
  reconcileSelection: (threads: MailThreadSummary[]) => void;
}) {
  const {
    viewerId,
    pageSnapKey,
    initialList,
    accountCount,
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
  } = input;

  const listCacheKey = mailListCacheKey(
    activeFolder ? `label:${folderViewToken(activeFolder)}` : folder,
    debouncedSearch ? `${debouncedSearch}|${searchScopeKey}` : ""
  );

  /** null until first count fetch — Snoozed tab only when > 0. */
  const [snoozedCount, setSnoozedCount] = React.useState<number | null>(null);

  // Soft-nav / InstantTabPaint: seed from prop. Hard refresh: keep the first
  // client render identical to SSR (empty + loading), then fill from cache in
  // useLayoutEffect before paint — peeking localStorage in useState mismatches.
  const [threads, setThreads] = React.useState<MailThreadSummary[]>(() => {
    if (initialList?.threads.length) {
      writeCachedList(viewerId, initialList.key, {
        threads: initialList.threads,
        nextCursor: initialList.nextCursor,
      });
      return initialList.threads;
    }
    return [];
  });
  /** Opaque cursor for the next Gmail list page; null = no more to load. */
  const [listCursor, setListCursor] = React.useState<string | null>(() => {
    if (initialList) return initialList.nextCursor;
    return null;
  });
  const [loadingMore, setLoadingMore] = React.useState(false);
  // Blank loading until prop/cache/fetch has something to show.
  // No connected accounts → skip skeleton (nothing to fetch yet).
  const [loadingList, setLoadingList] = React.useState(
    () => Boolean(accountCount) && !initialList?.threads.length
  );

  React.useLayoutEffect(() => {
    if (!accountEmails.length) {
      setLoadingList(false);
      return;
    }
    if (threads.length) {
      markMailWarm(viewerId);
      return;
    }
    const cached =
      readCachedList(viewerId, listCacheKey) ?? peekMountCachedList(viewerId);
    if (cached?.threads.length) {
      // Seed the keyed list cache so the first fetch refreshes in place
      // instead of treating a page-snapshot paint as a cold miss.
      writeCachedList(viewerId, listCacheKey, cached);
      setThreads(cached.threads);
      threadsKeyRef.current = listCacheKey;
      setListCursor(cached.nextCursor);
      setLoadingList(false);
      markMailWarm(viewerId);
    }
    // Only on mount — listCacheKey/threads intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId]);

  React.useEffect(() => {
    if (!accountEmails.length) {
      setThreads([]);
      setListCursor(null);
      setLoadingList(false);
    }
  }, [accountEmails.length]);

  // Persist for InstantTabPaint — never clobber a warm snapshot with an empty
  // remount (SSR/hydrate starts with threads=[] before cache/fetch lands).
  React.useLayoutEffect(() => {
    if (!threads.length) {
      const existing = getPageSnapshot<MailPageSnapshot>(pageSnapKey);
      if (existing?.ownerId === viewerId && existing.threads?.length) {
        setPageSnapshot(pageSnapKey, {
          ...existing,
          ownerId: viewerId,
          accounts: accountEmails,
        });
        return;
      }
    }
    setPageSnapshot(pageSnapKey, {
      ownerId: viewerId,
      accounts: accountEmails,
      threads,
      listCacheKey,
      listCursor,
    });
  }, [accountEmails, threads, listCacheKey, listCursor, pageSnapKey, viewerId]);

  const pausedRef = React.useRef(noneFetching);
  pausedRef.current = noneFetching;
  const pauseStateRef = React.useRef(pauseState);
  pauseStateRef.current = pauseState;

  const [refreshing, setRefreshing] = React.useState(false);

  /**
   * The query the rows on screen were fetched for. "" while browsing.
   *
   * Compared against the live query to know whether the list is still an older
   * answer. A background poll of the same query re-sets the same value, so it
   * does not make the list look stale.
   */
  const [resultsQuery, setResultsQuery] = React.useState("");

  const [listError, setListError] = React.useState<string | null>(null);
  /**
   * The mailboxes the last load could not read, and why, in plain words.
   *
   * Shown at the top of the list. A mailbox that fails used to be left out
   * with nothing said: the rows that did come back looked like the whole
   * answer, and a search that missed a mailbox looked like a search with
   * no hits. Empty once every mailbox has answered.
   */
  const [unreadable, setUnreadable] = React.useState<
    { email: string; reason: string }[]
  >([]);

  const threadsRef = React.useRef(threads);
  threadsRef.current = threads;
  /**
   * Which list the rows on screen answer.
   *
   * Rows are kept while a new fetch runs, so the list does not blank on every
   * refresh. That is only right while the view is the same one. Make a folder
   * and open it and the rows kept over were the inbox's — shown under the new
   * folder's name, as though the mail had moved into it.
   */
  const threadsKeyRef = React.useRef(
    initialList?.threads.length ? initialList.key : ""
  );
  /**
   * Soft-hide keys until `until` ms, for rows removed here before the
   * provider agrees they are gone. A quiet poll that started before the
   * removal — or a cached list the server has not rebuilt yet — can
   * otherwise put the row straight back, where it sits looking undone
   * until the next poll takes it away again. Snooze hides until the wake;
   * archive, trash, junk and move hide for a minute, which outlives any
   * response built before the change.
   */
  const hiddenRowsRef = React.useRef<HiddenRows>(newHiddenRows());
  /**
   * The view on screen, as a hide remembers it: the open folder, or the tab.
   * A hide made here hides the row here and nowhere else. See hidden-rows.ts.
   */
  const listViewId = activeFolder ? `label:${folderViewToken(activeFolder)}` : `view:${folder}`;
  const listViewIdRef = React.useRef(listViewId);
  listViewIdRef.current = listViewId;
  const loadingListRef = React.useRef(loadingList);
  loadingListRef.current = loadingList;
  const refreshingRef = React.useRef(refreshing);
  refreshingRef.current = refreshing;
  /** Monotonic id so a slow inbox response can't overwrite a newer search. */
  const loadGenRef = React.useRef(0);
  /** A load is running; a coalescing call waits for it rather than cutting it off. */
  const inFlightRef = React.useRef(false);
  /** A coalescing call that arrived mid-load, to run once when the load ends. */
  const reloadAfterRef = React.useRef<{ fresh: boolean; quiet: boolean; incremental: boolean } | null>(null);
  const loadThreadsRef = React.useRef<((options?: { fresh?: boolean; quiet?: boolean; incremental?: boolean; coalesce?: boolean }) => Promise<boolean>) | null>(null);
  const loadAbortRef = React.useRef<AbortController | null>(null);
  const listQueryRef = React.useRef({
    folder,
    debouncedSearch,
    searchScopeKey,
    activeFolderName: folderViewToken(activeFolder),
  });
  listQueryRef.current = {
    folder,
    debouncedSearch,
    searchScopeKey,
    activeFolderName: folderViewToken(activeFolder),
  };

  /**
   * Whether a search also looks in Trash and Junk.
   *
   * Off by default: results from mail the reader has already thrown away
   * are usually noise, and quietly mixing them in would put threads in the
   * list that they had decided against. A standing preference, set in the
   * mailbox menu whenever they like — but it changes nothing until there is
   * a query, which is why the menu's own label only says "+Deleted" while
   * one is running.
   */
  const [searchDeleted, setSearchDeleted] = React.useState(false);

  /**
   * Browse/search params for the API. List paint filters by mailbox scope
   * client-side. Search never uses folderScoped — a query covers every folder
   * on the selected mailbox(es). One selected mailbox is sent as `account`.
   */
  const appendListParams = React.useCallback(
    (params: URLSearchParams) => {
      if (!debouncedSearch) {
        if (activeFolder) {
          // A row standing for a search has no label to ask for. It asks
          // for the view instead, which is the same one the tabs use.
          if (activeFolder.virtual && activeFolder.role) {
            params.set("folder", ROLE_VIEW[activeFolder.role]);
          } else {
            params.set("label", activeFolder.name);
          }
          // Opened from the rail, so opened on one mailbox. A folder row
          // under a heading that then listed another account's mail would
          // be telling the reader something untrue about their own filing.
          if (activeFolder.account) params.set("account", activeFolder.account);
        }
        // Every view the provider keeps in a folder of its own. Leaving one
        // out does not empty the list — it quietly serves the inbox instead,
        // which is what Junk and Trash did.
        else if (SERVER_FOLDER_VIEWS.includes(folder)) {
          params.set("folder", folder);
        }
        return;
      }
      params.set("q", debouncedSearch);
      if (searchDeleted) params.set("includeDeleted", "1");
      /**
       * The view narrows the search, the way the tabs beside it already do.
       *
       * A search used to reach every folder whatever was open, which left
       * Sent lit and underlined above results that were not sent mail —
       * the reader had picked a view and watched the same list come back.
       * That argument was already settled for All / In Contacts / Other,
       * and Sent, Trash, Junk and the folders were the exception.
       *
       * `folderScoped` is how the list is told to keep the folder query
       * alongside the words; a named label keeps it either way.
       */
      if (activeFolder) {
        if (activeFolder.virtual && activeFolder.role) {
          params.set("folder", ROLE_VIEW[activeFolder.role]);
        } else {
          params.set("label", activeFolder.name);
        }
        params.set("folderScoped", "1");
      } else if (SERVER_FOLDER_VIEWS.includes(folder)) {
        params.set("folder", folder);
        params.set("folderScoped", "1");
      }
      // A folder opened on one mailbox is the narrower answer of the two.
      const account =
        activeFolder?.account ??
        mailboxScopeApiAccount(
        mailboxScopeEmails,
        accountEmails
      );
      if (account) params.set("account", account);
    },
    [
      activeFolder,
      accountEmails,
      debouncedSearch,
      folder,
      mailboxScopeEmails,
      searchDeleted,
    ]
  );

  const loadThreads = React.useCallback(
    async (options?: {
      fresh?: boolean;
      quiet?: boolean;
      /** Gmail list-diff poll — reuse unchanged thread metadata. */
      incremental?: boolean;
      /**
       * Wait for a load already running, then run once more, rather than
       * cut it off. For signals that only say "there is more now": the
       * copy's worker sends one per batch of the first read, and a reload
       * that cancelled the one before it never finished while the batches
       * kept coming — the list stayed empty until the whole mailbox was in.
       */
      coalesce?: boolean;
      /**
       * Called with the rows this read put in the list, as it puts them
       * there. The state and `threadsRef` only hold them after the next
       * render, which comes after this promise has settled.
       */
      onLoaded?: (threads: MailThreadSummary[]) => void;
    }): Promise<boolean> => {
      // fresh = bypass caches; quiet = background poll (no spinner / toasts).
      const fresh = options?.fresh ?? false;
      const quiet = options?.quiet ?? false;
      const incremental = options?.incremental ?? false;
      if (options?.coalesce && inFlightRef.current) {
        reloadAfterRef.current = { fresh, quiet, incremental };
        return true;
      }
      const key = mailListCacheKey(
        activeFolder ? `label:${folderViewToken(activeFolder)}` : folder,
        debouncedSearch ? `${debouncedSearch}|${searchScopeKey}` : ""
      );

      /** Rows on screen that answer this view, rather than the last one. */
      const warmRows = threadsKeyRef.current === key ? threadsRef.current : [];
      threadsKeyRef.current = key;

      // Nothing connected yet — don't spin a skeleton waiting on an empty inbox.
      if (!accountEmails.length) {
        setThreads([]);
        setListCursor(null);
        setLoadingList(false);
        setRefreshing(false);
        if (!quiet) setListError(null);
        return true;
      }
      const liveEmails = accountEmails.filter(
        (email) =>
          !mailPauseVerdictForAccount(
            pauseStateRef.current,
            email,
            new Date()
          ).paused
      );
      if (!liveEmails.length) {
        setLoadingList(false);
        setRefreshing(false);
        return true;
      }

      // Supersede any in-flight list fetch (e.g. browse still running when
      // search starts — otherwise it finishes later and wipes the results).
      loadAbortRef.current?.abort();
      const gen = ++loadGenRef.current;
      const isCurrent = () => gen === loadGenRef.current;
      inFlightRef.current = true;

      /** What the list shows while it loads: the cached rows, the rows on screen, or a skeleton. */
      const showWhileLoading = (
        cached: ReturnType<typeof readCachedList>,
        warmRows: MailThreadSummary[]
      ) => {
        if (fresh) {
          if (!quiet) setRefreshing(true);
        } else if (cached?.threads.length) {
          // The cache key carries the query, so these rows answer it.
          setThreads(cached.threads);
          setResultsQuery(debouncedSearch);
          setListCursor(cached.nextCursor);
          setLoadingList(false);
          setRefreshing(true);
        } else if (warmRows.length > 0) {
          // Page snapshot / prior paint already on screen — keep rows and refresh
          // in place (don't blank into a skeleton for 15s on a cache-key miss).
          setLoadingList(false);
          setRefreshing(true);
        } else {
          setThreads([]);
          setListCursor(null);
          setLoadingList(true);
          setRefreshing(false);
        }
        if (!quiet) setListError(null);
      };

      const cached = fresh ? null : readCachedList(viewerId, key);
      showWhileLoading(cached, warmRows);
      const controller = new AbortController();
      loadAbortRef.current = controller;

      /** The view asks for one mailbox, and that mailbox is paused. */
      const scopedToPausedMailbox = (params: URLSearchParams) => {
        const scopedAccount = params.get("account");
        return Boolean(
          scopedAccount &&
            mailPauseVerdictForAccount(
              pauseStateRef.current,
              scopedAccount,
              new Date()
            ).paused
        );
      };

      /** The answer is still for the list on screen: no newer load, and the same view. */
      const stillWanted = () => {
        if (!isCurrent()) return false;
        const latest = listQueryRef.current;
        const latestKey = mailListCacheKey(
          latest.activeFolderName
            ? `label:${latest.activeFolderName}`
            : latest.folder,
          latest.debouncedSearch
            ? `${latest.debouncedSearch}|${latest.searchScopeKey}`
            : ""
        );
        return latestKey === key;
      };

      /**
       * Every mailbox asked on its own, and merged into the list as each
       * answer lands: one slow mailbox no longer holds back the others.
       * Throws when none answered and some failed, as the single read does.
       */
      const loadEachMailbox = async (params: URLSearchParams): Promise<boolean> => {
        const hideFiltered = (rows: MailThreadSummary[]) => {
          const now = Date.now();
          pruneHiddenRows(hiddenRowsRef.current, now);
          const visibleAccounts = new Set(
            accountEmails.map((email) => email.toLowerCase())
          );
          return rows.filter((t) => {
            if (!visibleAccounts.has(t.account.toLowerCase())) return false;
            return !rowIsHidden(hiddenRowsRef.current, threadKey(t), listViewIdRef.current, now);
          });
        };

        // Rows already on screen (or cached) hold their place until their
        // own mailbox's fetch lands.
        const buckets = new Map<string, MailThreadSummary[]>();
        for (const t of cached?.threads ?? warmRows) {
          const bucket = buckets.get(t.account);
          if (bucket) bucket.push(t);
          else buckets.set(t.account, [t]);
        }
        const mergedNow = () =>
          dedupeThreadsByTip(hideFiltered([...buckets.values()].flat()));

        const cursorTokens: Record<string, string> = {};
        let successes = 0;
        let firstError: unknown = null;
        // Slow Gmail + CRM classify regularly runs 20–30s; keep headroom.
        const ACCOUNT_TIMEOUT_MS = 60_000;
        /** Cap parallel mailbox fetches so we do not stampede DB / Gmail. */
        const ACCOUNT_CONCURRENCY = 2;

        /** Which mailboxes did not come back, and what each said. */
        const failures: { email: string; reason: string }[] = [];

        const fetchAccount = async (email: string) => {
          const accountController = new AbortController();
          const onParentAbort = () => accountController.abort();
          if (controller.signal.aborted) {
            accountController.abort();
          } else {
            controller.signal.addEventListener("abort", onParentAbort);
          }
          const accountTimeout = window.setTimeout(
            () => accountController.abort(),
            ACCOUNT_TIMEOUT_MS
          );
          try {
            const p = new URLSearchParams(params);
            p.set("account", email);
            const json = await apiJson<{
              threads?: MailThreadSummary[];
              nextCursor?: string | null;
            }>(`/api/mail/threads?${p.toString()}`, {
              signal: accountController.signal,
            });
            if (!isCurrent()) return;
            const rows = Array.isArray(json.threads) ? json.threads : [];
            // Same flaky-empty guard as the unified path, per mailbox:
            // never let an empty warm-browse response erase known rows.
            const hadRows = (buckets.get(email)?.length ?? 0) > 0;
            if (!fresh && !debouncedSearch && !rows.length && hadRows) {
              successes += 1;
              return;
            }
            successes += 1;
            Object.assign(cursorTokens, decodeCursorTokens(json.nextCursor));
            buckets.set(email, rows);
            // Rows from one mailbox are already the server's answer, so
            // local narrowing must stop even though others are still out.
            setThreads(mergedNow());
            setResultsQuery(debouncedSearch);
          } catch (err) {
            if (firstError == null) firstError = err;
            // Which one, and what it answered. This used to go only to the
            // console, where the toast could not reach it and nobody
            // reading the planner's log would ever find it.
            const aborted =
              err instanceof DOMException && err.name === "AbortError";
            failures.push({
              email,
              reason: aborted
                ? mailSay("mailboxTimedOut")
                : err instanceof Error
                  ? err.message
                  : String(err),
            });
            console.warn(`[mail] ${email} did not refresh:`, err);
          } finally {
            window.clearTimeout(accountTimeout);
            controller.signal.removeEventListener("abort", onParentAbort);
          }
        };

        for (let i = 0; i < liveEmails.length; i += ACCOUNT_CONCURRENCY) {
          if (!isCurrent() || controller.signal.aborted) break;
          const batch = liveEmails.slice(i, i + ACCOUNT_CONCURRENCY);
          await Promise.all(batch.map((email) => fetchAccount(email)));
        }

        if (!stillWanted()) return false;
        if (!successes) {
          /*
            Nothing came back, and nothing failed either.

            A mailbox whose answer arrived after the reader had moved on —
            typed in the search box, opened a folder, changed tab — returns
            without counting, because its rows are for a list nobody is
            looking at any more. A newer refresh is already running. That is
            not a failure to report; it is this one having nothing to say.
          */
          if (!failures.length) return false;
          setUnreadable(failures.map(plainFailure));
          throw firstError instanceof Error
            ? firstError
            : new Error("Couldn't load inbox");
        }
        const threads = mergedNow();
        const nextCursor = encodeCursorTokens(cursorTokens);
        setThreads(threads);
        options?.onLoaded?.(threads);
        setResultsQuery(debouncedSearch);
        setListCursor(nextCursor);
        writeCachedList(viewerId, key, { threads, nextCursor });
        reconcileSelection(threads);
        /*
          Only the mailboxes that actually failed.

          Counting instead — fewer successes than mailboxes — reported the
          reader's own typing as an error: an answer that arrived too late
          to be wanted leaves the count short without anything having gone
          wrong. Named at the top of the list rather than in a toast: a
          toast is gone in seconds, and the rows that did come back go on
          looking like the whole answer for as long as the list is open.
        */
        setUnreadable(failures.map(plainFailure));
        return successes === liveEmails.length;
      };

      /** What a failed read says: in the list when it has nothing to show, else in a toast. */
      const reportLoadError = (
        err: unknown,
        cached: ReturnType<typeof readCachedList>,
        warmRows: MailThreadSummary[]
      ) => {
        // Keep showing the cached / on-screen list if we have one.
        const haveWarm =
          (cached?.threads.length ?? 0) > 0 || warmRows.length > 0;
        const message =
          err instanceof Error && err.name === "AbortError"
            ? mailSay("inboxLoadTimedOut")
            : err instanceof Error
              ? err.message
              : "Couldn't load inbox";
        if (!fresh && !haveWarm) {
          setListError(message);
        } else if (!quiet) {
          toast.error(
            err instanceof Error && err.name === "AbortError"
              ? message
              : message.replace("Couldn't load inbox", "Couldn't refresh inbox")
          );
        }
      };

      /** Single-mailbox wall clock; multi-account uses a per-mailbox timeout. */
      let timeout: number | null = null;
      try {
        const params = new URLSearchParams();
        const snoozedView = !activeFolder && folder === "snoozed";
        if (!snoozedView) {
          appendListParams(params);
        }
        if (fresh && !snoozedView) params.set("fresh", "1");
        if (incremental && !snoozedView) params.set("incremental", "1");
        // One mailbox asked for, and it is paused: nothing to fetch.
        if (scopedToPausedMailbox(params)) {
          setLoadingList(false);
          setRefreshing(false);
          return true;
        }

        // Multi-account browse/search: one request per mailbox, merged into
        // the list as each response lands — one slow mailbox no longer holds
        // back the others, and rows drop in as they arrive.
        if (
          !snoozedView &&
          !params.has("account") &&
          accountEmails.length > 1
        ) {
          return await loadEachMailbox(params);
        }

        timeout = window.setTimeout(() => controller.abort(), 45_000);
        const json = await apiJson<{
          threads?: MailThreadSummary[];
          nextCursor?: string | null;
        }>(
          snoozedView
            ? `/api/mail/snoozed?${params.toString()}`
            : `/api/mail/threads?${params.toString()}`,
          { signal: controller.signal }
        );
        // Query changed while we were in flight (search typed, tab switch…).
        if (!stillWanted()) return false;

        const rawThreads = Array.isArray(json.threads) ? json.threads : [];
        // One answer for every mailbox: nothing was left out.
        setUnreadable([]);
        const nextCursor = snoozedView ? null : (json.nextCursor ?? null);
        // Never let a flaky empty response erase a warm browse list. Search
        // and explicit refresh are allowed to show a true zero.
        // An empty answer for a view we have rows for is more likely a flaky
        // mailbox than a true zero — except when those rows answer another
        // view, and an empty folder would otherwise never manage to look empty.
        const keepWarm =
          !fresh &&
          !debouncedSearch &&
          !rawThreads.length &&
          (cached?.threads.length || warmRows.length) > 0;
        if (keepWarm) {
          if (!quiet) toast.error(mailSay("couldNotRefreshInbox"));
          return false;
        }
        const now = Date.now();
        pruneHiddenRows(hiddenRowsRef.current, now);
        // Drop rows for mailboxes hidden from Mail (server should already
        // omit them; this covers optimistic hide + any stale cache).
        const visibleAccounts = new Set(
          accountEmails.map((email) => email.toLowerCase())
        );
        const threads = snoozedView
          ? rawThreads
          : rawThreads.filter((t) => {
              if (!visibleAccounts.has(t.account.toLowerCase())) return false;
              return !rowIsHidden(hiddenRowsRef.current, threadKey(t), listViewIdRef.current, now);
            });
        setThreads(threads);
        options?.onLoaded?.(threads);
        setResultsQuery(debouncedSearch);
        setListCursor(nextCursor);
        writeCachedList(viewerId, key, { threads, nextCursor });
        if (snoozedView) setSnoozedCount(threads.length);
        // Keep the open thread's In CRM flag in sync after Add to CRM / refresh.
        reconcileSelection(threads);
        return true;
      } catch (err) {
        if (!isCurrent()) return false;
        // Navigating to OAuth cancels in-flight fetches (WebKit: "Load failed").
        if (shouldIgnoreFetchError()) return false;
        reportLoadError(err, cached, warmRows);
        return false;
      } finally {
        if (timeout != null) window.clearTimeout(timeout);
        if (isCurrent()) {
          setLoadingList(false);
          setRefreshing(false);
          inFlightRef.current = false;
          // What arrived while this ran: one more load, for all of it.
          const again = reloadAfterRef.current;
          if (again) {
            reloadAfterRef.current = null;
            window.setTimeout(() => {
              void loadThreadsRef.current?.({ ...again, coalesce: true });
            }, 0);
          }
        }
      }
    },
    // The list has the count of the mailboxes and not the array. A new
    // order, or a new `accounts` prop, makes a new array with the same
    // mailboxes in it, and that must not load the list again.
    // `reconcileSelection` does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      accountEmails.length,
      activeFolder,
      appendListParams,
      debouncedSearch,
      folder,
      searchScopeKey,
      viewerId,
    ]
  );

  React.useEffect(() => {
    loadThreadsRef.current = loadThreads;
  }, [loadThreads]);

  /**
   * After a send, refresh only that mailbox's Sent list (not every account).
   * Updates the Sent cache always; merges into the live list when Sent is open.
   */
  const refreshSentForAccount = React.useCallback(
    async (accountEmail: string) => {
      const email = accountEmail.trim();
      if (!email) return;
      try {
        const params = new URLSearchParams({
          folder: "sent",
          account: email,
          fresh: "1",
          incremental: "1",
        });
        const json = await apiJson<{
          threads?: MailThreadSummary[];
          nextCursor?: string | null;
        }>(`/api/mail/threads?${params.toString()}`);
        const rows = Array.isArray(json.threads) ? json.threads : [];
        const sentKey = mailListCacheKey("sent", "");
        const cached = readCachedList(viewerId, sentKey);
        const others = (cached?.threads ?? []).filter(
          (t) => t.account.toLowerCase() !== email.toLowerCase()
        );
        const nextThreads = dedupeThreadsByTip([...others, ...rows]);
        const tokens = decodeCursorTokens(cached?.nextCursor ?? null);
        const incoming = decodeCursorTokens(json.nextCursor ?? null);
        if (Object.keys(incoming).length) {
          Object.assign(tokens, incoming);
        } else if (json.nextCursor) {
          tokens[email] = json.nextCursor;
        }
        writeCachedList(viewerId, sentKey, {
          threads: nextThreads,
          nextCursor: encodeCursorTokens(tokens),
        });

        const view = listQueryRef.current;
        if (
          view.folder === "sent" &&
          !view.activeFolderName &&
          !view.debouncedSearch
        ) {
          setThreads((current) => {
            const keep = current.filter(
              (t) => t.account.toLowerCase() !== email.toLowerCase()
            );
            return dedupeThreadsByTip([...keep, ...rows]);
          });
        }
      } catch {
        /* quiet — the next poll still catches up */
      }
    },
    [viewerId]
  );

  /** Provider Sent indexing lags; two quiet beats for one mailbox only. */
  const scheduleSentRefreshForAccount = React.useCallback(
    (accountEmail: string) => {
      const email = accountEmail.trim();
      if (!email) return;
      for (const delay of [1_200, 5_000]) {
        window.setTimeout(() => {
          void refreshSentForAccount(email);
        }, delay);
      }
    },
    [refreshSentForAccount]
  );

  // Cheap count so the Snoozed tab can appear without loading the full list.
  // All-accounts count — the account menu filters the snoozed list client-side.
  // Defer so threads + folder names claim the first network slots.
  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const json = await apiJson<{ count: number }>(
            "/api/mail/snoozed?countOnly=1"
          );
          if (!cancelled) setSnoozedCount(json.count);
        } catch {
          /* tab visibility is best-effort */
        }
      })();
    }, 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  const loadMoreThreads = React.useCallback(async () => {
    if (!listCursor || loadingMore || loadingList || refreshing) return;
    if (!activeFolder && folder === "snoozed") return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      appendListParams(params);
      params.set("cursor", listCursor);
      const json = await apiJson<{
        threads: MailThreadSummary[];
        nextCursor?: string | null;
      }>(`/api/mail/threads?${params.toString()}`);
      const nextCursor = json.nextCursor ?? null;
      setThreads((current) => {
        const byKey = new Map(current.map((t) => [threadKey(t), t]));
        for (const t of json.threads) byKey.set(threadKey(t), t);
        // Sorts newest-first and collapses cc'd copies across mailboxes.
        const merged = dedupeThreadsByTip([...byKey.values()]);
        writeCachedList(viewerId, listCacheKey, { threads: merged, nextCursor });
        return merged;
      });
      setListCursor(nextCursor);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load more");
    } finally {
      setLoadingMore(false);
    }
  }, [
    appendListParams,
    folder,
    activeFolder,
    listCacheKey,
    listCursor,
    loadingList,
    loadingMore,
    refreshing,
    viewerId,
  ]);

  /**
   * Opening the app is a sync.
   *
   * The first load answers from the store, which is the mailbox as it was
   * when the app last ran — old mail, drawn fast. Nothing then asked the
   * provider until the poll's first tick, a minute out, so the inbox sat
   * out of date until Sync was pressed by hand. The rows paint from the
   * store first, and the provider poll follows at once — the same call the
   * Sync button makes, once per open rather than once per view.
   */
  const syncedOnOpenRef = React.useRef(false);
  React.useEffect(() => {
    // Quiet: automatic open must not toast when one slow mailbox fails.
    // Manual refresh / pull still surfaces partial failures.
    void loadThreads({ incremental: true, quiet: true }).then(() => {
      if (syncedOnOpenRef.current) return;
      syncedOnOpenRef.current = true;
      /*
        Not while it is paused.
 
        The first call answers from the store — the mailbox as it was, which
        is exactly what a paused one should show. The second is the ask,
        and opening the app must not be a way round the switch: a calm
        morning that fills up the moment you look at it is not one.
      */
      if (pausedRef.current) return;
      void loadThreads({ fresh: true, incremental: true, quiet: true });
    });
  }, [loadThreads]);

  /*
   * The address book changed, so the split between In Contacts and Other
   * may be wrong for rows already on screen. On a first run the inbox loads
   * before the first contact sync ends, and every row lands in Other until
   * the next poll. Load again now, past the caches, so the tabs are right
   * as soon as the contacts are.
   */
  React.useEffect(() => {
    const onContactsChanged = () => {
      void loadThreads({ fresh: true, quiet: true });
    };
    window.addEventListener(CONTACTS_CHANGED_EVENT, onContactsChanged);
    return () =>
      window.removeEventListener(CONTACTS_CHANGED_EVENT, onContactsChanged);
  }, [loadThreads]);

  // Focus-aware inbox poll: while the window is visible, quietly refresh so
  // new mail shows up without a manual refresh. Pause when hidden; back off
  // on errors so we don't melt Gmail during outages. Always incremental —
  // Gmail History / prior-page reuse; full rebuild only when priors are gone.
  React.useEffect(() => {
    const BASE_MS = 60_000;
    const MAX_MS = 5 * 60_000;
    const RESUME_MS = 1_500;
    let cancelled = false;
    let timer: number | null = null;
    let delay = BASE_MS;
    let inFlight = false;

    const clear = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (ms: number) => {
      clear();
      if (cancelled) return;
      timer = window.setTimeout(() => {
        void tick();
      }, ms);
    };

    const mailSurfaceHidden = () => {
      // Plan shell keeps the previous tab mounted (CSS hidden) during nav.
      const el = mailSurfaceRef.current;
      if (!el) return false;
      return Boolean(el.closest('[aria-hidden="true"]'));
    };

    const tick = async () => {
      if (cancelled) return;
      /*
        Paused: the timer keeps its place and fetches nothing.

        Kept running rather than torn down, so the minute the hours end —
        or the reader presses Awake — the next tick is the ordinary one and
        nothing has to be restarted. What sleep costs is the asking.
      */
      if (pausedRef.current) {
        schedule(delay);
        return;
      }
      if (document.visibilityState !== "visible" || mailSurfaceHidden()) {
        schedule(delay);
        return;
      }
      // Skip while the user is searching or another list fetch is running.
      if (
        debouncedSearch ||
        inFlight ||
        loadingListRef.current ||
        refreshingRef.current
      ) {
        schedule(delay);
        return;
      }
      inFlight = true;
      const ok = await loadThreads({
        quiet: true,
        incremental: true,
      });
      inFlight = false;
      if (cancelled) return;
      delay = ok ? BASE_MS : Math.min(Math.max(delay, BASE_MS) * 2, MAX_MS);
      schedule(delay);
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible" || mailSurfaceHidden()) {
        clear();
        return;
      }
      // Coming back to a paused mailbox fetches nothing: the whole point
      // is that looking at it does not fill it.
      if (pausedRef.current) return;
      delay = BASE_MS;
      schedule(RESUME_MS);
    };

    document.addEventListener("visibilitychange", onVisibility);
    schedule(BASE_MS);

    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadThreads, debouncedSearch, mailSurfaceRef]);

  // A chat popout window sent mail: refresh that mailbox's Sent soon
  // (staggered — the provider needs a beat to index the sent copy).
  // Browsers signal via the storage event; desktop shells via Tauri.
  React.useEffect(() => {
    const accountFromPayload = (raw: unknown): string => {
      if (!raw || typeof raw !== "object") return "";
      const account = (raw as { account?: unknown }).account;
      return typeof account === "string" ? account.trim() : "";
    };
    const refreshAfterRemoteSend = (accountEmail: string) => {
      if (accountEmail) scheduleSentRefreshForAccount(accountEmail);
      else {
        // Legacy signal without account — keep prior full-list refresh.
        for (const delay of [1_200, 5_000]) {
          window.setTimeout(() => {
            void loadThreads({ fresh: true, quiet: true, incremental: true });
          }, delay);
        }
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MAIL_POPOUT_SENT_KEY || !event.newValue) return;
      try {
        refreshAfterRemoteSend(
          accountFromPayload(JSON.parse(event.newValue))
        );
      } catch {
        refreshAfterRemoteSend("");
      }
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
        .listen("mail-sent", (event) => {
          refreshAfterRemoteSend(accountFromPayload(event.payload));
        })
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
  }, [loadThreads, scheduleSentRefreshForAccount]);

  // A reader window archived, deleted or moved a thread: drop the row now,
  // not at the next poll. Twice, because the provider can take a moment to
  // leave the change out of its own listing. The same two channels as the
  // sent signal above.
  React.useEffect(() => {
    const timers: number[] = [];
    const reloadSoon = () => {
      for (const delay of [400, 2_500]) {
        timers.push(
          window.setTimeout(() => {
            void loadThreads({ fresh: true, quiet: true, incremental: true, coalesce: true });
          }, delay)
        );
      }
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== MAIL_CHANGED_KEY || !event.newValue) return;
      reloadSoon();
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
              handler: () => void
            ) => Promise<() => void>;
          };
        };
      }
    ).__TAURI__?.event;
    // The Outlook worker runs in this process and says so on the window.
    window.addEventListener(SYNC_CHANGED_WINDOW_EVENT, reloadSoon);
    let unlistenSync: (() => void) | null = null;
    if (tauriEvent?.listen) {
      void tauriEvent
        .listen("mail-changed", reloadSoon)
        .then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        })
        .catch(() => {});
      // The local copy's worker wrote rows: the list is stale by exactly
      // those rows, and the reload is a local read.
      void tauriEvent
        .listen("mail-sync-changed", reloadSoon)
        .then((fn) => {
          if (cancelled) fn();
          else unlistenSync = fn;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(SYNC_CHANGED_WINDOW_EVENT, reloadSoon);
      unlisten?.();
      unlistenSync?.();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [loadThreads]);

  return {
    listCacheKey,
    threads,
    setThreads,
    threadsRef,
    threadsKeyRef,
    hiddenRowsRef,
    listViewIdRef,
    listCursor,
    setListCursor,
    loadingList,
    setLoadingList,
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
    refreshSentForAccount,
    scheduleSentRefreshForAccount,
    loadAbortRef,
  };
}
