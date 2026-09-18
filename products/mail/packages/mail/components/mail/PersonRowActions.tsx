"use client";

import { type PersonRow } from "@/lib/mail/person-participants";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import { Archive, Pin } from "lucide-react";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/**
 * Pin and archive, on a person row, revealed on hover.
 *
 * The same two the thread rows offer, meaning the same two things: pin keeps
 * this correspondent at the top of the list, and archive clears every
 * conversation with them out of the inbox.
 */
export function PersonRowActions({
  row,
  pinned,
  onNavy,
  onTogglePin,
  onArchive,
  onToggleRead,
}: {
  row: PersonRow;
  pinned: boolean;
  onNavy: boolean;
  onTogglePin: () => void;
  onArchive: () => void;
  /** Read when anything is unread; otherwise the newest back to unread. */
  onToggleRead: () => void;
}) {
  const say = useMailT();
  const plain = onNavy
    ? "rounded p-1 text-white/55 hover:bg-white/10 hover:text-white"
    : "rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800";
  const count = row.threads.length;
  const unreadCount = row.threads.filter((t) => t.unread).length;
  return (
    <span className="ml-1 hidden shrink-0 items-center gap-0.5 group-hover:flex">
      <button
        type="button"
        title={
          unreadCount
            ? unreadCount === 1
              ? say("markAsRead")
              : say("markAllAsRead", { count: unreadCount })
            : say("markNewestUnread")
        }
        aria-label={
          unreadCount
            ? say("markPersonRead", { name: row.name })
            : say("markPersonNewestUnread", { name: row.name })
        }
        className={plain}
        onClick={onToggleRead}
      >
        <MailDotIcon className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title={pinned ? say("unpin") : say("pinToTop")}
        aria-label={
          pinned
            ? say("unpinPerson", { name: row.name })
            : say("pinPerson", { name: row.name })
        }
        className={cn(
          "rounded p-1",
          pinned
            ? onNavy
              ? "text-teal-300 hover:bg-white/10"
              : "text-teal-600 hover:bg-teal-50"
            : onNavy
              ? "text-white/55 hover:bg-white/10 hover:text-teal-300"
              : "text-stone-500 hover:bg-stone-100 hover:text-teal-700"
        )}
        onClick={onTogglePin}
      >
        <Pin
          className={cn(
            "h-3.5 w-3.5",
            pinned && (onNavy ? "fill-teal-300" : "fill-teal-600")
          )}
        />
      </button>
      <button
        type="button"
        // Archiving one thread and archiving eleven are different acts, and the
        // label is the only warning there is.
        title={
          count === 1
            ? say("archiveConversation")
            : say("archiveAllCount", { count })
        }
        aria-label={
          count === 1
            ? say("archiveConversationWith", { name: row.name })
            : say("archiveAllWith", { count, name: row.name })
        }
        className={plain}
        onClick={onArchive}
      >
        <Archive className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}

/**
 * Faces for a person-view row, in one avatar's square.
 *
 * A horizontal stack made a group row wider than a one-person row, so the
 * names no longer lined up. One box keeps the column still. The faces
 * come from `row.people` as the title already named them. A second
 * filter here leaves a name with no face.
 */
