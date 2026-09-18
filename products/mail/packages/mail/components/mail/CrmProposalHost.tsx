"use client";

/**
 * The Update CRM dialog, and the ask that fills it.
 *
 * Kept here, above the thread pane, and not in it. The pane is made again for
 * every thread the reader opens, and a dialog that lived in the pane went
 * with it: a reader who opened another message to check a proposal lost the
 * proposals, and the edits they had made. So the ask runs here and writes
 * here, and the dialog stays until Skip or Apply.
 *
 * One dialog in a window. A new ask — from this thread or another — takes
 * the place of the dialog that is open.
 */

import * as React from "react";

import {
  CrmProposalDialog,
  type CrmProposeResult,
} from "@/components/mail/CrmProposalDialog";
import { attachmentUrl } from "@/components/mail/MailAttachments";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { readAttachmentText } from "@/lib/mail/attachment-text";
import { threadKey } from "@/lib/mail/thread-copies";
import { toast } from "@/lib/mail/toast";
import { notifyPlannerCrmChanged } from "@/lib/native-shell";

/** The thread the proposals were read from. */
export type CrmProposalOrigin = { account: string; threadId: string };

/** A PDF in the thread, which the reader may give the AI as background. */
export type CrmReadableAttachment = {
  messageId: string;
  filename: string;
  mimeType: string;
  attachmentId: string;
};

type CrmProposalState = {
  origin: CrmProposalOrigin;
  loading: boolean;
  /** What is happening now, when it is not the model: "Reading x.pdf…". */
  stage?: string;
  result: CrmProposeResult | null;
  hint?: string;
  attachments: CrmReadableAttachment[];
  attachmentsIncluded: boolean;
  /**
   * Which dialog this is. A new ask opens a new one, with its ticks and edits
   * fresh; asking again with the PDFs keeps the one that is open.
   */
  dialog: number;
};

let state: CrmProposalState | null = null;
let run: AbortController | null = null;
let dialogs = 0;
const listeners = new Set<() => void>();

