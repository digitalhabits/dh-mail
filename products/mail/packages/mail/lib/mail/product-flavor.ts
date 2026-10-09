/**
 * The product flavor: "public" (this app, for anyone) or "internal" (the
 * organization's own build).
 *
 * - public: the People pile holds the reader's address-book contacts. Mail
 *   data stays in the local store. The app holds no organization key.
 * - internal: a team layer adds parts of its own (see `team-layer`).
 *
 * The public app sets NEXT_PUBLIC_MAIL_PRODUCT_FLAVOR (and
 * MAIL_PRODUCT_FLAVOR) to "public" at build time. An unset value reads as
 * "internal".
 */

import type { MailT } from "@/lib/mail/i18n";
import { teamWord } from "@/lib/mail/i18n-team";

export type MailProductFlavor = "internal" | "public";

function rawFlavor(): string {
  return (
    process.env.NEXT_PUBLIC_MAIL_PRODUCT_FLAVOR?.trim() ||
    process.env.MAIL_PRODUCT_FLAVOR?.trim() ||
    "internal"
  ).toLowerCase();
}

export function getMailProductFlavor(): MailProductFlavor {
  return rawFlavor() === "public" ? "public" : "internal";
}

export function isPublicMailProduct(): boolean {
  return getMailProductFlavor() === "public";
}

/**
 * Whether the People pile comes from the team's records. False in the
 * public app, where it comes from the reader's address books.
 */
export function mailHasTeamRecords(): boolean {
  return !isPublicMailProduct();
}

/** Whether the team layer's assist parts are on. False in the public app. */
export function mailHasTeamAssist(): boolean {
  return !isPublicMailProduct();
}

export function mailPeopleTabLabel(t: MailT): string {
  return (mailHasTeamRecords() && teamWord(t, "peopleTab")) || t("tabInContacts");
}

export function mailAddToPeopleActionLabel(t: MailT): string {
  return (mailHasTeamRecords() && teamWord(t, "addToPeople")) || t("addToContacts");
}
