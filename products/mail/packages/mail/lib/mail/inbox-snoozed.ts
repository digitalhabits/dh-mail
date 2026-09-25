/*
 * The Snoozed tab: the threads that are asleep, from every mailbox.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */

import "server-only";

import { highlightRanges, searchHighlightTerms } from "@/lib/mail/search-highlight";
import { getThreadMetadata } from "@/lib/gmail/api";
import {
  filterAccountsForScope,
  type MailAccountScope,
} from "@/lib/mail/account-scope";
import { mailStore } from "@/lib/mail/store";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { getOutlookMailThread } from "@/lib/mail/outlook-inbox";
import { listConnectedMailAccounts } from "@/lib/mail/providers";
import type { MailThreadSummary } from "@/lib/mail/types";
import { classifyThread, crmLogoFor, crmNameFor, displayName } from "@/lib/mail/thread-classify";
import { METADATA_HEADERS, getClassifier, mapWithConcurrency, summarizeGmailThread } from "@/lib/mail/inbox-gmail-common";

/** Active snoozes as list rows, soonest wake first. */
export async function listSnoozedThreads(options: {
  account?: string;
  scope?: MailAccountScope;
  clerkUserId: string;
  /** Words typed in the search box; only rows with all of them come back. */
  q?: string;
}): Promise<{ accounts: string[]; threads: MailThreadSummary[] }> {
  const scope = options.scope ?? "all";
  const allAccounts = filterAccountsForScope(
    await listConnectedMailAccounts(options.clerkUserId),
    scope
  );
  const accountEmails = new Set(
    allAccounts
      .map((a) => a.email)
      .filter((email) => !options.account || email === options.account)
  );
  const providerByEmail = new Map(
    allAccounts.map((a) => [a.email, a.provider] as const)
  );

  const snoozed = await mailStore().snoozes.listActive(100);
  const rows = snoozed.filter((r) => accountEmails.has(r.accountEmail));
  if (!rows.length) {
    return { accounts: allAccounts.map((a) => a.email), threads: [] };
  }

  const classifier = await getClassifier(options.clerkUserId);
  const built = await mapWithConcurrency(
    rows,
    async (row): Promise<MailThreadSummary | null> => {
      const accountEmail = row.accountEmail;
      const threadId = row.threadId;
      const snoozedUntil = row.snoozedUntil;
      const provider = providerByEmail.get(accountEmail) ?? "gmail";
      try {
        if (provider === "outlook") {
          // One message is enough for a row. The list rule runs on that
          // message's envelope, the same rule the inbox applies to Graph's
          // newest message.
          const detail = await getOutlookMailThread(accountEmail, threadId, {
            limit: 1,
            markRead: false,
          });
          const latest = detail.messages[detail.messages.length - 1];
          const from = latest
            ? { name: latest.fromName, email: latest.fromEmail }
            : undefined;
          const to = (latest?.toEmails ?? []).map((email) => ({
            name: "",
            email,
          }));
          const cc = (latest?.ccEmails ?? []).map((email) => ({
            name: "",
            email,
          }));
          const { tab, counterpart, externalParticipants } = classifyThread({
            accountEmail,
            participants: [...(from ? [from] : []), ...to, ...cc],
            senders: from ? [from] : [],
            latestFrom: from,
            latestTo: to,
            classifier,
          });
          return {
            account: accountEmail,
            threadId,
            subject: detail.subject,
            fromName: displayName(counterpart),
            fromEmail: counterpart.email,
            snippet: latest?.bodyText?.slice(0, 160) ?? "",
            lastAt: latest?.sentAt ?? snoozedUntil,
            unread: false,
            messageCount: detail.messages.length,
            tab,
            externalParticipants,
            crmName: crmNameFor(counterpart.email, classifier),
            crmLogoUrl: crmLogoFor(counterpart.email, classifier),
            snoozedUntil,
          };
        }

        // The same row the inbox builds, minus the invite probe: a snoozed
        // row is a reminder, and the chip is not worth a payload per thread.
        const token = await accessTokenFor(accountEmail);
        const thread = await getThreadMetadata(
          token,
          threadId,
          METADATA_HEADERS
        );
        const built = await summarizeGmailThread({
          token,
          accountEmail,
          thread,
          classifier,
          resolveCalendar: false,
          snoozedUntil,
        });
        return built?.summary ?? null;
      } catch (err) {
        console.warn(
          `[mail] snoozed thread fetch failed for ${accountEmail}/${threadId}:`,
          err
        );
        return null;
      }
    }
  );

  // The Snoozed list is short and already in hand, so a search over it
  // is a look at each row: sender, subject, and the first words, with
  // the words the rows would mark. Filters such as has:attachment name
  // no text and leave every row in.
  const terms = searchHighlightTerms(options.q ?? "");
  const threads = built.filter((t): t is MailThreadSummary => t != null);
  const matching = terms.length
    ? threads.filter((t) => {
        const hay = [t.fromName, t.fromEmail, t.subject, t.snippet].filter(Boolean).join(" ");
        return terms.every((term) => highlightRanges(hay, [term]).length > 0);
      })
    : threads;
  return {
    accounts: allAccounts.map((a) => a.email),
    threads: matching,
  };
}
