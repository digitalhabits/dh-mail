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
}: {
  includeDeleted: boolean;
  onIncludeDeletedChange: (next: boolean) => void;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("searchOptions")}
          aria-label={t("searchOptions")}
          className={cn(
            "ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            // Lit while it is doing something, so a search that reaches into
            // deleted mail says so without being opened.
            includeDeleted
              ? "bg-teal-50 text-teal-700"
              : "text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          )}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <MailPopoverContent align="start" className="w-64 p-1">
        <button
          type="button"
          role="checkbox"
          aria-checked={includeDeleted}
          onClick={() => onIncludeDeletedChange(!includeDeleted)}
          className="flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm text-stone-800 hover:bg-stone-100"
        >
          <span className="min-w-0 flex-1">{t("includeDeleted")}</span>
          <span
            aria-hidden
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              includeDeleted
                ? "border-teal-600 bg-teal-600 text-white"
                : "border-stone-300"
            )}
          >
            {includeDeleted ? <Check className="h-3 w-3" /> : null}
          </span>
        </button>
      </MailPopoverContent>
    </Popover>
  );
}
