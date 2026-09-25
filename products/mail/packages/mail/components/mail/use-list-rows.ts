"use client";

/*
 * The rows the thread list shows, off useMailPage: the pinned band, the
 * rest of the list narrowed by a search still on its way, the order both
 * are painted in, and the day groups.
 *
 * Owns: those derived lists, and writing the painted order into
 * `screenThreadOrderRef`, which the actions read to land on the next row.
 *
 * One effect: the top rows' bodies are fetched ahead once the list is
 * idle. useMailPage calls this hook where that effect always stood.
 */

import * as React from "react";
import { threadMatchesCustomList, type MailCustomList } from "@/lib/mail/custom-lists";
import { scheduleMailThreadPrefetch } from "@/lib/mail/prefetch-threads";
import { threadKey } from "@/lib/mail/thread-copies";
import { type MailStringKey } from "@/lib/mail/i18n";
import type { MailThreadSummary } from "@/lib/mail/types";
import { dayBucket } from "@/lib/mail/date-format";
import { MailListTab, MAIL_OFF_TAB_VIEWS, accountPassesMailboxScope, searchTokens, matchesTokens, threadHaystack, type ActiveMailFolder } from "@/components/mail/mail-list-state";
import type { MailViewMode } from "@/components/mail/MailListControls";

export function useListRows({
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
}: {
  tab: MailListTab;
  activeCustomList: MailCustomList | null | undefined;
  viewMode: MailViewMode;
  debouncedSearch: string;
  activeFolder: ActiveMailFolder | null;
  pins: { account: string; threadId: string; summary: MailThreadSummary }[];
  threads: MailThreadSummary[];
  mailboxScopeEmails: string[];
  accountEmails: string[];
  search: string;
  resultsQuery: string;
  /** The list's threads for this view, before a search narrows them. */
  visible: MailThreadSummary[];
  pinKeySet: Set<string>;
  screenThreadOrderRef: React.RefObject<MailThreadSummary[]>;
  loadingList: boolean;
  refreshing: boolean;
  listCacheKey: string;
}) {
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
  }, [listCacheKey, prefetchOrderKey, loadingList, refreshing, screenThreadOrderRef]);
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

  return {
    showPinnedBand,
    pinnedThreads,
    pendingTokens,
    searchedVisible,
    groups,
  };
}
