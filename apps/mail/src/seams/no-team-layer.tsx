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
  DraftsFolderRequest,
  DraftsFolderRequestHost,
  DraftAssistResult,
  DraftAssistWorking,
  ReadableThreadAttachment,
  TeamOrigin,
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
  working?: DraftAssistWorking;
  disabled?: boolean;
  onDraft: (hint: string) => void;
  onStop?: () => void;
  purpose?: "reply" | "compose" | "autoreply";
  variant?: "quiet" | "pill";
  className?: string;
}): null {
  return null;
}

/** The records' follow-up after a send. None here. */
export function startTeamFollowUp(_input: {
  origin: { account: string; threadId: string };
  sent: { to: string[]; cc?: string[]; subject: string; body: string };
  attachments: ReadableThreadAttachment[];
}): void {}

/** A box beside the composer's menu. None here. */
export function SendFollowUpToggle(_props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
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
  recipientState: unknown;
  ownsReply: boolean;
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

export async function notifyTeamDataChanged(_source?: string): Promise<boolean> {
  return false;
}

/** Connecting a mailbox with an app password. None here. */
export function GmailAppPasswordConnect(_props: { onConnected: () => void }): null {
  return null;
}

/** A per-mailbox switch on its Settings row. None here. */
export function AccountAssistSwitch(_props: { account: string }): null {
  return null;
}

/** Whether a mailbox's assist buttons show. They draw nothing here either way. */
export function useAccountAssist(_account: string | null | undefined): boolean {
  return true;
}

/** The tab id the triage list would have. No such tab here. */
export const TRIAGE_TAB = "triage";

/** Beside the search box. Nothing here. */
export function TriageButton(): null {
  return null;
}

/** A tab right of Other. None here. */
export function TriageTab(_props: { tabClass: (active: boolean) => string }): null {
  return null;
}

/** The list while that tab is open. Never open here. */
/** The triage list's order. No triage here. */
export function useTriageOrder(): readonly { key: string; account: string; threadId: string; lastAt: string }[] | null {
  return null;
}

export function TriageListPane(): null {
  return null;
}

/** Over an open thread. Nothing here. */
export function TriageBanner(_props: { account: string; threadId: string }): null {
  return null;
}

/** A request in the drafts folder: this Mail takes drafts only. */
export async function handleDraftsFolderRequest(
  _item: DraftsFolderRequest,
  host: DraftsFolderRequestHost
): Promise<void> {
  await host.answer({ ok: false, error: "This Mail takes drafts only, not requests." });
}

/** A mark on a row of a mailbox that the team reads together. None here. */
export function TeamRowMark(_props: { account: string; threadId: string; className?: string }): null {
  return null;
}

/** "Assign…" in a row's right-click menu. None here. */
export function TeamRowMenuAssign(_props: { account: string; threadId: string; onDone: () => void }): null {
  return null;
}

/** The same for a Stacks row, which holds one person's threads. None here. */
export function TeamStackMark(_props: {
  threads: readonly { account: string; threadId: string }[];
  className?: string;
}): null {
  return null;
}

/** Who answers a thread of a team mailbox, in the action strip. None here. */
export function TeamThreadControl(_props: { account: string; threadId: string; newestId?: string }): null {
  return null;
}

/** Who has which thread in the team mailbox, at the right of the tabs. None here. */
export function TeamAssigneeFilter(): null {
  return null;
}

/** The rows, narrowed by that filter. Never on here. */
export function useTeamRowFilter(
  _threads: readonly { account: string; threadId: string }[]
): ((thread: { account: string; threadId: string }) => boolean) | null {
  return null;
}
