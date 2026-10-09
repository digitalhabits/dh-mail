/**
 * "Older mail": search results that only the provider can give.
 *
 * Once a mailbox is in the copy, a search reads the copy. The copy holds
 * the headers of every message, but the body only for the last 12 months.
 * So a word deep in an older mail is not found there. After the local
 * search, the list asks the provider for matches older than that window,
 * and shows the ones it does not hold already under the heading "Older
 * mail". See docs/mail-local-store.md, section 6.
 *
 * - Gmail: over IMAP, by `mail_sync_search_older` in the crate
 *   (older_search.rs). Not the Gmail API: its budget is why the copy
 *   exists. The server's answer is mapped to rows the copy already has.
 * - Outlook: nothing to ask. Graph sends the body with each message the
 *   sync reads, so the copy holds the words of every message it holds.
 * - Exchange: not yet. See the TODO in `askMailbox`.
 *
 * A mailbox that is offline, or a server search that fails, gives nothing
 * here, and the list keeps its local results. No toast: the list says it
 * in one quiet line.
 */

import "server-only";

import { filterAccountsForScope } from "@/lib/mail/account-scope";
import { summaryFromStored } from "@/lib/mail/inbox-list";
import { getClassifier } from "@/lib/mail/inbox-gmail-common";
import { stateServes, syncStates } from "@/lib/mail/local-store";
import type { OlderMailMiss } from "@/lib/mail/older-mail-merge";
import { listConnectedMailAccounts } from "@/lib/mail/providers";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import type { MailStoredThread } from "@/lib/mail/store/types";
import type { Classifier } from "@/lib/mail/thread-classify";
import type { MailProvider, MailThreadSummary } from "@/lib/mail/types";

/** Threads asked for from each mailbox. */
const OLDER_PER_ACCOUNT = 50;

export type { OlderMailMiss };

export type OlderMailAnswer = {
  threads: MailThreadSummary[];
  missed: OlderMailMiss;
};

type MailboxAnswer = { threads: MailThreadSummary[]; missed: OlderMailMiss };

const NOTHING: MailboxAnswer = { threads: [], missed: null };

/**
 * Ask each mailbox in the search for mail older than its body window.
 * Never throws: a mailbox that cannot answer says why in `missed`.
 */
export async function searchOlderMail(input: {
  clerkUserId: string;
  q: string;
  /** One mailbox, or undefined for every one a search covers. */
  account?: string;
  /** The search changed or ended: stop, and give nothing. */
  signal?: AbortSignal;
}): Promise<OlderMailAnswer> {
  const q = input.q.trim();
  if (!q) return { threads: [], missed: null };
  // A search covers every mailbox in the tab, as listUnifiedInbox does.
  const accounts = filterAccountsForScope(await listConnectedMailAccounts(input.clerkUserId), "all").filter(
    (a) => !input.account || a.email.toLowerCase() === input.account.toLowerCase()
  );
  const classifier = await getClassifier(input.clerkUserId);
  const answers = await Promise.all(
    accounts.map((a) =>
      askMailbox({ account: a.email, provider: a.provider, q, classifier, signal: input.signal })
    )
  );
  if (input.signal?.aborted) return { threads: [], missed: null };
  const threads = answers.flatMap((a) => a.threads);
  threads.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
  const missed = answers.some((a) => a.missed === "failed")
    ? "failed"
    : answers.some((a) => a.missed === "offline")
      ? "offline"
      : null;
  return { threads, missed };
}

async function askMailbox(input: {
  account: string;
  provider: MailProvider;
  q: string;
  classifier: Classifier;
  signal?: AbortSignal;
}): Promise<MailboxAnswer> {
  // TODO(exchange): ask EWS for the same older-than-the-window case. Use
  // FindItem with a QueryString (AQS) on the folders the copy holds, and
  // a received date before Date.now() - BODY_SINCE_MS (exchange-bodies.ts).
  // Map the item ids to the rows the copy holds, as the Gmail path does.
  // Two rules: the fake server in ews_fixtures.rs must refuse what the
  // real server refuses, so each rule needs a fixture from a real answer
  // first; and an `ews:refused` answer is never asked again.
  if (input.provider !== "gmail") return NOTHING;
  const invoke = tauriInvoke();
  if (!invoke) return NOTHING;
  const state = (await syncStates()).find(
    (s) => s.account.toLowerCase() === input.account.toLowerCase() && s.folder === ""
  );
  // No copy: the provider answered the search itself, across all the mail.
  // A copy still on its first read does not hold the older rows yet.
  if (!stateServes(state) || state?.phase === "full") return NOTHING;
  if (state?.phase !== "live" || isOffline()) return { threads: [], missed: "offline" };
  return askGmail(invoke, input);
}

async function askGmail(
  invoke: NonNullable<ReturnType<typeof tauriInvoke>>,
  input: { account: string; q: string; classifier: Classifier; signal?: AbortSignal }
): Promise<MailboxAnswer> {
  if (input.signal?.aborted) return NOTHING;
  // A search that is still waiting for its connection does not ask the
  // server when the reader moves on, and its answer is not used.
  const cancel = () => {
    void Promise.resolve(invoke("mail_sync_search_older_cancel", { account: input.account })).catch(() => undefined);
  };
  input.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const answer = (await invoke("mail_sync_search_older", {
      account: input.account,
      query: input.q,
      limit: OLDER_PER_ACCOUNT,
    })) as { threads?: MailStoredThread[]; handled?: boolean; superseded?: boolean };
    if (input.signal?.aborted || answer.superseded) return NOTHING;
    const rows = Array.isArray(answer.threads) ? answer.threads : [];
    return { threads: rows.map((t) => summaryFromStored(t, input.classifier).summary), missed: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mail] older mail search failed for ${input.account}: ${message}`);
    return { threads: [], missed: "failed" };
  } finally {
    input.signal?.removeEventListener("abort", cancel);
  }
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}
