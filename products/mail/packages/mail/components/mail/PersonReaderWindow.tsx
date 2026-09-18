"use client";

/**
 * One person's mail in an ordinary window of its own.
 *
 * The people view's reading pane, taken to a window: the same PersonPane the
 * main window shows for a person — their conversations, archive and delete
 * for all of them — and, when one is opened, the same ThreadReaderWindow a
 * double-clicked thread gets, with a strip that leads back to the person.
 * A person with one conversation opens on it, the rule the main window
 * keeps (see landOnPerson).
 *
 * There is no list here to work the person out from, so the row travels
 * with the window (see PersonWindowHandoff) and is kept in sessionStorage
 * after that, so a reload of the window does not empty it. The actions call
 * the endpoints the main window calls, on every copy of each conversation,
 * and the window closes when the last conversation has gone.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";

import { CrmProposalHost } from "@/components/mail/CrmProposalHost";
import { PersonPane } from "@/components/mail/PersonPane";
import { ThreadReaderWindow } from "@/components/mail/ThreadReaderWindow";
import { useMailZoom } from "@/components/mail/use-mail-layout";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import type { PersonRow } from "@/lib/mail/person-participants";
import { unpinMailThread } from "@/lib/mail/pins";
import {
  readPersonHandoff,
  signalMailChanged,
  writeReaderHandoff,
} from "@/lib/mail/reader-window";
import { invalidateCachedMailThread } from "@/lib/mail/thread-cache";
import { threadKey } from "@/lib/mail/thread-copies";
import { useMailColorMode } from "@/lib/mail/theme";
import type { MailThreadSummary } from "@/lib/mail/types";
import { closeMailReaderWindow, isNativeShell } from "@/lib/native-shell";

const KEPT_PREFIX = "redd-plan-mail-person-window:";

/** This conversation and every copy the row stood for. */
function copiesOf(
  t: MailThreadSummary
): { account: string; threadId: string }[] {
  const out = [{ account: t.account, threadId: t.threadId }];
  const seen = new Set([threadKey(t)]);
  for (const c of t.alsoIn ?? []) {
    const k = threadKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ account: c.account, threadId: c.threadId });
  }
  return out;
}

