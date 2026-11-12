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
 * This works in both directions. A sticky that holds only while it is higher
 * than the provider's number is right for filing a mail in a folder. It is
 * wrong for taking one out: the badge stays at 2 with one row on the list.
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

/** The last count each folder had while its mailbox was not paused. */
export type HeldFolderCounts = Map<string, number>;

/**
 * The counts of a paused mailbox, as they were before the pause.
 *
 * The copy goes on filling during a pause, and the counts are read from
 * it. Mail that a rule filed in a folder made that folder's number go up,
 * so the rail said that mail had come. A paused mailbox's folders keep the
 * count they had when the mailbox was last read live, or the first count
 * seen in the pause when there is none.
 *
 * `learn` is false for a list read with no counts in it (names only): it
 * takes the held counts and teaches nothing.
 */
export function holdPausedFolderCounts(
  folders: MailAccountFolder[],
  held: HeldFolderCounts,
  paused: (account: string) => boolean,
  learn = true
): MailAccountFolder[] {
  const pausedNow = new Map<string, boolean>();
  const isPaused = (account: string) => {
    const key = account.trim().toLowerCase();
    if (!pausedNow.has(key)) pausedNow.set(key, paused(account));
    return pausedNow.get(key) === true;
  };
  return folders.map((folder) => {
    const key = folderCountKey(folder.account, folder.name);
    if (!isPaused(folder.account)) {
      if (learn) held.set(key, folder.count);
      return folder;
    }
    const was = held.get(key);
    if (was == null) {
      if (learn) held.set(key, folder.count);
      return folder;
    }
    return was === folder.count ? folder : { ...folder, count: was };
  });
}

/** The reader's own move, in a held count too: it is not mail that came in. */
export function bumpHeldFolderCount(held: HeldFolderCounts, account: string, name: string, delta: number): void {
  const key = folderCountKey(account, name);
  const was = held.get(key);
  if (was != null) held.set(key, Math.max(0, was + delta));
}
