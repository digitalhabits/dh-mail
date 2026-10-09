"use client";

/**
 * Every unsent message, from both places they live.
 *
 * Ours are in this browser and never reach Gmail or Outlook — that is a
 * deliberate choice, not an oversight, and the badge on each row is what keeps
 * it from being a surprise. The provider's are fetched.
 *
 * Read on demand rather than on load: the folders menu refreshes its counts
 * when it opens, and this follows it. Opening mail costs nothing.
 */

import * as React from "react";

import { mailApiJson as apiJson } from "@/lib/mail/api";
import { listMailDrafts, subscribeMailDrafts } from "@/lib/mail/local-drafts";
import { htmlToPlainText } from "@/lib/client-email-html";
import { emailsOfRecipients } from "@/lib/mail/contact-list-types";
import type { MailDraftRow } from "@/lib/mail/types";

/** One of ours, as a row. */
function localDraftRow(draft: Awaited<ReturnType<typeof listMailDrafts>>[number]): MailDraftRow {
  const body = htmlToPlainText(draft.body ?? "").trim();
  if (draft.kind === "compose") {
    return {
      id: draft.key,
      origin: "here",
      account: draft.from ?? "",
      threadId: null,
      subject: draft.subject.trim() || "(no subject)",
      snippet: body,
      to: emailsOfRecipients(draft.toList),
      updatedAt: new Date(draft.updatedAt).toISOString(),
      ...(draft.handedOver
        ? { handedOverAt: new Date(draft.handedOver.at).toISOString() }
        : null),
    };
  }
  return {
    id: draft.key,
    origin: "here",
    account: draft.account,
    threadId: draft.threadId,
    // A reply draft has no subject of its own; the thread owns it. The row
    // leans on the recipients and the text instead.
    subject: "",
    snippet: body,
    to: emailsOfRecipients(draft.toList),
    updatedAt: new Date(draft.updatedAt).toISOString(),
    ...(draft.handedOver
      ? { handedOverAt: new Date(draft.handedOver.at).toISOString() }
      : null),
  };
}

export function useMailDrafts(): {
  drafts: MailDraftRow[];
  loading: boolean;
  refresh: () => void;
} {
  /*
    Two lists, kept apart until they are shown.

    Ours are read from this browser and answer at once; the provider's are
    a round trip to Gmail or Outlook. Read together and shown together, a
    draft discarded here stayed on the list until the provider had
    answered about drafts it never held — seconds after the composer had
    closed on it. So a change to ours re-reads ours alone, and the
    provider's stand as last fetched until they are asked for again.
  */
  const [local, setLocal] = React.useState<MailDraftRow[]>([]);
  const [remote, setRemote] = React.useState<MailDraftRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const localRunRef = React.useRef(0);
  const remoteRunRef = React.useRef(0);

  const refreshLocal = React.useCallback(() => {
    const run = ++localRunRef.current;
    void listMailDrafts()
      .catch(() => [])
      .then((rows) => {
        if (run !== localRunRef.current) return;
        setLocal(rows.map(localDraftRow));
      });
  }, []);

  const refreshRemote = React.useCallback(() => {
    const run = ++remoteRunRef.current;
    setLoading(true);
    void apiJson<{ drafts?: MailDraftRow[] }>("/api/mail/drafts")
      .then((json) => json.drafts ?? [])
      // A mailbox we cannot reach leaves our own drafts listed rather
      // than emptying the view.
      .catch(() => [] as MailDraftRow[])
      .then((rows) => {
        if (run !== remoteRunRef.current) return;
        setRemote(rows);
        setLoading(false);
      });
  }, []);

  const refresh = React.useCallback(() => {
    refreshLocal();
    refreshRemote();
  }, [refreshLocal, refreshRemote]);

  // Ours change as they are typed; the provider's only change when refetched.
  React.useEffect(() => subscribeMailDrafts(refreshLocal), [refreshLocal]);

  const drafts = React.useMemo(
    () =>
      [...local, ...remote].sort((a, b) =>
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
      ),
    [local, remote]
  );

  return { drafts, loading, refresh };
}
