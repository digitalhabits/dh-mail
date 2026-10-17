"use client";

import * as React from "react";
import { findLinksInText, linkLabel } from "@/lib/linkify-urls";

const LINK_CLASS =
  "break-all font-medium text-teal-700 underline underline-offset-2 hover:text-teal-900";

/**
 * Replaces raw URLs with short clickable links (full URL in the tooltip), and
 * email addresses with `mailto:` links.
 *
 * An address opens the reader's own mail client by default. Pass
 * `onEmailClick` where the app can write the message itself — mail does, and
 * opens its composer instead.
 */
export function LinkifiedText({
  text,
  onEmailClick,
}: {
  text: string;
  onEmailClick?: (address: string) => void;
}) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const { start, end, href, kind, address } of findLinksInText(text)) {
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      kind === "email" ? (
        <a
          key={`${start}-${href}`}
          href={href}
          title={address}
          className={LINK_CLASS}
          onClick={
            onEmailClick
              ? (e) => {
                  e.preventDefault();
                  onEmailClick(address ?? "");
                }
              : undefined
          }
        >
          {text.slice(start, end)}
        </a>
      ) : (
        <a
          key={`${start}-${href}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          title={href}
          className={LINK_CLASS}
        >
          {linkLabel(href)}
        </a>
      )
    );
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
