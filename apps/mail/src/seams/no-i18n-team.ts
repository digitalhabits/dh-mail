/**
 * Words that a build can add to the app's own. This app adds none.
 *
 * `i18n-strings.ts` imports these from `@/lib/mail/i18n-team`, and this app
 * resolves that name to this file.
 */

import type { MailT } from "@/lib/mail/i18n-strings";
import type { TeamWordName } from "@/lib/mail/team-word-names";

export const teamEn = {} as const;

export const teamDa: Record<keyof typeof teamEn, string> = {};

/** No word of a build's own for any place. The caller shows its own. */
export function teamWord(_t: MailT, _name: TeamWordName): string | null {
  return null;
}
