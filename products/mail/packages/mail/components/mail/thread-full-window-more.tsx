"use client";

/**
 * The "…" in the bar over the thread in the whole window (see
 * thread-full-window-bar): what the pane's toolbar has, apart from Reply,
 * Archive and Delete, which stand in the bar or the reply tray, and the
 * zoom, which "Aa" does here.
 */

import { ThreadToolbarOverflow } from "@/components/mail/ThreadToolbarOverflow";
import type { ThreadToolbarSlot } from "@/components/mail/use-thread-toolbar-fold";
import type { ThreadPaneModel } from "@/components/mail/use-thread-pane";
import { mailHasTeamRecords } from "@/lib/mail/product-flavor";
import { formatShortcut } from "@/lib/mail/shortcuts";

/** Every row the menu can hold, as when the pane is at its narrowest. */
const IN_THE_MENU = new Set<ThreadToolbarSlot>(["print", "popOut", "pin", "move", "records", "read", "snooze"]);

export function ThreadFullWindowMore({ m }: { m: ThreadPaneModel }) {
  const { account, threadId, inTrash, shortcuts, t } = m;
  return (
    <ThreadToolbarOverflow
      hidden={IN_THE_MENU}
      zoom={m.zoom}
      onZoomAdjust={m.adjustZoomFromControls}
      onPrint={m.printThread}
      onPopOut={m.popOutThread}
      pinned={m.pinned}
      onTogglePin={m.onTogglePin}
      unread={m.unread}
      onToggleUnread={m.onToggleUnread}
      onSnooze={m.onSnooze}
      onCancelSnooze={m.onCancelSnooze}
      snoozedUntil={m.snoozedUntil}
      folders={m.folders}
      account={account}
      onMoveToFolder={m.onMoveToFolder}
      onMoveToJunk={m.onJunk}
      onMoveToInbox={m.onMoveToInbox}
      onArchive={m.onArchive}
      onTrash={inTrash ? undefined : () => m.onTrash({ account, threadId })}
      here={m.here}
      onUpdateRecords={mailHasTeamRecords() ? (hint) => void m.updateRecordsFromThread(hint) : undefined}
      recordsBusy={m.updatingRecords}
      printLabel={`${t("actionPrint")} (${formatShortcut(shortcuts.print)})`}
      popOutLabel={`${t("popOutChat")} (${formatShortcut(shortcuts.popOut)})`}
      pinShortcut={formatShortcut(shortcuts.togglePin)}
    />
  );
}
