/**
 * The contact index types, and the shape of a source of team records.
 *
 * Mail classifies list rows against a contact index, so it needs the shape.
 * It does not need the module that builds one. In the public app, nothing
 * builds one, and the People pile comes from the reader's address books.
 *
 * This file holds types only. It has no imports and no runtime code.
 */

/** Which table a team record belongs to. */
export type TeamRecordSource =
  | "clients"
  | "collaborations"
  | "facilitators"
  | "grants"
  | "team"
  | "finance";

/** A team record that lists a contact. */
export type TeamRecordRef = {
  source: TeamRecordSource;
  recordId: string;
  recordName: string;
  fields: Record<string, string>;
};

/** contact email (lowercase) → the record(s) that list it (may be shared). */
export type ContactIndex = Map<string, TeamRecordRef[]>;

/** One address that a source of records offers to the address field. */
export type RecordRecipientSuggestion = {
  email: string;
  name: string;
  recordName: string;
};

/**
 * A source of team records, as mail reads it. See `@/lib/mail/team-records`.
 * The public app has none.
 */
export type TeamRecords = {
  buildContactIndex(): Promise<ContactIndex>;
  buildContactDomainIndex(): Promise<Map<string, TeamRecordRef[]>>;
  /** The logo of the record that a contact belongs to, if one is known. */
  logoUrlFor(
    email: string,
    contacts: ContactIndex,
    domains?: Map<string, TeamRecordRef[]>
  ): string | undefined;
  listRecipientSuggestions(): Promise<RecordRecipientSuggestion[]>;
  countContactEmails(): Promise<number>;
};

/** The team's own people, offered to the address field. */
export type TeamRoster = {
  listTeamRecipientSuggestions(): Promise<{ email: string; name: string }[]>;
};

/** A connected Gmail mailbox, as the settings screens receive it. */
export type GmailAccountDto = {
  email: string;
  clerkUserId: string | null;
  historyId: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** Shown in the Mail tab. A hidden account stays connected. */
  inMailTab: boolean;
  /** What Google said it granted. Null until recorded. */
  grantedScopes?: string | null;
  /** The features of the host that the grant does not cover. */
  missingFeatures?: string[];
};
