"use client";

import { Reply } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The mark a mailbox wears while its out-of-office reply is on.
 *
 * A reply arrow, because that is what the mailbox is doing on its own: every
 * message that arrives gets answered without the reader. It sits on the
 * mailbox's own tab, after its name, so the answer to "which of these is
 * away?" is on the thing being asked about rather than in a sentence
 * elsewhere — and the pill in the title bar uses the same mark, so the two
 * read as one thing said twice.
 */
export function AutoReplyMark({ className }: { className?: string }) {
  return (
    <Reply
      className={cn("text-[var(--mail-autoreply)]", className)}
      aria-hidden
    />
  );
}
