"use client";

/**
 * A person's threads as a stack, in the list.
 *
 * A person with several threads is one row like any other, with a clear
 * "4 threads" and a chevron by the name. One click unfolds the stack under it, every thread a row of
 * its own, and opens the newest in the reader; that row is marked, so it
 * is plain which is open. A click on another opens it; a click on the
 * person's row again folds the stack.
 */

import { ChevronDown, ChevronRight, Paperclip } from "lucide-react";

import { Highlighted } from "@/components/mail/Highlighted";
import { DraftBadge, ThreadMessageCount } from "@/components/mail/ThreadListRow";
import { rowTime } from "@/lib/mail/date-format";
import { useMailT } from "@/lib/mail/i18n";
import type { MailThreadSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";

/** "4 threads" in a pill, and a chevron for which way the stack is: open or closed. */
export function StackCount({
  count,
  open,
  className,
}: {
  /** Every thread in the stack, the top one too. */
  count: number;
  open: boolean;
  className?: string;
}) {
  const t = useMailT();
  if (count < 2) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <span
      // Shown only once the threads have gone under it, when Stacks is
      // switched on (lib/mail/stack-glide).
      data-stack-count=""
      className={cn(
        // The chosen mailbox tab's fill and words: clear, and the one
        // thing that says this row is several threads.
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--mail-segment-active)] px-2 py-0.5 text-[12.5px] leading-none text-[var(--mail-segment-active-fg)]",
        className
      )}
      title={open ? t("stackFold") : t("stackOpen")}
    >
      {t("personThreadsCount", { count })}
      <Chevron className="h-3 w-3" aria-hidden />
    </span>
  );
}

/** One thread of an open stack: its subject, its first words and its date. */
export function StackThreadRow({
  thread,
  active,
  onOpen,
  onExpand,
  onNavy,
  highlight,
  withYear,
}: {
  thread: MailThreadSummary;
  /** The thread open in the reader. */
  active: boolean;
  onOpen: () => void;
  /** Two clicks: the thread in a window of its own, as a thread row does. */
  onExpand?: () => void;
  onNavy: boolean;
  highlight: string[] | undefined;
  withYear: boolean;
}) {
  const t = useMailT();
  return (
    <button
      type="button"
      data-stack-thread={`${thread.account}|${thread.threadId}`}
      onClick={onOpen}
      onDoubleClick={
        onExpand
          ? (e) => {
              e.preventDefault();
              onExpand();
            }
          : undefined
      }
      className={cn(
        // No line and no bar: the open one is a card, as an open row is.
        "relative flex w-full items-start gap-3 rounded-control py-1.5 pl-4 pr-2 text-left",
        // The faint line between two conversations, as between rows of the
        // list, but starting where the subject does. None under the last.
        "after:pointer-events-none after:absolute after:bottom-0 after:left-4 after:right-0 after:h-px after:bg-[var(--mail-row-line)] last:after:hidden",
        active
          ? "bg-[var(--mail-row-selected)] shadow-[var(--mail-row-card-shadow)] after:hidden"
          : "hover:bg-[var(--mail-chrome-hover)]"
      )}
    >
      <span className="min-w-0 flex-1">
        {/* The subject and how many mails the thread holds: a thread is
            not one mail, and under a stack it looked like one. */}
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span
            className={cn(
              "min-w-0 truncate text-sm",
              thread.unread && "font-semibold",
              onNavy ? "text-white/85" : "text-stone-700"
            )}
          >
            <Highlighted text={thread.subject} terms={highlight} onNavy={onNavy} />
          </span>
          <ThreadMessageCount count={thread.messageCount} label={t("threadMailsCount", { count: thread.messageCount })} />
        </span>
        {thread.snippet ? (
          <span className="block truncate text-xs text-[var(--mail-chrome-muted)]">
            <Highlighted text={thread.snippet} terms={highlight} onNavy={onNavy} />
          </span>
        ) : null}
      </span>
      {thread.hasAttachments ? (
        <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 stroke-[1.5] text-[var(--mail-chrome-muted)]" aria-hidden />
      ) : null}
      <span className="shrink-0 text-xs tabular-nums text-[var(--mail-list-muted)]">
        {rowTime(thread.lastAt, { withYear })}
      </span>
    </button>
  );
}

