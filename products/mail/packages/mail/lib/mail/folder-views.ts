/**
 * The views a provider keeps in a folder of its own.
 *
 * Not the inbox, which is what a list serves when asked for nothing, and not
 * Drafts or Snoozed: drafts have their own endpoint and snoozed is ours.
 *
 * One list, because there were two. The interface decided which views to ask
 * for by name, and the desktop transport decided which names to pass on, and
 * when Archived was added to the first and not the second the request fell
 * through to undefined — so the rail lit, the placeholder said Archived, and
 * the inbox came back. A closed set that answers "no" by silently meaning
 * "inbox" has to be written down once.
 */

export const MAIL_FOLDER_VIEWS = ["sent", "trash", "junk", "archived"] as const;

export type MailFolderView = (typeof MAIL_FOLDER_VIEWS)[number];

/** The view this name asks for, or undefined for anything else. */
export function asMailFolderView(
  raw: string | null | undefined
): MailFolderView | undefined {
  const name = raw?.trim();
  return (MAIL_FOLDER_VIEWS as readonly string[]).includes(name ?? "")
    ? (name as MailFolderView)
    : undefined;
}
