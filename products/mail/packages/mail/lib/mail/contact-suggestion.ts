/**
 * Shared shape for compose To/Cc/Bcc autocomplete suggestions.
 * Safe for client + server (no DB imports).
 */

import type { MailT } from "@/lib/mail/i18n-strings";
import { teamWord } from "@/lib/mail/i18n-team";

/**
 * The source key and kind of the team's records, on a build that has them.
 *
 * A stored name: the settings keep it in their list of sources that are
 * off. So it stays as it is.
 */
export const TEAM_RECORDS_SOURCE = "crm";

export type MailContactSourceKind =
  | typeof TEAM_RECORDS_SOURCE
  | "team"
  | "google"
  | "outlook"
  | "history"
  /** The Mac address book, read by the standalone Mac app. */
  | "mac"
  /** One of the reader's connected mailboxes (email yourself). */
  | "self"
  /** The directory of an Exchange server, asked as the reader types. */
  | "directory";

export type MailContactSuggestion = {
  email: string;
  name: string;
  /** The organization or record name, for a row from the team's records. */
  recordName: string;
  source: MailContactSourceKind;
  /** Provider mailbox for google/outlook (and history rows). */
  account?: string;
  lastEmailedAt?: string | null;
};

export type MailContactSourceSummary = {
  key: string;
  kind: MailContactSourceKind;
  label: string;
  enabled: boolean;
  /** Provider token predates contacts scope — sync cannot populate this source. */
  needsReconnect?: boolean;
};

/**
 * Short provenance label for a typeahead row badge.
 *
 * Null for a source this does not know. A row from somewhere unnamed is a
 * row without a badge — which is what it looked like before these were keys,
 * and better than the word "undefined" in a pill.
 */
export function contactSourceBadge(
  suggestion: Pick<MailContactSuggestion, "source">,
  t: MailT
): string | null {
  switch (suggestion.source) {
    case TEAM_RECORDS_SOURCE:
      return teamWord(t, "recordsBadge");
    case "team":
      return t("badgeTeam");
    case "google":
      return t("badgeGoogle");
    case "outlook":
      return t("badgeOutlook");
    case "history":
      return t("badgeHistory");
    case "mac":
      return t("badgeContacts");
    case "self":
      return t("badgeYou");
    case "directory":
      return t("badgeDirectory");
    default:
      return null;
  }
}

/**
 * When the reader last emailed this address, in words. Null if it is unknown.
 *
 * Short on purpose. It shares one line with the address, and the address is
 * the part that must stay readable. The clock icon and the HISTORY badge
 * already say the row came from old mail and not from a contact source.
 */
export function historyEmailedWhen(
  iso: string | null | undefined,
  t: MailT
): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const days = Math.max(0, Math.round((Date.now() - at) / (24 * 60 * 60 * 1000)));
  if (days <= 0) return t("emailedToday");
  if (days === 1) return t("emailedYesterday");
  if (days < 14) return t("emailedDaysAgo", { count: days });
  if (days < 60) return t("emailedWeeksAgo", { count: Math.round(days / 7) });
  if (days < 730) return t("emailedMonthsAgo", { count: Math.round(days / 30) });
  return t("emailedYearsAgo", { count: Math.round(days / 365) });
}

