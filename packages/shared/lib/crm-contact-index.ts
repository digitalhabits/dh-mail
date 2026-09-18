/**
 * The contact index types, shared by the planner and by mail.
 *
 * Mail classifies list rows against this index, so it needs the shape. It must
 * not need the planner module that builds one: a build without the team layer
 * has no CRM at all, and a type import that points into the planner stops such
 * a build from compiling.
 *
 * The planner re-exports these from `lib/plan/crm-contacts`, so one definition
 * serves both, and no copy can drift.
 *
 * This file holds types only. It has no imports and no runtime code.
 */

/** Which planner table a record belongs to. */
export type CrmRecordSource =
  | "clients"
  | "collaborations"
  | "facilitators"
  | "grants"
  | "team"
  | "finance";

/** A CRM record that lists a contact. */
export type CrmRecordRef = {
  source: CrmRecordSource;
  recordId: string;
  recordName: string;
  fields: Record<string, string>;
};

/** contact email (lowercase) → CRM record(s) that list it (may be shared). */
export type ContactIndex = Map<string, CrmRecordRef[]>;

/** A connected Gmail mailbox, as the settings screens receive it. */
export type GmailAccountDto = {
  email: string;
  clerkUserId: string | null;
  historyId: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  /** Shown in the unified Mail tab; CRM sync uses the account regardless. */
  inMailTab: boolean;
  /** What Google said it granted. Null until recorded; absent off the planner. */
  grantedScopes?: string | null;
  /** Planner features the grant does not cover. Filled by the planner's route. */
  missingFeatures?: string[];
};