function post(path: string, body: Record<string, unknown>): Promise<unknown> {
  return apiJson(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Hand the reader what the list would have: the copies, the unread state. */
function noteForReader(t: MailThreadSummary): void {
  writeReaderHandoff(t.account, t.threadId, {
    copies: copiesOf(t),
    unread: t.unread,
  });
}

export function PersonReaderWindow({
  personKey,
  accounts,
}: {
  personKey: string;
  /** Every connected mailbox, for the From picker on a reply. */
  accounts: string[];
}) {
  const colorMode = useMailColorMode();
  const [zoom, adjustZoom] = useMailZoom();
  const kept = KEPT_PREFIX + personKey;

  const [row, setRow] = React.useState<PersonRow | null>(() => {
    // What this window last held, with every archive since the note was
    // written; then the note itself, which readPersonHandoff keeps for a
    // second ask.
    try {
      const raw = window.sessionStorage.getItem(kept);
      if (raw) return JSON.parse(raw) as PersonRow;
    } catch {
      /* no storage: nothing to show, and the page says so */
    }
    return readPersonHandoff(personKey)?.row ?? null;
  });
  React.useEffect(() => {
    try {
      if (row) window.sessionStorage.setItem(kept, JSON.stringify(row));
      else window.sessionStorage.removeItem(kept);
    } catch {
      /* the window works without it until it is reloaded */
    }
  }, [kept, row]);

  // One conversation opens on itself, the rule the main window keeps. The
  // reader reads its note as it mounts, so the note is written here, before
  // it renders.
  const [open, setOpen] = React.useState<MailThreadSummary | null>(() => {
    if (!row || row.threads.length !== 1) return null;
    noteForReader(row.threads[0]);
    return row.threads[0];
  });

  /**
   * The window's own title, for the browser popup; the shell sets its own.
   * The reader names the window after its thread while one is open, so the
   * person's name is put back when the reader goes.
   */
  React.useEffect(() => {
    if (!open && row?.name) document.title = row.name;
  }, [row?.name, open]);

  const closeSelf = React.useCallback(() => {
    if (isNativeShell()) {
      void closeMailReaderWindow().catch(() => window.close());
      return;
    }
    window.close();
  }, []);

  /** These conversations have left: out of the row, and out of the reader. */
  const dropThreads = React.useCallback((keys: string[]) => {
    setRow((current) => {
      if (!current) return current;
      const threads = current.threads.filter(
        (t) => !keys.includes(threadKey(t))
      );
      return { ...current, threads, unread: threads.some((t) => t.unread) };
    });
    setOpen((current) =>
      current && keys.includes(threadKey(current)) ? null : current
    );
  }, []);

  // The last conversation gone takes the window with it, the way a thread's
  // window goes with its thread.
  React.useEffect(() => {
    if (row && row.threads.length === 0) closeSelf();
  }, [row, closeSelf]);

  const openThread = (t: MailThreadSummary) => {
    noteForReader(t);
    setOpen(t);
  };

  /** The action on every copy of each conversation, then out of the row. */
  const removeThreads = async (
    targets: MailThreadSummary[],
    path: string,
    failure: string,
    beforeEach?: (t: MailThreadSummary) => void
  ) => {
    const results = await Promise.allSettled(
      targets.map(async (t) => {
        beforeEach?.(t);
        await Promise.all(copiesOf(t).map((c) => post(path, c)));
        signalMailChanged(t.account, t.threadId);
        return threadKey(t);
      })
    );
    const done = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : []
    );
    if (done.length) dropThreads(done);
    if (done.length < results.length) toast.error(failure);
  };

  const archiveThreads = (targets: MailThreadSummary[]) =>
    removeThreads(targets, "/api/mail/archive", "Couldn't archive");

  const trashThreads = (targets: MailThreadSummary[]) =>
    removeThreads(targets, "/api/mail/trash", "Couldn't delete", (t) => {
      // Trash removes the conversation — drop pin and body cache with it,
      // the same as the list's own delete.
      for (const c of copiesOf(t)) {
        unpinMailThread(c.account, c.threadId);
        invalidateCachedMailThread(c.account, c.threadId);
      }
    });

  const markUnread = (keys: Set<string>, unread: boolean) => {
    setRow((current) => {
      if (!current) return current;
      const threads = current.threads.map((t) =>
        keys.has(threadKey(t)) ? { ...t, unread } : t
      );
      return { ...current, threads, unread: threads.some((t) => t.unread) };
    });
  };

  /** The same rule as the list's rows: any unread → all read; else newest unread. */
  const toggleRead = async (rows: MailThreadSummary[], label: string) => {
    const unread = rows.filter((t) => t.unread);
    if (unread.length) {
      const keys = new Set(unread.map((t) => threadKey(t)));
      markUnread(keys, false);
      try {
        await Promise.all(
          unread.map((t) =>
            post("/api/mail/read", { account: t.account, threadId: t.threadId })
          )
        );
        for (const t of unread) signalMailChanged(t.account, t.threadId);
      } catch {
        markUnread(keys, true);
        toast.error(`Couldn't mark ${label} read`);
      }
      return;
    }
    const newest = rows[0];
    if (!newest) return;
    const keys = new Set([threadKey(newest)]);
    markUnread(keys, true);
    try {
      await post("/api/mail/unread", {
        account: newest.account,
        threadId: newest.threadId,
      });
      signalMailChanged(newest.account, newest.threadId);
    } catch {
      markUnread(keys, false);
      toast.error(`Couldn't mark ${label} unread`);
    }
  };

  if (!row) {
    return (
      <div
        className="mail-shell mail-surface-root fixed inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--mail-thread-bg,#fff)]"
        data-theme={colorMode}
      >
        <p className="p-6 text-sm text-stone-500">
          Nothing to show here — open this window from the mail client.
        </p>
      </div>
    );
  }

  /*
    Update CRM, held by this window and not by the reader. The reader is made
    again for each conversation, and the dialog stays while the reader goes
    back to the person and opens another one. First in both branches below,
    so React keeps it where it is when the window moves between them.
  */
  const crmHost = (
    <CrmProposalHost
      onCrmChanged={() => {}}
      onArchive={(origin) => {
        const t = row.threads.find((x) => threadKey(x) === threadKey(origin));
        if (t) void archiveThreads([t]);
      }}
    />
  );

  if (open) {
    const openKey = threadKey(open);
    return (
      <>
        {crmHost}
        <ThreadReaderWindow
          key={openKey}
          account={open.account}
          threadId={open.threadId}
          accounts={accounts}
          name={row.name}
          email={row.email}
          subject={open.subject}
          // One conversation has nothing to go back to.
          onBack={row.threads.length > 1 ? () => setOpen(null) : undefined}
          backLabel={row.name}
          onRemoved={() => dropThreads([openKey])}
          crmDialogAbove
        />
      </>
    );
  }

  return (
    <>
      {crmHost}
      <div
        className="mail-shell mail-surface-root fixed inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--mail-thread-bg,#fff)]"
        data-theme={colorMode}
      >
        <PersonPane
          row={row}
          onOpenThread={openThread}
          zoom={zoom}
          onZoomAdjust={adjustZoom}
          onArchiveAll={() => void archiveThreads(row.threads)}
          onDeleteAll={() => void trashThreads(row.threads)}
          onToggleRead={(rows, label) => void toggleRead(rows, label)}
          onArchiveThread={(t) => void archiveThreads([t])}
          onTrashThread={(t) => void trashThreads([t])}
        />
      </div>
    </>
  );
}
