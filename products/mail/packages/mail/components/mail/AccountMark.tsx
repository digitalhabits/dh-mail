"use client";

/**
 * The mark on a mailbox tab: whose mail this is.
 *
 * Three answers, in order. The picture the reader chose for this address, if
 * they chose one. Otherwise the provider's mark, which says Gmail or Outlook
 * at a glance and is what most readers want on a personal address. Otherwise
 * a plain envelope, for a mailbox whose provider we have not been told yet.
 *
 * The two brand marks are drawn here rather than shipped as files, so the
 * mirror carries no logo of anybody else's as an asset. They are the shapes
 * as everyone knows them: the coloured M in a white envelope, and the blue
 * square with the O.
 */

import { Mail } from "lucide-react";
import type { MailProvider } from "@/lib/mail/types";

import { cn } from "@/lib/utils";

function GmailMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      focusable="false"
    >
      <path fill="#fff" d="M3 6.5h18v11H3z" />
      <path fill="#4285f4" d="M22.5 19.5h-3V8.6l3-2.2z" />
      <path fill="#34a853" d="M4.5 19.5h-3V6.4l3 2.2z" />
      <path fill="#ea4335" d="M1.5 6.4V5a1.6 1.6 0 0 1 2.6-1.3L12 9.6l7.9-5.9A1.6 1.6 0 0 1 22.5 5v1.4L12 14.2z" />
      <path fill="#fbbc04" d="M22.5 5v1.4L12 14.2 1.5 6.4V5a1.6 1.6 0 0 1 .3-1l10.2 7.6L22.2 4a1.6 1.6 0 0 1 .3 1z" opacity=".85" />
      <path
        fill="none"
        stroke="#dadce0"
        strokeWidth=".6"
        d="M4.5 19.5h15a3 3 0 0 0 3-3V5a1.6 1.6 0 0 0-2.6-1.3L12 9.6 4.1 3.7A1.6 1.6 0 0 0 1.5 5v11.5a3 3 0 0 0 3 3Z"
      />
    </svg>
  );
}

function OutlookMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      focusable="false"
    >
      <rect x="1.5" y="3" width="21" height="18" rx="3" fill="#0f6cbd" />
      <path
        fill="#fff"
        d="M14.6 7.4h5.6a.8.8 0 0 1 .8.8v7.6a.8.8 0 0 1-.8.8h-5.6z"
        opacity=".45"
      />
      <path
        fill="#fff"
        d="M9 7.6c2 0 3.4 1.7 3.4 4.4S11 16.4 9 16.4 5.6 14.7 5.6 12 7 7.6 9 7.6Zm0 1.7c-1 0-1.6.9-1.6 2.7s.6 2.7 1.6 2.7 1.6-.9 1.6-2.7-.6-2.7-1.6-2.7Z"
      />
    </svg>
  );
}

/**
 * The Apple mark, for the address book the Mac keeps.
 *
 * "Contacts" on its own is the name of about four things a reader might have
 * — the CRM's, Google's, Outlook's, and the Mac's — and the badge that said
 * it meant the last of those. The apple says which without a longer word.
 */
export function AppleMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("h-3 w-3 shrink-0", className)}
      fill="currentColor"
      aria-hidden
      focusable="false"
    >
      <path d="M16.4 12.6c0-2.2 1.8-3.3 1.9-3.3-1-1.5-2.6-1.7-3.2-1.7-1.4-.1-2.7.8-3.3.8-.7 0-1.7-.8-2.8-.8-1.5 0-2.8.9-3.6 2.2-1.5 2.6-.4 6.5 1.1 8.6.7 1 1.6 2.2 2.7 2.2 1.1 0 1.5-.7 2.8-.7s1.6.7 2.8.7c1.1 0 1.9-1 2.6-2.1.8-1.2 1.2-2.4 1.2-2.4s-2.2-.9-2.2-3.5Z" />
      <path d="M14.3 6.3c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-.9 2.6 1 .1 2-.5 2.6-1.2Z" />
    </svg>
  );
}

export function AccountMark({
  /** The reader's own picture for this mailbox, as a data URL. */
  mark,
  provider,
  className,
}: {
  mark?: string;
  provider: MailProvider | "unknown";
  className?: string;
}) {
  const size = cn("h-4 w-4 shrink-0", className);
  if (mark) {
    return (
      <img
        src={mark}
        alt=""
        aria-hidden
        className={cn(size, "rounded-[3px] object-cover")}
      />
    );
  }
  if (provider === "gmail") return <GmailMark className={size} />;
  if (provider === "outlook") return <OutlookMark className={size} />;
  return <Mail className={cn(size, "text-stone-400")} aria-hidden />;
}
