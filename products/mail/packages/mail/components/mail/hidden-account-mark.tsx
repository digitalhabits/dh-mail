"use client";

import * as React from "react";
import { EyeOff, Plus } from "lucide-react";

import { useMailT } from "@/lib/mail/i18n";

/**
 * The accounts hidden from Mail, lower case, for the rows of the list.
 *
 * Their mail still turns up in Sent and in a search (use-thread-list-data),
 * and a row of theirs says so, the way a paperclip says a thread carries a
 * file: without it, a result from a hidden account looked like mail the
 * reader had chosen to see (Ulrik, 2026-10-20).
 */
export const HiddenAccountsContext = React.createContext<ReadonlySet<string>>(new Set());

/**
 * A closed eye before a row's date, on a row from a hidden account: one
 * thread's `account`, or a person's `accounts` (any of them hidden). By the
 * date, quiet: it says where a hit came from, and the hover names the
 * account (Ulrik's design, 2026-10-20).
 */
export function HiddenAccountMark({ account, accounts }: { account?: string; accounts?: string[] }) {
  const hidden = React.useContext(HiddenAccountsContext);
  const t = useMailT();
  const list = accounts ?? (account ? [account] : []);
  const from = [...new Set(list.filter((a) => hidden.has(a.toLowerCase())))];
  if (!from.length) return null;
  const title = `${t("fromHiddenAccount")}: ${from.join(", ")}`;
  return (
    <span className="mr-1.5 inline-flex shrink-0 align-[-2px]" title={title}>
      <EyeOff className="h-3.5 w-3.5 stroke-[1.5] text-[var(--mail-chrome-muted)] opacity-80" aria-label={title} />
    </span>
  );
}

/** Whether a search is running that reaches hidden accounts: the chip shows. */
export function hiddenSearchChipShown(search: string, hidden: { count: number; on: boolean }): boolean {
  return Boolean(search.trim()) && hidden.on && hidden.count > 0;
}

/**
 * "+ 👁 3 hidden" in the search field, while a search reaches the hidden
 * accounts: their hits are in the list, and the field says so. A click
 * opens the search menu, where they are turned off and on. No × of its
 * own: one more thing to aim at beside the field's own clear button.
 */
export function HiddenSearchChip({
  count,
  onOpenOptions,
}: {
  count: number;
  /** A click on the chip opens the search menu, where the choice is. */
  onOpenOptions: () => void;
}) {
  const t = useMailT();
  return (
    <span
      role="button"
      tabIndex={0}
      className="absolute right-8 flex h-6 cursor-pointer items-center gap-1 rounded-full bg-[var(--mail-chrome-hover)] px-2 text-xs text-[var(--mail-chrome-muted)] hover:text-[var(--mail-chrome-fg)]"
      title={t("hiddenIncludedTitle")}
      // The chip is inside the search field's <label>, which passes a click
      // on to its first control, the chevron: that click shut the menu the
      // chip had just opened. preventDefault stops the label doing so.
      onClick={(e) => {
        e.preventDefault();
        onOpenOptions();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenOptions();
        }
      }}
    >
      <Plus className="h-3 w-3" aria-hidden />
      <EyeOff className="h-3.5 w-3.5 stroke-[1.5]" aria-hidden />
      <span className="whitespace-nowrap">{t("hiddenCount", { count })}</span>
    </span>
  );
}
