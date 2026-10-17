"use client";

/**
 * Edit on a scheduled message: a copy to work on, with the original left
 * where it is (docs/mail-send-later.md, 4.7).
 *
 * The composer opens with the words and the original's time on its Send
 * button, and nothing is cancelled. Discard the composer, and the original
 * still goes at its time. Send the edited one — at a time or now — and the
 * original is taken off first; if that fails, nothing new is sent, so the
 * two never both go.
 */

import { mailApiJson as apiJson } from "@/lib/mail/api";
import { mailSay } from "@/lib/mail/i18n-strings";
import type { MailScheduledMessage } from "@/lib/mail/types";
import { notifyScheduledChanged } from "@/lib/mail/scheduled-events";

/** The scheduled message an edit replaces. */
export type ScheduledOriginal = { account: string; id: string; sendAt: string };

/**
 * Take the original off. Throws when it could not be, or when it is no
 * longer there to take off — sent at its time while the edit was open, or
 * cancelled elsewhere. Then nothing new is sent: the reader decides.
 */
export async function takeOffScheduledOriginal(original: ScheduledOriginal): Promise<void> {
  const listed = await apiJson<{ messages?: MailScheduledMessage[] }>("/api/mail/scheduled");
  const key = original.account.trim().toLowerCase();
  const stillThere = (listed.messages ?? []).some(
    (m) => m.id === original.id && m.account.trim().toLowerCase() === key
  );
  if (!stillThere) throw new Error(mailSay("scheduledOriginalGone"));
  await apiJson("/api/mail/scheduled", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: original.account, id: original.id, action: "cancel" }),
  });
  notifyScheduledChanged();
}
