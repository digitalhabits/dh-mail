/**
 * The mark-unread icon.
 *
 * Hand-drawn to match lucide, because lucide has no mail-unread: an envelope
 * with the "new" dot sitting on its corner. It lives on its own so the reader
 * and the list quick actions use the same one — the same action should not
 * look like two different actions.
 */

import * as React from "react";

/** Stale-while-revalidate cache so the Mail tab never opens blank. */
// v7: keyed by Clerk / local owner so admins never share inbox paint.
// ---------------------------------------------------------------------------
// People view (iMessage-style: one row per correspondent)
// ---------------------------------------------------------------------------
/** Lucide-style envelope with a "new" dot; no stock icon for mark-unread. */
export function MailDotIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M13.5 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6.5" />
      <path d="m2 8 8.97 5.7a1.94 1.94 0 0 0 2.06 0L19 9.9" />
      <circle cx="19.5" cy="4.5" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