/**
 * An open stack's threads, newest first, under the person's row: in from
 * the left as far as the name.
 */
export function StackThreads({
  threads,
  isOpen,
  onOpen,
  onExpand,
  onNavy,
  highlight,
  withYear,
}: {
  threads: MailThreadSummary[];
  isOpen: (t: MailThreadSummary) => boolean;
  onOpen: (t: MailThreadSummary) => void;
  onExpand?: (t: MailThreadSummary) => void;
  onNavy: boolean;
  highlight: string[] | undefined;
  withYear: boolean;
}) {
  return (
    // The words start where the person's name does: the row's padding, the
    // 36px face and its 12px gap, less the thread row's own 16px.
    <div className="mb-1 ml-[60px] mr-[18px]">
      {threads.map((th) => (
        <StackThreadRow
          key={`${th.account}|${th.threadId}`}
          thread={th}
          active={isOpen(th)}
          onOpen={() => onOpen(th)}
          onExpand={onExpand ? () => onExpand(th) : undefined}
          onNavy={onNavy}
          highlight={highlight}
          withYear={withYear}
        />
      ))}
    </div>
  );
}

/**
 * What a person's row says by the name: "4 threads" for a stack, and for a
 * single thread how many mails it holds, as a thread row and Gmail say it.
 */
export function PersonCount({
  threads,
  open,
}: {
  threads: MailThreadSummary[];
  open: boolean;
}) {
  const t = useMailT();
  if (threads.length > 1) return <StackCount count={threads.length} open={open} />;
  const only = threads[0];
  if (!only) return null;
  return <ThreadMessageCount count={only.messageCount} label={t("threadMailsCount", { count: only.messageCount })} />;
}

/**
 * A person's row in the wide list, as a reader scans it. One thread: its
 * subject, who and how many mails, and its first words under. A stack: the
 * person and "4 threads", and its threads' subjects under, one after the
 * other.
 */
export function PersonWideBody({
  name,
  threads,
  open,
  hasDraft,
  hasFile,
  highlight,
  onNavy,
  time,
}: {
  name: string;
  threads: MailThreadSummary[];
  open: boolean;
  hasDraft: boolean;
  hasFile: boolean;
  highlight: string[] | undefined;
  onNavy: boolean;
  /** The date, with the hidden-account eye before it when there is one. */
  time: React.ReactNode;
}) {
  const newest = threads[0];
  const stack = threads.length > 1;
  const strong = "min-w-0 shrink truncate font-semibold text-[var(--mail-chrome-fg)]";
  return (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-sm">
          {stack ? (
            <span className={strong}>
              <Highlighted text={name} terms={highlight} onNavy={onNavy} />
            </span>
          ) : (
            <>
              <span className={strong}>
                <Highlighted text={newest.subject} terms={highlight} onNavy={onNavy} />
              </span>
              <span className="min-w-0 max-w-[40%] shrink-0 truncate text-[var(--mail-chrome-muted)]">
                <Highlighted text={name} terms={highlight} onNavy={onNavy} />
              </span>
            </>
          )}
          <PersonCount threads={threads} open={open} />
          {hasDraft ? <DraftBadge /> : null}
        </span>
        <span className="block truncate text-[13px] text-[var(--mail-chrome-muted)]">
          {hasFile ? (
            <Paperclip className="mr-1 inline h-3 w-3 -translate-y-px stroke-[1.5] opacity-80" aria-hidden />
          ) : null}
          <Highlighted
            text={stack ? threads.map((th) => th.subject).join(" · ") : newest.snippet}
            terms={highlight}
            onNavy={onNavy}
          />
        </span>
      </span>
      {/* Away on hover, keeping its room: the actions float over it. */}
      <span className="w-[4.5rem] shrink-0 text-right text-xs tabular-nums text-[var(--mail-list-muted)] group-hover:invisible">
        {time}
      </span>
    </span>
  );
}
