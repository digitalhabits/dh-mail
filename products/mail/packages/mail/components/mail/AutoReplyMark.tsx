"use client";

import { Reply } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The mark a mailbox wears while its out-of-office reply is on.
 *
 * A reply arrow, because that is what the mailbox is doing on its own: every
 * message that arrives gets answered without the reader. It sits on the
 * mailbox's own tab, so the answer to "which of these is away?" is on the
 * thing being asked about rather than in a sentence elsewhere — and the line
 * above the tabs uses the same mark, so the two read as one thing said twice.
 */
export function AutoReplyMark({ className }: { className?: string }) {
  return (
    <Reply
      className={cn("text-[var(--mail-autoreply)]", className)}
      aria-hidden
    />
  );
}

/**
 * The same mark as a badge on the corner of a mailbox tab: filled, so it
 * carries at the size a corner allows, where a line drawing would not.
 */
export function AutoReplyBadge({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[var(--mail-autoreply)] ring-2 ring-[var(--mail-segment-track)]"
    >
      <Reply className="h-2.5 w-2.5 text-[var(--mail-autoreply-fg)]" aria-hidden />
    </span>
  );
}