function publish(next: CrmProposalState | null): void {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

const snapshot = () => state;
const serverSnapshot = () => null;

function sameThread(a: CrmProposalOrigin, b: CrmProposalOrigin): boolean {
  return threadKey(a) === threadKey(b);
}

/**
 * End the ask in flight. Closing used to leave it going: the dialog went,
 * and the answer came to nobody. A reader who closes a thing that is working
 * means stop.
 */
function stop(): void {
  run?.abort();
  run = null;
}

export function closeCrmProposal(): void {
  stop();
  publish(null);
}

/**
 * Show proposals that are already made. A send with the Update CRM switch on
 * comes back with them, so there is nothing to wait for.
 */
export function showCrmProposal(
  origin: CrmProposalOrigin,
  result: CrmProposeResult,
  attachments: CrmReadableAttachment[] = []
): void {
  stop();
  publish({
    origin,
    loading: false,
    result,
    attachments,
    attachmentsIncluded: false,
    dialog: ++dialogs,
  });
}

/**
 * ✨: ask the planner what this thread changes, and show the proposals.
 * Nothing is written until the reader applies. The thread's participants,
 * the addresses in its text and, failing those, the AI's guess decide which
 * records it is about — so a forward from yourself works too.
 */
export async function proposeCrmFromThread({
  account,
  threadId,
  hint,
  includeAttachments = false,
  attachments,
}: CrmProposalOrigin & {
  hint?: string;
  includeAttachments?: boolean;
  attachments: CrmReadableAttachment[];
}): Promise<void> {
  stop();
  const mine = new AbortController();
  run = mine;
  const origin = { account, threadId };
  const include = includeAttachments && attachments.length > 0;
  const again = include && state !== null && sameThread(state.origin, origin);
  const base = {
    origin,
    hint,
    attachments,
    attachmentsIncluded: include,
    dialog: again && state ? state.dialog : ++dialogs,
  };
  // Only the ask on screen writes. One that was stopped, or replaced by a
  // newer ask, ends without a word.
  const show = (now: Pick<CrmProposalState, "loading" | "result" | "stage">) => {
    if (run === mine) publish({ ...base, ...now });
  };

  show({ loading: true, result: null });
  try {
    // Opt-in: the reader chose to give the AI the thread's PDFs. The text
    // comes out in this webview; only the text goes to the planner.
    let texts: { filename: string; text: string }[] | undefined;
    if (include) {
      texts = [];
      const picked = attachments.slice(0, 3);
      for (const [i, a] of picked.entries()) {
        show({
          loading: true,
          result: null,
          stage: `Reading ${a.filename} (${i + 1} of ${picked.length})…`,
        });
        try {
          const text = await readAttachmentText(
            attachmentUrl({
              account,
              messageId: a.messageId,
              attachment: {
                attachmentId: a.attachmentId,
                filename: a.filename,
                mimeType: a.mimeType,
                size: 0,
              },
            }),
            a.mimeType
          );
          if (text?.trim()) texts.push({ filename: a.filename, text });
        } catch (err) {
          toast.error(
            `Couldn't read ${a.filename}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        if (mine.signal.aborted) return;
      }
      show({ loading: true, result: null });
    }
    // Two calls: the match is a second, the model is longer. The dialog
    // says what the thread is about as soon as the first answers.
    const matched = await apiJson<CrmProposeResult>("/api/mail/crm-propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, threadId, phase: "match" }),
      signal: mine.signal,
    });
    show({ loading: true, result: matched });
    const result = await apiJson<CrmProposeResult>("/api/mail/crm-propose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account, threadId, hint, attachments: texts }),
      signal: mine.signal,
    });
    show({ loading: false, result });
  } catch (err) {
    // Stopped, not failed: the reader closed it, and has nothing to read
    // about a thing they asked to end.
    if (mine.signal.aborted) return;
    show({
      loading: false,
      result: {
        candidates: [],
        proposals: [],
        statusOptions: {},
        dropped: [],
        error: err instanceof Error ? err.message : "Couldn't ask the AI",
      },
    });
  } finally {
    if (run === mine) run = null;
  }
}

/** Whether the AI is still reading this thread for the CRM. */
export function useCrmProposing(account: string, threadId: string): boolean {
  const current = React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return Boolean(current?.loading && sameThread(current.origin, { account, threadId }));
}

/**
 * The dialog, for whichever pane in this window asked.
 *
 * Mount one in each window, above anything that is made again per thread.
 * The window says what applying means for the thread the proposals came
 * from — which is not always the thread on screen now.
 */
export function CrmProposalHost({
  onCrmChanged,
  onArchive,
}: {
  /** Proposals went in for this thread. */
  onCrmChanged: (origin: CrmProposalOrigin) => void;
  /** The reader asked for this thread to be filed away after applying. */
  onArchive: (origin: CrmProposalOrigin) => void;
}) {
  const current = React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  // A window that goes away takes its dialog and its ask with it.
  React.useEffect(() => closeCrmProposal, []);

  if (!current) return null;
  const { origin } = current;

  return (
    <CrmProposalDialog
      key={current.dialog}
      loading={current.loading}
      stage={current.stage}
      result={current.result}
      attachmentCount={current.attachments.length}
      attachmentsIncluded={current.attachmentsIncluded}
      onIncludeAttachments={() =>
        void proposeCrmFromThread({
          ...origin,
          hint: current.hint,
          includeAttachments: true,
          attachments: current.attachments,
        })
      }
      onClose={closeCrmProposal}
      onApplied={(applied, { archive }) => {
        if (!applied) return;
        onCrmChanged(origin);
        void notifyPlannerCrmChanged();
        // The thread's work is done, so it leaves the inbox — after the
        // changes are in, never instead of them.
        if (archive) onArchive(origin);
      }}
    />
  );
}
