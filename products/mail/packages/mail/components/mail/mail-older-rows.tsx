"use client";

/*
 * The "Older mail" part of a search: the provider's matches older than
 * the copy's body window, under their own heading below the local results.
 * See lib/mail/older-search.ts and use-older-mail.ts.
 */

import { usePageActions, usePageLayout, usePageList, usePageReader } from "@/components/mail/mail-page-slices";
import { useMailT } from "@/lib/mail/i18n";
import { History, Loader2 } from "lucide-react";

import { ThreadListRow } from "@/components/mail/ThreadListRow";
import type { OlderMail } from "@/components/mail/use-older-mail";
import { rowStandsFor, threadKey } from "@/lib/mail/thread-copies";
import { cn } from "@/lib/utils";

export function OlderMailRows({ older }: { older: OlderMail }) {
  const t = useMailT();
  const { listExpanded, listNarrow } = usePageLayout();
  const { passesFilters } = usePageList();
  // The tab's filter holds for these rows as it does for the rest.
  const rows = older.threads.filter(passesFilters);
  const quiet = cn(
    "flex items-center gap-1.5 pt-3 text-[11px] leading-snug text-[var(--mail-chrome-faint)]",
    listNarrow ? "justify-center px-1" : "px-5"
  );
  if (older.loading) {
    return (
      <p className={quiet} title={t("searchingOlderMail")} data-older-mail="loading">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {listNarrow ? null : t("searchingOlderMail")}
      </p>
    );
  }
  const note = older.missed === "offline" ? t("olderMailOffline") : older.missed === "failed" ? t("olderMailFailed") : null;
  if (!rows.length && !note) return null;
  return (
    <div data-older-mail="done">
      {rows.length ? (
        <>
          {listNarrow ? (
            <div className="flex justify-center pb-0.5 pt-2" title={t("olderMail")}>
              <History className="h-3 w-3 text-[var(--mail-chrome-faint)]" aria-label={t("olderMail")} />
            </div>
          ) : (
            <p
              className={cn(
                "px-5 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-chrome-faint)]",
                listExpanded ? "pt-2" : "pt-4"
              )}
            >
              {t("olderMail")}
            </p>
          )}
          {rows.map((thread) => (
            <OlderRow key={threadKey(thread)} thread={thread} />
          ))}
        </>
      ) : null}
      {note && !listNarrow ? <p className={quiet}>{note}</p> : null}
    </div>
  );
}

/**
 * One older thread, as the list draws any thread. No archive, trash or
 * snooze on the row: the list does not hold these threads, so it could
 * not show the result. The thread opens, and acts from there.
 */
function OlderRow({ thread }: { thread: OlderMail["threads"][number] }) {
  const { chromeDark, listDensity, listExpanded, listNarrow, listRowWide, phone } = usePageLayout();
  const { clickThreadRow, expandThreadRow, selected } = usePageReader();
  const { highlightTerms, multiKeys, pinKeySet } = usePageList();
  const { rowMenuActions, togglePin, toggleRead } = usePageActions();
  return (
    <ThreadListRow
      highlight={highlightTerms}
      thread={thread}
      selected={
        !listExpanded &&
        ((selected != null && rowStandsFor(thread, selected)) || multiKeys.has(threadKey(thread)))
      }
      withYear
      pinned={pinKeySet.has(threadKey(thread))}
      onNavy={chromeDark}
      density={listDensity}
      narrow={listNarrow}
      wide={listRowWide}
      onOpen={(e) => clickThreadRow(thread, e)}
      onExpand={() => expandThreadRow(thread)}
      onTogglePin={() => togglePin(thread)}
      onToggleRead={() => void toggleRead([thread], "it")}
      {...rowMenuActions(thread)}
      dragKind="folder"
      touch={phone}
    />
  );
}
