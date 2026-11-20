"use client";

/*
 * Parts of a thread row, out of ThreadListRow.tsx: the quick actions that
 * show under the pointer, and who the row is with.
 */

import * as React from "react";
import { Archive, RotateCwFadingClock, Trash2 } from "lucide-react";
import { Highlighted } from "@/components/mail/Highlighted";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import { SnoozeMenu } from "@/components/mail/SnoozeMenu";
import { useMailT } from "@/lib/mail/i18n";
import type { MailT } from "@/lib/mail/i18n-strings";
import { threadPeopleLabel } from "@/lib/mail/person-participants";
import type { MailThreadSummary } from "@/lib/mail/types";

/**
 * The buttons that show on a row under the pointer: read or unread,
 * snooze, and archive.
 */
export function RowHoverActions({
  rowActionsClass,
  say,
  t,
  actionBtn,
  onToggleRead,
  actionIcon,
  onSnooze,
  onCancelSnooze,
  setSnoozeOpen,
  snoozeSignal,
  onArchive,
  onTrash,
}: {
  rowActionsClass: string;
  say: MailT;
  t: MailThreadSummary;
  actionBtn: string;
  onToggleRead: () => void;
  actionIcon: string;
  onSnooze: ((untilIso: string) => void) | undefined;
  onCancelSnooze: (() => void) | undefined;
  setSnoozeOpen: React.Dispatch<React.SetStateAction<boolean>>;
  snoozeSignal: number;
  onArchive: (() => void) | undefined;
  onTrash: (() => void) | undefined;
}) {
  /*
    Gmail's four, in Gmail's order: archive, delete, read or unread,
    snooze — what a reader does over and over on the way down a list.
    Pinning is done to the few conversations that are going to stay; it is
    on the right-click menu and on the reader's own strip.
  */
  return (
    <span
      className={rowActionsClass}
      onClick={(e) => e.stopPropagation()}
      // Enter on a button is that button's, not the row's — the row opens the
      // thread on Enter and would otherwise do both.
      onKeyDown={(e) => e.stopPropagation()}
    >
      {onArchive ? (
        <button
          type="button"
          title={say("actionArchive")}
          aria-label={say("actionArchive")}
          className={actionBtn}
          onClick={onArchive}
        >
          <Archive className={actionIcon} />
        </button>
      ) : null}
      {onTrash ? (
        <button
          type="button"
          title={say("actionDelete")}
          aria-label={say("actionDelete")}
          className={actionBtn}
          onClick={onTrash}
        >
          <Trash2 className={actionIcon} />
        </button>
      ) : null}
      <button
        type="button"
        title={say(t.unread ? "markAsRead" : "markAsUnread")}
        aria-label={say(t.unread ? "markAsRead" : "markAsUnread")}
        className={actionBtn}
        onClick={onToggleRead}
      >
        {/* The same icon whichever way the click will go, and the same one
            the reader uses. A control that changes shape reads as two
            controls; the label says which way it goes. */}
        <MailDotIcon className={actionIcon} />
      </button>
      {onSnooze ? (
        <SnoozeMenu
          onSnooze={onSnooze}
          onCancelSnooze={onCancelSnooze}
          currentUntil={t.snoozedUntil}
          onOpenChange={setSnoozeOpen}
          // Snooze… on the right-click menu opens this one, so both ways
          // through end at the same list of times.
          openSignal={snoozeSignal}
          trigger={
            <button
              type="button"
              title={t.snoozedUntil ? say("changeSnooze") : say("snooze")}
              aria-label={t.snoozedUntil ? say("changeSnooze") : say("snooze")}
              className={actionBtn}
            >
              <RotateCwFadingClock className={actionIcon} />
            </button>
          }
        />
      ) : null}
    </span>
  );
}

/**
 * Who a row is with, led by "me," when we wrote in the thread, as Gmail's
 * list does. The "me," stays regular on an unread row: it is not news.
 */
export function RowPeople({
  t,
  highlight,
  onNavy,
}: {
  t: MailThreadSummary;
  highlight: string[] | undefined;
  onNavy: boolean;
}) {
  const say = useMailT();
  return (
    <>
      {t.fromMe ? <span className="font-normal">{say("meLead")}</span> : null}
      <Highlighted text={threadPeopleLabel(t)} terms={highlight} onNavy={onNavy} />
    </>
  );
}
