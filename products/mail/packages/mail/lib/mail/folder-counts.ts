/**
 * The number beside a folder name, while the provider catches up.
 *
 * The counts come from a search — `label:Blocked` at Gmail, the folder's own
 * total at Graph — and neither includes a conversation that moved a moment
 * ago. So when someone files a mail in a folder, or deletes one out of the
 * folder they are looking at, the count on screen is the old one.
 *
 * A sticky count is our answer to that: the number we believe, held over the
 * provider's, together with the provider's number at the time we stopped
 * believing it. The sticky ends when the provider says something different
 * from that number, because by then the provider's answer takes our change
 * into account — and anything else that happened since, which ours does not.
 *
 * This works in both directions. An earlier version kept a sticky only while
 * it was higher than the provider's number, which was right for filing a mail
 * in a folder and wrong for taking one out: the badge stayed at 2 with one
 * row on the list.
 */

import type { MailAccountFolder } from "@/lib/mail/folder-types";

/** How long a correction stands if the provider never contradicts it. */
export const FOLDER_COUNT_STICKY_MS = 90_000;

export type StickyFolderCount = {
  /** What we believe the folder holds. */
  count: number;
  /** What the provider said when we started correcting it. */
  serverCount: number;
  /** Give up after this, so a wrong guess cannot last. */
  until: number;
};

/**
 * Keyed by account and folder name, both lowercase.
 *
 * By account as well as by name, because two mailboxes can each hold an
 * Archive and filing into one of them says nothing about the other. Keyed
 * by name alone, one correction moved both badges.
 */
export type StickyFolderCounts = Map<string, StickyFolderCount>;

export function folderCountKey(account: string, name: string): string {
  return `${account.trim().toLowerCase()}\u0000${name.trim().toLowerCase()}`;
}

/** The provider's list, with our corrections still standing. */
export function applyStickyFolderCounts(
  folders: MailAccountFolder[],
  sticky: StickyFolderCounts,
  now: number
): MailAccountFolder[] {
  return folders.map((folder) => {
    const key = folderCountKey(folder.account, folder.name);
    const held = sticky.get(key);
    if (!held || held.until <= now) return folder;
    if (folder.count !== held.serverCount) {
      sticky.delete(key);
      return folder;
    }
    return { ...folder, count: held.count };
  });
}

/**
 * Record a folder gaining or losing conversations.
 *
 * A folder we have not heard of yet is added, so a mail filed in a folder
 * made a moment ago shows up straight away. Losing a conversation from a
 * folder we have never listed says nothing we can use, so it is ignored.
 */
export function bumpFolderCount(
  folders: MailAccountFolder[],
  sticky: StickyFolderCounts,
  account: string,
  name: string,
  delta: number,
  now: number
): MailAccountFolder[] {
  const key = folderCountKey(account, name);
  if (!key || !delta) return folders;

  // What the provider last said. When a correction is already standing, that
  // is the number it carries — not the one on the list, which is ours.
  const held = sticky.get(key);
  let found = false;
  let nextCount = Math.max(0, delta);
  let serverCount = held?.serverCount ?? nextCount;

  const next = folders.map((folder) => {
    if (folderCountKey(folder.account, folder.name) !== key) return folder;
    found = true;
    nextCount = Math.max(0, folder.count + delta);
    if (!held) serverCount = folder.count;
    return { ...folder, count: nextCount };
  });

  if (!found) {
    if (delta < 0) return folders;
    next.push({ account, name: name.trim(), count: nextCount });
    next.sort(
      (a, b) =>
        a.account.localeCompare(b.account, undefined, {
          sensitivity: "base",
        }) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
  }

  sticky.set(key, {
    count: Math.max(0, nextCount),
    serverCount,
    until: now + FOLDER_COUNT_STICKY_MS,
  });
  return next;
}
