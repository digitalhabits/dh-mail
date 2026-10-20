"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

export function SearchOptionsMenu({
  includeDeleted,
  onIncludeDeletedChange,
  hiddenCount,
  includeHidden,
  onIncludeHiddenChange,
  ...props
}: {
  includeDeleted: boolean;
  onIncludeDeletedChange: (next: boolean) => void;
  /** How many mailboxes are hidden. The choice is offered only while one is. */
  hiddenCount: number;
  /** A search reaches the hidden mailboxes (on unless turned off). */
  includeHidden: boolean;
  onIncludeHiddenChange: (next: boolean) => void;
  /** Open from outside too: the hidden chip in the field opens it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const t = useMailT();
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = props.open ?? ownOpen;
  const setOpen = props.onOpenChange ?? setOwnOpen;
  /*
    Lit while it is doing something the reader may not expect: reaching
    into deleted mail, or leaving the hidden mailboxes out. The hidden ones
    are in by default, so their being in is no news.
  */
  const lit = includeDeleted || (hiddenCount > 0 && !includeHidden);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("searchOptions")}
          aria-label={t("searchOptions")}
          className={cn(
            "ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            lit
              ? "bg-teal-50 text-teal-700"
              : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          )}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <MailPopoverContent align="start" className="w-72 p-1">
        <OptionRow checked={includeDeleted} onChange={onIncludeDeletedChange}>
          {t("includeDeleted")}
        </OptionRow>
        {hiddenCount > 0 ? (
          <OptionRow checked={includeHidden} onChange={onIncludeHiddenChange}>
            {t("includeHiddenMailboxes")}
          </OptionRow>
        ) : null}
      </MailPopoverContent>
    </Popover>
  );
}

function OptionRow({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100"
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
          checked ? "border-teal-600 bg-teal-600 text-white" : "border-stone-300"
        )}
      >
        {checked ? <Check className="h-3 w-3" /> : null}
      </span>
    </button>
  );
}
