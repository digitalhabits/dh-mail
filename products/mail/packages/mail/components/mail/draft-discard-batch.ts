"use client";

/*
 * Discarding several drafts at once, with a way back.
 *
 * The same terms as one draft (use-composer-home): ours are deleted now and
 * put back on Undo; the provider's copy is told to go only when the Undo has
 * run out, because a Gmail draft cannot be un-deleted.
 */

import { toast } from "@/lib/mail/toast";

import {
  draftRowKey,
  hideDraftRows,
  unhideDraftRows,
} from "@/components/mail/draft-selection-store";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { mailSay } from "@/lib/mail/i18n";
import { deleteDraft, getDraft, setDraft, type MailDraft } from "@/lib/mail/local-drafts";
import {
  cancelPendingDiscard,
  DISCARD_UNDO_MS,
  schedulePendingDiscard,
} from "@/lib/mail/pending-discard";
import type { MailDraftRow } from "@/lib/mail/types";

export async function discardDraftRows(
  rows: readonly MailDraftRow[],
  refresh: () => void
): Promise<void> {
  if (!rows.length) return;
  const keys = rows.map(draftRowKey);
  hideDraftRows(keys);
  const saved: MailDraft[] = [];
  const held: string[] = [];
  for (const row of rows) {
    if (row.origin === "here") {
      const draft = await getDraft(row.id).catch(() => null);
      if (draft) saved.push(draft);
      await deleteDraft(row.id);
      continue;
    }
    const holdKey = `drafts-view:${draftRowKey(row)}`;
    held.push(holdKey);
    schedulePendingDiscard(holdKey, () => {
      void apiJson("/api/mail/drafts/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: row.account,
          ref: row.id,
          threadId: row.threadId ?? undefined,
        }),
      })
        .catch((err) => {
          console.warn("[mail] could not discard the provider's draft:", err);
        })
        .finally(refresh);
    });
  }
  refresh();
  toast(
    rows.length === 1
      ? mailSay("draftDiscarded")
      : mailSay("draftsDiscardedCount", { count: rows.length }),
    {
      duration: DISCARD_UNDO_MS,
      action: {
        label: mailSay("undo"),
        onClick: () => {
          for (const key of held) cancelPendingDiscard(key);
          for (const draft of saved) void setDraft(draft);
          unhideDraftRows(keys);
          refresh();
        },
      },
    }
  );
}
