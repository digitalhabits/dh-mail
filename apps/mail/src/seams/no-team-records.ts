/**
 * The team's records, which this app does not have.
 *
 * The shared code asks `@/lib/mail/team-records` for a source of team
 * records and a team roster. This app resolves that name to this file, and
 * every answer is "none". The People pile then comes from the reader's own
 * address books.
 *
 * The names must be the ones the shared code imports.
 */

import type {
  ContactIndex,
  TeamRecordRef,
  TeamRecords,
  TeamRoster,
} from "@/lib/contact-index";

export async function loadTeamRecords(): Promise<TeamRecords | null> {
  return null;
}

export async function loadTeamRoster(): Promise<TeamRoster | null> {
  return null;
}

export function recordLogoUrlIfLoaded(
  _email: string,
  _contacts: ContactIndex,
  _domains: Map<string, TeamRecordRef[]>
): string | undefined {
  return undefined;
}

export function resetTeamRecords(): void {}
