"use client";

/**
 * Make the drafts another program left in the drafts folder
 * (mail_native::drafts_inbox, lib/mail/drafts-inbox): when Mail starts,
 * when its window comes forward, when the app's own watch says a file
 * waits, and every few seconds while it is open. Each lands in Drafts, and
 * `made/<file>` gets a receipt: the draft's key, mailbox, subject and
 * fingerprint (lib/mail/agent-drafts). One that cannot be made goes back to
 * the folder's `not-made` with the reason.
 *
 * The watch is the app's, not this page's: a window in the background
 * slows its page's timers down, and a draft waited there for most of a
 * minute.
 *
 * A draft may be from any connected mailbox, a hidden one too, read from
 * the store each time. Until the store has answered, nothing is taken, so
 * nothing is refused for a list that is still loading.
 *
 * A file with a `"request"` field is not a draft: it goes to the team
 * layer, which answers it in `answers/<file>` (or says it cannot).
 *
 * A forward also gets the files of the message it carries, as a person's
 * forward does (forward-draft-parts).
 *
 * A reply to a thread that already has a draft is not made: the draft there
 * is the person's own, and a program does not write over it.
 */

import * as React from "react";

import { forwardDraftParts } from "@/components/mail/forward-draft-parts";
import { handleDraftsFolderRequest } from "@/components/mail/team-layer";
import { connectedAccountEmails, draftFingerprint, draftPreview } from "@/lib/mail/agent-drafts";
import { draftFromInbox } from "@/lib/mail/drafts-inbox";
import { mailSay } from "@/lib/mail/i18n";
import {
  getDraft,
  newComposeDraftKey,
  setDraft,
  threadDraftKey,
  type DraftAttachmentSnapshot,
  type MailDraft,
} from "@/lib/mail/local-drafts";
import { mailStore } from "@/lib/mail/store";
import type { MailStoreProvider } from "@/lib/mail/store/types";
import { toast } from "@/lib/mail/toast";

const LOOK_EVERY_MS = 5000;
/** What the app's watch says when a file waits (drafts_inbox.rs). */
const WAITING_EVENT = "drafts-inbox-waiting";
const PROVIDERS: MailStoreProvider[] = ["gmail", "outlook", "exchange"];

/** Every mailbox connected for this owner, hidden ones too. */
async function storeAccounts(ownerId: string): Promise<string[]> {
  const rows = await Promise.all(PROVIDERS.map((p) => mailStore().accounts.listForOwner(p, ownerId)));
  return connectedAccountEmails(rows.flat());
}

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
type Listen = (name: string, cb: () => void) => Promise<() => void>;
type Tauri = { core?: { invoke?: Invoke }; event?: { listen?: Listen } };

function tauri(): Tauri | null {
  return (window as unknown as { __TAURI__?: Tauri }).__TAURI__ ?? null;
}

function isRequest(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && "request" in raw);
}

/** What `made/<file>` says about a draft just made. */
function receiptOf(draft: MailDraft) {
  const preview = draftPreview(draft);
  return {
    key: draft.key,
    account: preview.from,
    subject: preview.subject,
    ...(draft.kind === "thread" ? { threadId: draft.threadId } : null),
    fingerprint: draftFingerprint(draft),
    madeAt: new Date(draft.updatedAt).toISOString(),
  };
}

/**
 * What the toast's button opens: the one draft just made, or (null) the
 * Drafts list when several were.
 */
export type MadeDraft =
  | { kind: "thread"; account: string; threadId: string }
  | { kind: "compose"; key: string; to: string[]; subject: string };

export function useDraftsInbox(
  ownerId: string,
  openMade: (made: MadeDraft | null) => void,
  refreshDrafts: () => void
) {
  const openMadeRef = React.useRef(openMade);
  const refreshRef = React.useRef(refreshDrafts);
  React.useEffect(() => {
    openMadeRef.current = openMade;
    refreshRef.current = refreshDrafts;
  });

  React.useEffect(() => {
    const bridge = tauri();
    const invoke = bridge?.core?.invoke;
    if (!invoke) return;
    let busy = false;
    let stopped = false;

    const reject = (item: Waiting, reason: string) =>
      invoke("reject_drafts_inbox", { name: item.name, draft: item.draft, reason }).catch(() => {});
    const note = (kind: "made" | "answers", name: string, body: Record<string, unknown>) =>
      invoke("note_drafts_inbox", { kind, name, body }).then(() => {});

    const look = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        // Not before the mailboxes are known: every draft would be refused.
        const accounts = await storeAccounts(ownerId).catch(() => [] as string[]);
        if (!accounts.length) return;
        const waiting = ((await invoke("take_drafts_inbox")) as Waiting[] | null) ?? [];
        let made = 0;
        let last: MadeDraft | null = null;
        for (const item of waiting) {
          if (isRequest(item.draft)) {
            // Not awaited: a send waits out its Undo window, and drafts
            // left meanwhile are not held up by it.
            void handleDraftsFolderRequest(
              { name: item.name, request: item.draft, attachmentFiles: item.attachmentFiles ?? [] },
              { accounts, answer: (body) => note("answers", item.name, body), refreshDrafts: () => refreshRef.current() }
            ).catch((err: unknown) =>
              note("answers", item.name, { ok: false, error: err instanceof Error ? err.message : String(err) })
            );
            continue;
          }
          const result = draftFromInbox(item.draft, accounts);
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
            // A forward carries its message's files, fetched now (forward-draft-parts).
            const forward = draft.mode === "forward" ? await forwardDraftParts(draft, key) : null;
            if (forward && !forward.ok) {
              await reject(item, forward.reason);
              toast.error(mailSay("draftsInboxNotMade", { reason: forward.reason }));
              continue;
            }
            const saved: MailDraft = {
              ...draft,
              ...(forward ? { subject: forward.subject } : null),
              key,
              attachments: [...(forward?.files ?? []), ...attachmentsOf(item, key)],
              updatedAt: Date.now(),
            };
            await setDraft(saved);
            await note("made", item.name, receiptOf(saved)).catch(() => {});
            last = { kind: "thread", account: draft.account, threadId: draft.threadId };
          } else {
            const key = newComposeDraftKey();
            const saved: MailDraft = { ...draft, key, attachments: attachmentsOf(item, key), updatedAt: Date.now() };
            await setDraft(saved);
            await note("made", item.name, receiptOf(saved)).catch(() => {});
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
    let unlisten: (() => void) | null = null;
    void bridge?.event?.listen?.(WAITING_EVENT, () => void look()).then((off) => {
      if (stopped) off();
      else unlisten = off;
    });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unlisten?.();
    };
  }, [ownerId]);
}
