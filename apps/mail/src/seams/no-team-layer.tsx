/**
 * The team layer, which this app does not have.
 *
 * The shared interface reaches a few extra parts through one module,
 * `@/components/mail/team-layer`. This app resolves that name to this file.
 * Each part here draws nothing and does nothing, so the interface around
 * it is the whole app.
 *
 * The names must be the ones the interface imports. The types they share
 * are in `team-layer-types.ts`, beside the interface.
 */

import type {
  DraftAssistResult,
  DraftAssistWorking,
  ReadableThreadAttachment,
  TeamOrigin,
  TeamSendAnswer,
} from "@/components/mail/team-layer-types";

/** Mounted once in each window. Nothing to hold here. */
export function TeamLayerHost(_props: {
  onRecordsChanged: (origin: TeamOrigin) => void;
  onArchive: (origin: TeamOrigin) => void;
}): null {
  return null;
}

export function useTeamProposing(_account: string, _threadId: string): boolean {
  return false;
}

/** A menu on the thread's action strip. None here. */
export function ThreadAssistMenu(_props: {
  busy?: boolean;
  onPropose: (hint?: string) => void;
  onProposeDiary?: (hint?: string) => void;
}): null {
  return null;
}

export function ThreadDiaryDialog(_props: { proposal: unknown; onClose: () => void }): null {
  return null;
}

/** A menu beside the composer. None here. */
export function DraftAssistMenu(_props: {
  drafting: boolean;
  disabled?: boolean;
  onDraft: (hint: string) => void;
  onStop?: () => void;
  purpose?: "reply" | "compose" | "autoreply";
  variant?: "quiet" | "pill";
  className?: string;
}): null {
  return null;
}

/** A strip above the composer. None here. */
export function DraftAssistNotes(_props: {
  result: DraftAssistResult | null;
  working?: DraftAssistWorking;
  onDismiss: () => void;
  onStop?: () => void;
  onRestoreBrief?: (brief: string) => void;
  purpose?: "reply" | "compose";
}): null {
  return null;
}

/** A menu over the out-of-office message. None here. */
export function AutoReplyAssist(_props: {
  account: string;
  form: unknown;
  onDrafted: (draft: { subject: string; bodyHtml: string }) => void;
}): null {
  return null;
}

const nothing = () => {};
const nothingAsync = async () => {};

/**
 * The same object for every pane and every render: nothing in it changes,
 * so nothing that reads it has a reason to run again.
 */
const THREAD_ASSISTANT = {
  diaryBusy: false,
  diaryProposal: null,
  closeDiaryProposal: nothing,
  proposeDiaryFromThread: nothingAsync as (hint?: string) => Promise<void>,
  updateRecordsFromThread: nothing as (hint?: string) => void,
  draftingReply: false,
  draftNotes: null as DraftAssistResult | null,
  draftWorking: null as DraftAssistWorking,
  stopDraft: nothing,
  draftReplyWithAssist: nothingAsync as (hint: string) => Promise<void>,
  restoreDraftBrief: nothing as (brief: string) => void,
  dismissDraftNotes: nothing,
};

export function useThreadAssistant(_input: {
  account: string;
  threadId: string;
  thread: unknown;
  updatingRecords: boolean;
  readableAttachments: ReadableThreadAttachment[];
  replyText: string;
  replaceWords: (html: string) => void;
}): typeof THREAD_ASSISTANT {
  return THREAD_ASSISTANT;
}

const COMPOSE_ASSISTANT = {
  draftingReply: false,
  draftNotes: null as DraftAssistResult | null,
  setDraftNotes: nothing as (notes: DraftAssistResult | null) => void,
  draftWorking: null as DraftAssistWorking,
  stopDraft: nothing,
  draftComposeWithAssist: nothingAsync as (hint: string) => Promise<void>,
};

export function useComposeAssistant(_input: unknown): typeof COMPOSE_ASSISTANT {
  return COMPOSE_ASSISTANT;
}

export async function notifyTeamDataChanged(): Promise<boolean> {
  return false;
}

/** Only a send with the team layer's switch on calls this. */
export function afterTeamSend(
  _answer: TeamSendAnswer,
  _context: {
    origin: TeamOrigin;
    readableAttachments: ReadableThreadAttachment[];
    onApplied: () => void;
  }
): void {}
