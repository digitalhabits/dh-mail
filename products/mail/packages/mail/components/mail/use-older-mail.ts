"use client";

/*
 * "Older mail" under a search: once the local results are in, ask the
 * provider for matches older than the copy's body window, and keep the
 * ones the list does not hold already. See lib/mail/older-search.ts.
 */

import * as React from "react";

import { mailApiJson as apiJson } from "@/lib/mail/api";
import { olderMailBelow, olderSearchKey, type OlderMailMiss } from "@/lib/mail/older-mail-merge";
import type { MailThreadSummary } from "@/lib/mail/types";

type OlderState = {
  key: string;
  threads: MailThreadSummary[];
  missed: OlderMailMiss;
  loading: boolean;
};

const NONE: OlderState = { key: "", threads: [], missed: null, loading: false };

export type OlderMail = {
  /** The older threads to show, none of them in the local results. */
  threads: MailThreadSummary[];
  loading: boolean;
  missed: OlderMailMiss;
};

export function useOlderMail(input: {
  /** The search, or "" for none. */
  query: string;
  /** One mailbox, or undefined for every one the search covers. */
  account: string | undefined;
  /**
   * The mailboxes shown now. A mailbox shown again during a search (one
   * hidden on a schedule, say) is searched too, so the set is in the key.
   */
  mailboxes: readonly string[];
  /**
   * Whether this search reaches older mail at all. Not inside a folder or
   * a view of its own: the server search is of All Mail.
   */
  enabled: boolean;
  /** The local results are in. The older search waits for them. */
  localReady: boolean;
  /** The local results, to leave out of the older ones. */
  localThreads: readonly MailThreadSummary[];
}): OlderMail {
  const { query, account, mailboxes, enabled, localReady, localThreads } = input;
  const key = enabled ? olderSearchKey(query, account, mailboxes) : "";
  const [state, setState] = React.useState<OlderState>(NONE);
  const started = React.useRef<{ key: string; controller: AbortController } | null>(null);

  // The search changed or ended: stop the one under way. Its answer is
  // not used, and Rust does not ask the server if it has not yet.
  React.useEffect(() => {
    if (started.current && started.current.key !== key) {
      started.current.controller.abort();
      started.current = null;
    }
  }, [key]);
  React.useEffect(() => () => started.current?.controller.abort(), []);

  React.useEffect(() => {
    // Once for each search. The list reloads as the copy changes, and each
    // reload must not ask the server again.
    if (!key || !localReady || started.current?.key === key) return;
    const controller = new AbortController();
    started.current = { key, controller };
    setState({ key, threads: [], missed: null, loading: true });
    const params = new URLSearchParams({ q: query });
    if (account) params.set("account", account);
    const own = () => started.current?.controller === controller;
    apiJson<{ threads?: MailThreadSummary[]; missed?: OlderMailMiss }>(
      `/api/mail/threads/older?${params.toString()}`,
      { signal: controller.signal }
    )
      .then((json) => {
        if (!own()) return;
        const threads = Array.isArray(json.threads) ? json.threads : [];
        setState({ key, threads, missed: json.missed ?? null, loading: false });
      })
      .catch(() => {
        // No toast: the local results stand, and the list says it quietly.
        if (own()) setState({ key, threads: [], missed: "failed", loading: false });
      });
  }, [key, localReady, query, account]);

  const current = state.key === key && key ? state : NONE;
  const threads = React.useMemo(
    () => olderMailBelow(localThreads, current.threads),
    [localThreads, current.threads]
  );
  return { threads, loading: current.loading, missed: current.missed };
}
