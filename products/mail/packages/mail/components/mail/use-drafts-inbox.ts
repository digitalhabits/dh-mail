"use client";

/**
 * Make the drafts another program left in the drafts folder
 * (mail_native::drafts_inbox, lib/mail/drafts-inbox): when Mail starts,
 * when its window comes forward, and every few seconds while it is open.
 * Each lands in Drafts; one that cannot be made goes back to the folder's
 * `not-made` with the reason.
 *
 * A reply to a thread that already has a draft is not made: the draft there
 * is the person's own, and a program does not write over it.
 */

import * as React from "react";

import { draftFromInbox } from "@/lib/mail/drafts-inbox";
import { mailSay } from "@/lib/mail/i18n";
import {
  getDraft,
  newComposeDraftKey,
  setDraft,
  threadDraftKey,
  type DraftAttachmentSnapshot,
} from "@/lib/mail/local-drafts";
import { toast } from "@/lib/mail/toast";

const LOOK_EVERY_MS = 5000;

type AttachmentFile = { filename: string; mimeType: string; contentBase64: string };
type Waiting = { name: string; draft: unknown; attachmentFiles?: AttachmentFile[] };

/** The files Mail read for a draft, as the composer keeps attachments. */
function attachmentsOf(item: Waiting, key: string): DraftAttachmentSnapshot[] {
  return (item.attachmentFiles ?? []).map((file, index) => ({
    id: `${key}-file-${index}`,
    filename: file.filename,
    mimeType: file.mimeType,
    size: Math.floor((file.contentBase64.length * 3) / 4),
    progress: null,
    contentBase64: file.contentBase64,
  }));
}
type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function tauriInvoke(): Invoke | null {
  const core = (window as unknown as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core;
  return core?.invoke ?? null;
}

/**
 * What the toast's button opens: the one draft just made, or (null) the
 * Drafts list when several were.
 */
export type MadeDraft =
  | { kind: "thread"; account: string; threadId: string }
  | { kind: "compose"; key: string; to: string[]; subject: string };

export function useDraftsInbox(
  accounts: readonly string[],
  openMade: (made: MadeDraft | null) => void
) {
  const accountsRef = React.useRef(accounts);
  accountsRef.current = accounts;
  const openMadeRef = React.useRef(openMade);
  React.useEffect(() => {
    openMadeRef.current = openMade;
  });

  React.useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return;
    let busy = false;
    let stopped = false;

    const reject = (item: Waiting, reason: string) =>
      invoke("reject_drafts_inbox", { name: item.name, draft: item.draft, reason }).catch(() => {});

    const look = async () => {
      // Not before the mailboxes are known: every draft would be refused.
      if (busy || stopped || !accountsRef.current.length) return;
      busy = true;
      try {
        const waiting = ((await invoke("take_drafts_inbox")) as Waiting[] | null) ?? [];
        let made = 0;
        let last: MadeDraft | null = null;
        for (const item of waiting) {
          const result = draftFromInbox(item.draft, accountsRef.current);
          if (!result.ok) {
            await reject(item, result.reason);
            toast.error(mailSay("draftsInboxNotMade", { reason: result.reason }));
            continue;
          }
          const draft = result.draft;
          if (draft.kind === "thread") {
            const key = threadDraftKey(draft.account, draft.threadId);
            if (await getDraft(key)) {
              const reason = "That thread already has a draft in Mail. Finish or discard it first.";
              await reject(item, reason);
              toast.error(mailSay("draftsInboxNotMade", { reason }));
              continue;
            }
            await setDraft({ ...draft, key, attachments: attachmentsOf(item, key), updatedAt: Date.now() });
            last = { kind: "thread", account: draft.account, threadId: draft.threadId };
          } else {
            const key = newComposeDraftKey();
            await setDraft({ ...draft, key, attachments: attachmentsOf(item, key), updatedAt: Date.now() });
            last = {
              kind: "compose",
              key,
              to: draft.toList.map((r) => (r.kind === "email" ? r.email : "")).filter(Boolean),
              subject: draft.subject,
            };
          }
          made += 1;
        }
        if (made) {
          const target = made === 1 ? last : null;
          toast(mailSay(made === 1 ? "draftsInboxMadeOne" : "draftsInboxMade", { count: made }), {
            action: {
              label: mailSay(made === 1 ? "draftsInboxOpenOne" : "draftsInboxOpenAll"),
              onClick: () => openMadeRef.current(target),
            },
          });
        }
      } catch (err) {
        console.warn("[mail] could not read the drafts folder:", err);
      } finally {
        busy = false;
      }
    };

    void look();
    const timer = window.setInterval(() => void look(), LOOK_EVERY_MS);
    const onFocus = () => void look();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
