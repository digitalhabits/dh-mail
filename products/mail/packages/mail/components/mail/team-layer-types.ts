/**
 * The types that the shared interface and the team layer agree on.
 *
 * The interface reaches the team layer through one module,
 * `@/components/mail/team-layer`. A build without the team layer resolves
 * that name to a stand-in, and the stand-in and the real module both use
 * these types. So the interface typechecks the same against either.
 */

/** The thread that a piece of team work started from. */
export type TeamOrigin = { account: string; threadId: string };

/** One PDF of the thread that the reader can give as context. */
export type ReadableThreadAttachment = {
  messageId: string;
  filename: string;
  mimeType: string;
  attachmentId: string;
};

/** A drafted message, and the notes on it, for the strip above the composer. */
export type DraftAssistResult = {
  body: string;
  subject?: string;
  scenario: "cold" | "ongoing" | "resurfacing";
  usedRecords: { source: string; recordId: string; recordName: string }[];
  gaps: string[];
  /**
   * What the reader had already written, which the draft was built from.
   *
   * The notes are consumed by the draft that replaces them, so the strip
   * keeps them and offers them back. A draft written from a brief is still
   * a draft somebody may not want.
   */
  brief?: string;
};

/** Which part of a draft is running, for the strip above the composer. */
export type DraftAssistWorking = "reading" | "writing" | null;

/** What the send route can answer for the team layer, beside the send itself. */
export type TeamSendAnswer = {
  crmNotes?: {
    updated: string[];
    skipped?: string;
    errors: string[];
  };
  crmProposal?: unknown;
};
