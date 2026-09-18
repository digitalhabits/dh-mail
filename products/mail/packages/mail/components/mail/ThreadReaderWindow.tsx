"use client";

/**
 * One thread in an ordinary window of its own — the reader window.
 *
 * Rendered by `?reader=1` in the desktop shells (see open_mail_reader_window)
 * or a browser popup. The pane inside is the same ThreadPane the main window
 * reads with: every action button, the reply box, the zoom. What this file
 * owns is what MailPage owns in the main window — the wiring of those
 * actions — done without a list to wire them to.
 *
 * The actions call the same endpoints the main window calls, on every copy
 * of the conversation the list knew about when it opened the window (see
 * ReaderWindowHandoff). An action that removes the conversation — archive,
 * delete, junk, snooze — closes the window with it, the way Outlook closes
 * a message window, and tells the other windows so the list drops the row.
 */

import * as React from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "@/lib/mail/toast";

import { CrmProposalHost } from "@/components/mail/CrmProposalHost";
import { useMailFolders } from "@/components/mail/MailFolders";
import { ThreadPane } from "@/components/mail/ThreadPane";
import { useMailZoom } from "@/components/mail/use-mail-layout";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { unpinMailThread } from "@/lib/mail/pins";
import {
  signalEditAsNewRequest,
  signalPopoutSend,
} from "@/lib/mail/popout";
import {
  readReaderHandoff,
  signalMailChanged,
  type ReaderWindowHandoff,
} from "@/lib/mail/reader-window";
import { invalidateCachedMailThread } from "@/lib/mail/thread-cache";
import { threadKey } from "@/lib/mail/thread-copies";
import { useMailColorMode } from "@/lib/mail/theme";
import { closeMailReaderWindow, isNativeShell } from "@/lib/native-shell";

