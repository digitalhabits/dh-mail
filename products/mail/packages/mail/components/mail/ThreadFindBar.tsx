"use client";

/**
 * The bar Cmd+F opens over the thread.
 *
 * Sits above the messages rather than pushing them down: a find that re-flows
 * what you are reading moves the thing you were looking for.
 */

import * as React from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

export function ThreadFindBar({
  query,
  onQueryChange,
  count,
  index,
  onNext,
  onPrev,
  onClose,
}: {
  query: string;
  onQueryChange: (next: string) => void;
  count: number;
  /** 1-based position of the current match; 0 when there are none. */
  index: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const t = useMailT();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const nothingFound = Boolean(query.trim()) && count === 0;

  return (
    <div
      role="search"
      className="absolute right-4 top-3 z-20 flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 shadow-md"
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        aria-label={t("findInThisThread")}
        placeholder={t("findInThread")}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            // Shift+Enter walks back, the way every other find bar does.
            if (e.shiftKey) onPrev();
            else onNext();
          }
        }}
        className={cn(
          "w-44 bg-transparent px-1 text-sm outline-none placeholder:text-stone-400",
          nothingFound && "text-rose-600"
        )}
      />
      <span
        aria-live="polite"
        className={cn(
          "min-w-[3.5rem] shrink-0 text-right text-xs tabular-nums",
          nothingFound ? "text-rose-500" : "text-stone-500"
        )}
      >
        {query.trim() ? (count ? t("matchOfCount", { index, count }) : t("none")) : ""}
      </span>
      <button
        type="button"
        aria-label={t("previousMatch")}
        disabled={!count}
        onClick={onPrev}
        className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronUp className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={t("nextMatch")}
        disabled={!count}
        onClick={onNext}
        className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label={t("closeFind")}
        onClick={onClose}
        className="rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
