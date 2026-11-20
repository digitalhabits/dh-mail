"use client";

import { type PersonRow } from "@/lib/mail/person-participants";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import { Archive, RotateCwFadingClock, Trash2 } from "lucide-react";
import { useMailT } from "@/lib/mail/i18n";
import { cn } from "@/lib/utils";

/**
 * Archive, delete, read or unread, and snooze, on a person row, revealed on
 * hover: the four a thread row offers, in Gmail's order, each acting on
 * every conversation with them. Pin is on the right-click menu.
 */
export function PersonRowActions({
  row,
  onNavy,
  onArchive,
  onTrash,
  onToggleRead,
  onSnooze,
  className,
}: {
  row: PersonRow;
  onNavy: boolean;
  /** Not given in Trash: the mail is deleted already. */
  onArchive?: () => void;
  /** Not given in Trash, for the same reason. */
  onTrash?: () => void;
  /** Read when anything is unread; otherwise the newest back to unread. */
  onToggleRead: () => void;
  /** Opens the times, under the point given (the button's foot). */
  onSnooze?: (x: number, y: number) => void;
  /** Where they sit up and down: on the name's line when the row has more than one. */
  className?: string;
}) {
  const say = useMailT();
  const plain = onNavy
    ? "rounded p-1 text-white/55 hover:bg-white/10 hover:text-white"
    : "rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-800";
  const count = row.threads.length;
  const unreadCount = row.threads.filter((t) => t.unread).length;
  return (
    /*
      Over the row's right end, not beside it: beside, the row gave them its
      room as they showed, and the name, the badge and the line under them
      all moved. In the row's own colour, hovered or picked, so what is
      under them does not show through: the solid one, as the open row's
      fill in dark is a tint you can see through.
    */
    <span
      className={cn(
        "absolute right-[14px] top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-inner bg-[var(--mail-person-stack-ring,transparent)] pl-1.5 group-hover:flex",
        className
      )}
    >
      {onArchive ? (
        <button
          type="button"
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
      ) : null}
      {onTrash ? (
        <button
          type="button"
          title={count === 1 ? say("actionDelete") : say("deleteAllCount", { count })}
          aria-label={
            count === 1
              ? say("actionDelete")
              : say("deleteAllWith", { count, name: row.name })
          }
          className={plain}
          onClick={onTrash}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      ) : null}
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
      {onSnooze ? (
        <button
          type="button"
          title={count === 1 ? say("snooze") : say("snoozeAllCount", { count })}
          aria-label={count === 1 ? say("snooze") : say("snoozeAllCount", { count })}
          className={plain}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            onSnooze(box.left, box.bottom);
          }}
        >
          <RotateCwFadingClock className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Faces for a person-view row, in one avatar's square.
 *
 * A horizontal stack makes a group row wider than a one-person row, so the
 * names do not line up. One box keeps the column still. The faces
 * come from `row.people` as the title already named them. A second
 * filter here leaves a name with no face.
 */
