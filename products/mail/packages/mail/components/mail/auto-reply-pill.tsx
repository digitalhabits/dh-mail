"use client";

/*
 * The auto-reply notice: a pill in the title bar, after Sync.
 *
 * A pill, not a band: the auto-reply is a thing the reader turned on
 * themselves, and each account tab already carries its arrow. So this says
 * that it is on, and a click is the way in to change it.
 *
 * It stood at the head of the list until 2026-10-27, where it pushed the
 * account row and the tabs down, out of line with the reader's toolbar and
 * its title. In the title bar it moves nothing.
 *
 * The hover says which accounts, each with its own end date.
 */

import { autoReplyActive } from "@/components/mail/AutoReplyDialog";
import { AutoReplyMark } from "@/components/mail/AutoReplyMark";
import { usePageAccounts, usePageCompose } from "@/components/mail/mail-page-slices";
import { formatAccountChipLabel } from "@/lib/mail/account-labels";
import { currentMailLocale, useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

export function AutoReplyPill({ onDark = false }: { onDark?: boolean }) {
  const t = useMailT();
  const { accountLabels, autoReplies } = usePageAccounts();
  const { openAutoReply } = usePageCompose();
  const on = autoReplies.filter((a) => autoReplyActive(a));
  if (!on.length) return null;
  const day = (at: number) =>
    new Date(at - 1).toLocaleDateString(currentMailLocale(), { day: "numeric", month: "short" });
  const who =
    on.length === 1
      ? formatAccountChipLabel(on[0].account, accountLabels)
      : t("autoReplyAccounts", { count: on.length });
  const detail = on
    .map(
      (a) =>
        formatAccountChipLabel(a.account, accountLabels) +
        (a.endTime !== null ? ` ${t("outOfOfficeUntil", { date: day(a.endTime) })}` : "")
    )
    .join(", ");
  return (
    <button
      type="button"
      data-auto-reply-pill
      title={`${t("autoReplyOnFor", { who })}: ${detail} — ${t("manage")}`}
      // Several on: the All tab, where they are managed together.
      onClick={() => openAutoReply(on.length > 1 ? null : on[0].account)}
      className={cn(
        // It gives way to the search field: the words are cut short, down
        // to the arrow alone, whose hover still says it all.
        "flex h-7 min-w-[2.25rem] shrink items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium",
        onDark
          ? "bg-white/10 text-[var(--mail-chrome-fg)] hover:bg-white/15"
          : "bg-stone-200/60 text-stone-700 hover:bg-stone-200"
      )}
    >
      <AutoReplyMark className="h-3.5 w-3.5 shrink-0" />
      {/* Only that it is on: the dates are in the hover, account by
          account, and the dialog. */}
      <span className="mail-tb-label min-w-0 truncate">{t("autoReplyOn")}</span>
    </button>
  );
}
