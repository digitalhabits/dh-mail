/*
 * The state of the thread composer, as a pure reducer: what the message
 * being written holds, and the two ways it changes. No React in here. The
 * hooks that use it are in components/mail/use-thread-composer.ts.
 */

import type { MailRecipient } from "@/lib/mail/contact-list-types";
import type { ThreadComposerMode as ComposerMode } from "@/lib/mail/local-drafts";

export type ComposerState = {
  /**
   * Reply (sender only), reply-all, or forward; null while the composer is
   * closed. Recipients are always visible and editable once it opens, so no
   * mode can quietly widen the audience.
   */
  mode: ComposerMode | null;
  /** The words, as the editor's HTML. */
  reply: string;
  /**
   * Remounts the editor (feeding Quill's HTML back as a controlled value
   * makes it re-parse on every keystroke and eat trailing spaces).
   */
  editorKey: number;
  /**
   * The subject this composer will send, when it is not the thread's own.
   *
   * A forward always shows the row — it is usually the start of something
   * else. A reply shows it only when asked, because a reply's subject is
   * the thread's and changing it is the rare case; the row would otherwise
   * stand over every reply saying what the reader already knows.
   */
  subjectDraft: string;
  subjectOpen: boolean;
  toList: MailRecipient[];
  ccList: MailRecipient[];
  showCc: boolean;
  /**
   * Recipients show as a compact "Replying to …" line; clicking it expands
   * the full chip editors.
   */
  editRecipients: boolean;
  includeSignature: boolean;
  /** Which mailbox the reply goes out from; defaults to the thread's account. */
  fromAccount: string;
  /** Hide the thread and grow the reply/forward composer to fill the pane. */
  replyFocus: boolean;
  /**
   * The message a reply or a forward quotes.
   *
   * The newest one, unless the reader picked one from its hover actions. A
   * reply to something said three messages back should quote that, not
   * whatever happens to be last.
   */
  quoteMessageId: string | null;
  showPreview: boolean;
  /** Per-send: ask Grok to update CRM Notes after this reply goes out. */
  updateCrmNotes: boolean;
  /** The "Discard draft?" question is open. Escape asks it; the bin does not. */
  confirmDiscard: boolean;
};

/** A field of the composer that a control writes by itself. */
export type EditableField = Exclude<keyof ComposerState, "editorKey">;

/** Some fields of the composer, written in one step. */
export type ComposerPatch = Partial<Omit<ComposerState, "editorKey">>;

export type ComposerAction =
  | {
      type: "edit";
      field: EditableField;
      value: unknown | ((previous: never) => unknown);
    }
  | { type: "patch"; patch: ComposerPatch };

export function composerReducer(
  state: ComposerState,
  action: ComposerAction
): ComposerState {
  if (action.type === "edit") {
    const previous = state[action.field];
    const next =
      typeof action.value === "function"
        ? (action.value as (p: typeof previous) => typeof previous)(previous)
        : action.value;
    // The same value is the same state, so React skips the render, as it
    // does for a useState setter.
    if (Object.is(next, previous)) return state;
    return { ...state, [action.field]: next };
  }
  return {
    ...state,
    ...action.patch,
    // Words that come from outside the editor need a new editor: it takes
    // its words from defaultValue when it mounts. Every patch that writes
    // the words gets one, so no caller can forget it.
    editorKey: "reply" in action.patch ? state.editorKey + 1 : state.editorKey,
  };
}

/** A closed, empty composer that sends from the thread's own mailbox. */
export function initialComposerState(fromAccount: string): ComposerState {
  return {
    mode: null,
    reply: "",
    editorKey: 0,
    subjectDraft: "",
    subjectOpen: false,
    toList: [],
    ccList: [],
    showCc: false,
    editRecipients: false,
    includeSignature: false,
    fromAccount,
    replyFocus: false,
    quoteMessageId: null,
    showPreview: false,
    updateCrmNotes: false,
    confirmDiscard: false,
  };
}

/**
 * A whole message, to put in the composer.
 *
 * The fields with a question mark stay as they are when the snapshot does
 * not name them. The sites differ in exactly those fields, and this hook
 * keeps each site as it was.
 */
export type ComposerSnapshot = {
  mode: ComposerMode | null;
  reply: string;
  /** The subject the writer set. Empty means the thread's own. */
  subject: string;
  toList: MailRecipient[];
  ccList: MailRecipient[];
  showCc: boolean;
  editRecipients: boolean;
  includeSignature: boolean;
  fromAccount: string;
  replyFocus?: boolean;
  quoteMessageId?: string | null;
  showPreview?: boolean;
  updateCrmNotes?: boolean;
};

/** The fields that a snapshot writes. The row is open when it has a subject. */
export function snapshotPatch(snapshot: ComposerSnapshot): ComposerPatch {
  const { subject, ...fields } = snapshot;
  const patch: ComposerPatch = {
    ...fields,
    subjectDraft: subject,
    // With the row open, because a subject that is not the thread's is
    // one the writer set and has to be able to see.
    subjectOpen: Boolean(subject.trim()),
  };
  // A field that is named but undefined must not write `undefined`.
  for (const key of Object.keys(patch) as (keyof ComposerPatch)[]) {
    if (patch[key] === undefined) delete patch[key];
  }
  return patch;
}
