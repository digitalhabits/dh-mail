"use client";

import * as React from "react";

import { highlightRanges } from "@/lib/mail/search-highlight";
import { cn } from "@/lib/utils";

/**
 * A row's text with the search words marked, so a row found by a word in
 * its body still says why it is there. Plain text when there is nothing
 * to mark, so a list without a search costs nothing extra.
 */
export function Highlighted({
  text,
  terms,
  onNavy = false,
}: {
  text: string | null | undefined;
  terms?: string[];
  onNavy?: boolean;
}) {
  if (!text) return null;
  if (!terms?.length) return <>{text}</>;
  const ranges = highlightRanges(text, terms);
  if (!ranges.length) return <>{text}</>;
  const chars = Array.from(text);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(chars.slice(at, start).join(""));
    parts.push(
      <mark
        key={start}
        className={cn(
          "rounded-[2px] text-inherit",
          onNavy ? "bg-amber-300/25" : "bg-amber-200/70"
        )}
      >
        {chars.slice(start, end).join("")}
      </mark>
    );
    at = end;
  }
  if (at < chars.length) parts.push(chars.slice(at).join(""));
  return <>{parts}</>;
}
