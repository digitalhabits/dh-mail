import "server-only";

import {
  getVacationSettings,
  updateVacationSettings,
} from "@/lib/gmail/api";
import {
  filterAccountsForScope,
  type MailAccountScope,
} from "@/lib/mail/account-scope";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import {
  getOutlookAutoReply,
  setOutlookAutoReply,
} from "@/lib/mail/outlook-inbox";
import {
  listConnectedMailAccounts,
  resolveMailProvider,
} from "@/lib/mail/providers";
import { PlanError } from "@/lib/plan/errors";
import type { MailProvider } from "@/lib/mail/types";

export type MailAutoReply = {
  account: string;
  /** Which provider's settings these are. They do not offer the same things. */
  provider: MailProvider;
  /**
   * Whether the reply can carry a subject of its own. Outlook's cannot: the
   * reply carries the subject of whatever it answers. The dialog reads this,
   * not the provider name, to decide whether to show the box.
   */
  subjectSupported: boolean;
  enabled: boolean;
  subject: string;
  bodyHtml: string;
  restrictToContacts: boolean;
  /** Epoch ms; null when Gmail has no start/end set. */
  startTime: number | null;
  endTime: number | null;
  /** Token predates the settings scope — reconnect to manage auto-replies. */
  needsReconnect: boolean;
  /**
   * Why this mailbox has no auto-reply to show, when it has none.
   *
   * A personal Microsoft account is the case this exists for: Graph answers
   * `/me/mailboxSettings` with 404 for some of them, and the mailbox simply
   * cannot be told to reply automatically from here. Saying so is better
   * than a "Set up…" that fails, and far better than what this used to do —
   * one such account threw, the whole list failed, and every account lost
   * the out-of-office row.
   */
  unavailable?: string;
};

function toMailAutoReply(
  account: string,
  s: {
    enableAutoReply?: boolean;
    responseSubject?: string;
    responseBodyHtml?: string;
    responseBodyPlainText?: string;
    restrictToContacts?: boolean;
    startTime?: string;
    endTime?: string;
  }
): MailAutoReply {
  return {
    account,
    provider: "gmail",
    subjectSupported: true,
    enabled: s.enableAutoReply ?? false,
    subject: s.responseSubject ?? "",
    bodyHtml: s.responseBodyHtml || s.responseBodyPlainText || "",
    restrictToContacts: s.restrictToContacts ?? false,
    startTime: s.startTime ? Number(s.startTime) : null,
    endTime: s.endTime ? Number(s.endTime) : null,
    needsReconnect: false,
  };
}

/**
 * Vacation settings are optional chrome (banner + accounts menu). Cache briefly
 * so Mail remounts / the dialog don't re-hit Gmail while the inbox is busy.
 */
const AUTO_REPLY_CACHE_MS = 90_000;
const autoReplyCache = new Map<string, { at: number; data: MailAutoReply[] }>();

function invalidateAutoReplyCache(): void {
  autoReplyCache.clear();
}

/**
 * Auto-reply state for every mail-tab account. Accounts whose token predates
 * the settings scope come back with needsReconnect instead of failing the
 * whole request.
 *
 * Fetches accounts one-by-one: Promise.all of N vacation calls races the inbox
 * load and trips Gmail's "Too many concurrent requests for user" (429).
 */
export async function listMailAutoReplies(
  scope: MailAccountScope = "all",
  clerkUserId: string
): Promise<MailAutoReply[]> {
  const cacheKey = `${clerkUserId}|${scope}`;
  const cached = autoReplyCache.get(cacheKey);
  if (cached && Date.now() - cached.at < AUTO_REPLY_CACHE_MS) {
    return cached.data;
  }

  const accounts = filterAccountsForScope(
    await listConnectedMailAccounts(clerkUserId),
    scope
  );

  const results: MailAutoReply[] = [];
  for (const a of accounts) {
    /** An empty entry for this account, labelled with its own provider. */
    const blank = (): MailAutoReply => ({
      ...toMailAutoReply(a.email, {}),
      provider: a.provider,
      subjectSupported: a.provider !== "outlook",
    });
    try {
      if (a.provider === "outlook") {
        const reply = await getOutlookAutoReply(a.email);
        results.push({
          account: a.email,
          provider: "outlook",
          subjectSupported: false,
          subject: "",
          ...reply,
          needsReconnect: false,
        });
        continue;
      }
      const token = await accessTokenFor(a.email);
      results.push(toMailAutoReply(a.email, await getVacationSettings(token)));
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 403) {
        results.push({ ...blank(), needsReconnect: true });
        continue;
      }
      // Rate limit / blip: don't fail the whole page for optional UI chrome.
      if (status === 429 || status === 503) {
        results.push(blank());
        continue;
      }
      /**
       * Anything else is this mailbox's problem, and only this mailbox's.
       *
       * This used to rethrow. One account that could not answer — a personal
       * Microsoft account, whose mailbox settings Graph refuses with 404 —
       * failed the whole request, so the page got nothing and every account
       * lost its out-of-office row. A reader with one such account saw the
       * feature simply not exist.
       */
      console.warn(`[mail] auto-reply for ${a.email}:`, err);
      results.push({
        ...blank(),
        unavailable:
          status === 404 || status === 400 || status === 501
            ? "This mailbox cannot set an out-of-office reply from here. Set it in Outlook.com or the Outlook app."
            : "Couldn't read the out-of-office setting for this mailbox.",
      });
    }
  }

  autoReplyCache.set(cacheKey, { at: Date.now(), data: results });
  return results;
}

export async function setMailAutoReply(input: {
  account: string;
  enabled: boolean;
  subject: string;
  bodyHtml: string;
  restrictToContacts: boolean;
  startTime: number | null;
  endTime: number | null;
}): Promise<MailAutoReply> {
  if ((await resolveMailProvider(input.account)) === "outlook") {
    const updated = await setOutlookAutoReply(input);
    invalidateAutoReplyCache();
    return {
      account: input.account,
      provider: "outlook",
      subjectSupported: false,
      subject: "",
      ...updated,
      needsReconnect: false,
    };
  }
  const token = await accessTokenFor(input.account);
  try {
    const updated = await updateVacationSettings(token, {
      enableAutoReply: input.enabled,
      responseSubject: input.subject,
      responseBodyHtml: input.bodyHtml,
      restrictToContacts: input.restrictToContacts,
      // Gmail rejects a literal null; omit to clear the start/end.
      ...(input.startTime != null ? { startTime: String(input.startTime) } : null),
      ...(input.endTime != null ? { endTime: String(input.endTime) } : null),
    });
    invalidateAutoReplyCache();
    return toMailAutoReply(input.account, updated);
  } catch (err) {
    const status = (err as Error & { status?: number }).status;
    if (status === 403) {
      throw new PlanError(
        `The Gmail connection for ${input.account} predates auto-reply support — reconnect the account (Accounts menu) to manage auto-replies.`,
        403
      );
    }
    throw err;
  }
}