export function ThreadReaderWindow({
  account,
  threadId: initialThreadId,
  accounts,
  name,
  email,
  subject,
  onBack,
  backLabel,
  onRemoved,
  crmDialogAbove = false,
}: {
  account: string;
  threadId: string;
  /** Every connected mailbox, for the From picker and own-address reading. */
  accounts: string[];
  /** Who the conversation is with, as the list row named them. */
  name: string;
  email: string;
  subject: string;
  /**
   * Inside a person's window the thread is one of theirs: a strip above
   * the reader leads back to the person, and a conversation that leaves —
   * archived, deleted, junked, snoozed — is reported rather than closing
   * the window, which still has the rest of their mail to show.
   */
  onBack?: () => void;
  backLabel?: string;
  onRemoved?: () => void;
  /**
   * The window around this reader holds the Update CRM dialog.
   *
   * A person's window makes a new reader for each of their threads, and a
   * dialog in the reader would go the moment the reader opened another one.
   */
  crmDialogAbove?: boolean;
}) {
  const t = useMailT();
  const colorMode = useMailColorMode();
  const [zoom, adjustZoom] = useMailZoom();
  const { folders } = useMailFolders("all", { deferMs: 400 });

  // Rotate/jump-to-part can move the pane to another provider thread of the
  // same conversation — the same state MailPage keeps as `selected`.
  const [threadId, setThreadId] = React.useState(initialThreadId);
  const [focusMessageId, setFocusMessageId] = React.useState<
    string | undefined
  >(undefined);

  /**
   * What the list knew when it opened this window: the folded copies, the
   * snooze, the unread state. Read once — the note is one-shot — and held
   * for the life of the window.
   */
  const [handoff] = React.useState<ReaderWindowHandoff | null>(() =>
    readReaderHandoff(account, initialThreadId)
  );
  const [snoozedUntil, setSnoozedUntil] = React.useState<string | undefined>(
    handoff?.snoozedUntil
  );
  const [unread, setUnread] = React.useState(Boolean(handoff?.unread));

  /** The window's own title, for the browser popup; the shell sets its own. */
  React.useEffect(() => {
    if (subject) document.title = subject;
  }, [subject]);

  /**
   * The copies an action acts on: this thread, and every copy the row stood
   * for. The same rule as the list's own actions — a copy left behind takes
   * the row's place on the next refresh, and the row survives its own
   * deletion.
   */
  const everyKnownCopy = React.useCallback((): {
    account: string;
    threadId: string;
  }[] => {
    const own = { account, threadId };
    const out = [own];
    const seen = new Set([threadKey(own)]);
    for (const c of handoff?.copies ?? []) {
      const k = threadKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ account: c.account, threadId: c.threadId });
    }
    return out;
  }, [account, threadId, handoff]);

  const closeSelf = React.useCallback(() => {
    if (isNativeShell()) {
      void closeMailReaderWindow().catch(() => window.close());
      return;
    }
    window.close();
  }, []);

  const actOnEveryCopy = React.useCallback(
    async (path: string, extra?: Record<string, unknown>) => {
      await Promise.all(
        everyKnownCopy().map((c) =>
          apiJson(path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...c, ...extra }),
          })
        )
      );
    },
    [everyKnownCopy]
  );

  /** The action, then the window goes with the conversation. */
  const removeAndClose = React.useCallback(
    async (path: string, failure: string, extra?: Record<string, unknown>) => {
      try {
        await actOnEveryCopy(path, extra);
        signalMailChanged(account, threadId);
        if (onRemoved) onRemoved();
        else closeSelf();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : failure);
      }
    },
    [actOnEveryCopy, account, threadId, closeSelf, onRemoved]
  );

  const trash = React.useCallback(async () => {
    // Trash removes the conversation — drop pin + body cache with it, the
    // same as the list's own delete.
    for (const c of everyKnownCopy()) {
      unpinMailThread(c.account, c.threadId);
      invalidateCachedMailThread(c.account, c.threadId);
    }
    await removeAndClose("/api/mail/trash", "Couldn't delete");
  }, [everyKnownCopy, removeAndClose]);

  const toggleUnread = React.useCallback(async () => {
    const makeUnread = !unread;
    setUnread(makeUnread);
    try {
      await actOnEveryCopy(makeUnread ? "/api/mail/unread" : "/api/mail/read");
      signalMailChanged(account, threadId);
    } catch (err) {
      setUnread(!makeUnread);
      toast.error(err instanceof Error ? err.message : "Couldn't update");
    }
  }, [unread, actOnEveryCopy, account, threadId]);

  const moveToFolder = React.useCallback(
    async (folderName: string, create: boolean) => {
      // One copy, not every: filing is a choice about where this mailbox
      // keeps it, and the endpoint answers with the folder's real name.
      const json = await apiJson<{ folderName: string }>(
        "/api/mail/folders/move",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account, threadId, folderName, create }),
        }
      );
      toast.success(mailSay("movedToFolder", { name: json.folderName }));
      signalMailChanged(account, threadId);
    },
    [account, threadId]
  );

  return (
    <div
      className="mail-shell mail-surface-root fixed inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--mail-thread-bg,#fff)]"
      data-theme={colorMode}
    >
      {onBack ? (
        <div className="flex shrink-0 items-center border-b border-stone-200 bg-[var(--mail-thread)] px-3 py-1.5">
          <button
            type="button"
            title={t("back")}
            className="inline-flex min-w-0 items-center gap-1.5 text-sm text-teal-700 hover:underline"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{backLabel || t("back")}</span>
          </button>
        </div>
      ) : null}
      <ThreadPane
        key={`${account}|${threadId}|${focusMessageId ?? ""}`}
        account={account}
        accounts={accounts}
        threadId={threadId}
        focusMessageId={focusMessageId}
        zoom={zoom}
        onZoomAdjust={adjustZoom}
        // There is no list in this window, so there is no focus mode to
        // toggle: the handler stays unset and the control stays off the
        // toolbar.
        focusMode={false}
        onArchive={() =>
          void removeAndClose("/api/mail/archive", "Couldn't archive")
        }
        onTrash={(shown) => {
          // The pane names what it shows — the same check the main window
          // makes before a delete, kept here for the same reason.
          if (threadKey(shown) !== threadKey({ account, threadId })) {
            console.error(
              `[mail] refused a delete: the reader named ${threadKey(
                shown
              )} but this window holds ${threadKey({ account, threadId })}`
            );
            toast.error("Couldn't delete");
            return;
          }
          void trash();
        }}
        onJunk={() => void removeAndClose("/api/mail/junk", "Couldn't move it")}
        onMoveToInbox={() =>
          void actOnEveryCopy("/api/mail/unarchive")
            .then(() => {
              toast(mailSay("viewInbox"));
              signalMailChanged(account, threadId);
            })
            .catch((err) =>
              toast.error(err instanceof Error ? err.message : "Couldn't move")
            )
        }
        onMoveToFolder={moveToFolder}
        folders={folders}
        onSnooze={(untilIso) =>
          void removeAndClose("/api/mail/snooze", "Couldn't snooze", {
            until: untilIso,
          })
        }
        onCancelSnooze={
          snoozedUntil
            ? () =>
                void actOnEveryCopy("/api/mail/unsnooze")
                  .then(() => {
                    setSnoozedUntil(undefined);
                    signalMailChanged(account, threadId);
                  })
                  .catch((err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Couldn't update"
                    )
                  )
            : undefined
        }
        snoozedUntil={snoozedUntil}
        unread={unread}
        onToggleUnread={() => void toggleUnread()}
        inCrm={false}
        counterpartName={name}
        counterpartEmail={email}
        onChatPromoted={() => {}}
        onChatThreadChanged={(nextThreadId, _chat, nextFocusMessageId) => {
          setThreadId(nextThreadId);
          setFocusMessageId(nextFocusMessageId);
        }}
        onCrmChanged={() => {}}
        // No recipient picker lives anywhere else in this window, but the
        // main window has one: ask it, the way the chat popout does.
        onEditAsNew={(message) =>
          signalEditAsNewRequest({ account, threadId, messageId: message.id })
        }
        // The sent signal the main window already listens for — named for
        // the mailbox that sent, which the From picker may have changed.
        onSent={(accountEmail) => signalPopoutSend(accountEmail, threadId)}
      />
      {crmDialogAbove ? null : (
        <CrmProposalHost
          onCrmChanged={() => {}}
          // One thread in this window, so the proposals are always its own.
          onArchive={() =>
            void removeAndClose("/api/mail/archive", "Couldn't archive")
          }
        />
      )}
    </div>
  );
}
