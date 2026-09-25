/*
 * The drafts the providers hold: listing them, and discarding one.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */

import "server-only";

import { localStoreServes, queueLocalAction } from "@/lib/mail/local-store";
import { decodeSnippet, headerValue, parseAddressList, listMessageIds, getMessageMetadata, findGmailDraftIdForMessage, deleteGmailDraft } from "@/lib/gmail/api";
import { mailStore } from "@/lib/mail/store";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { outlookAccessTokenFor } from "@/lib/mail/outlook-inbox";
import { deleteOutlookMessage, listOutlookDraftMessages } from "@/lib/outlook/api";
import { resolveMailProvider } from "@/lib/mail/providers";
import type { MailDraftRow } from "@/lib/mail/types";
import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { METADATA_HEADERS, mapWithConcurrency, messageDate } from "@/lib/mail/inbox-gmail-common";

/**
 * Throw away the Gmail draft this reply came from.
 *
 * Never fatal. The mail is already sent, and telling the reader their message
 * failed because a leftover draft could not be tidied would be a lie.
 */
export async function discardGmailDraft(
  token: string,
  messageId: string,
  threadId?: string
): Promise<void> {
  try {
    const draftId = await findGmailDraftIdForMessage(
      token,
      messageId,
      threadId
    );
    if (draftId) {
      await deleteGmailDraft(token, draftId);
      return;
    }
    // Nothing matched, so Gmail keeps an unsent copy of a message that has
    // gone out — and the reader sees it offered back to them next time they
    // open the thread. Not fatal, but never silent again.
    console.warn(
      `[mail] no Gmail draft matched ${messageId} (thread ${threadId ?? "?"}) — it was not discarded`
    );
  } catch (err) {
    console.warn("[mail] could not discard the Gmail draft:", err);
  }
}

/** The same, for Outlook, where the draft is deleted by its message id. */
export async function discardOutlookDraft(
  account: string,
  messageId: string
): Promise<void> {
  try {
    const token = await outlookAccessTokenFor(account);
    await deleteOutlookMessage(token, messageId);
  } catch (err) {
    console.warn("[mail] could not discard the Outlook draft:", err);
  }
}

/**
 * Throw away the draft the provider is holding for a thread.
 *
 * Called when the reader discards a reply here, after the undo window has
 * closed — never during it. A Gmail draft cannot be un-deleted, so the only
 * honest way to offer Undo is to have not done anything yet.
 *
 * `ref` is the draft's message id, as `getMailThread` reported it. Gmail
 * hands a draft a new message id every time it saves, so `threadId` is passed
 * as the second way in — see `findGmailDraftIdForMessage`.
 */
export async function discardProviderDraft(input: {
  account: string;
  ref: string;
  threadId?: string;
}): Promise<void> {
  if ((await resolveMailProvider(input.account)) === "outlook") {
    await discardOutlookDraft(input.account, input.ref);
    invalidateInboxCache();
    return;
  }
  if (await queueLocalAction(input.account, input.threadId ?? "", "discardDraft", { messageId: input.ref })) {
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(input.account);
  await discardGmailDraft(token, input.ref, input.threadId);
  invalidateInboxCache();
}

/** A long list of forgotten drafts is not a list anyone reads. */
const MAX_DRAFT_ROWS = 50;
/**
 * The unsent messages a provider is holding, for the Drafts view.
 *
 * Local drafts are not here: they live in the browser, and the view adds them.
 * This is only the half that needs the network.
 */
export async function listProviderDrafts(
  account: string
): Promise<MailDraftRow[]> {
  if ((await resolveMailProvider(account)) === "outlook") {
    const token = await outlookAccessTokenFor(account);
    const drafts = await listOutlookDraftMessages(token, MAX_DRAFT_ROWS);
    return drafts.map((m) => ({
      id: m.id,
      origin: "outlook" as const,
      account,
      threadId: m.conversationId ?? null,
      subject: (m.subject || "").trim() || "(no subject)",
      snippet: (m.bodyPreview || "").trim(),
      to: (m.toRecipients ?? [])
        .map((r) => r.emailAddress?.address ?? "")
        .filter(Boolean),
      updatedAt: m.lastModifiedDateTime || m.sentDateTime || null,
    }));
  }

  // The copy holds the drafts too: they sit in All Mail with the draft
  // label. One query, no reads.
  if (await localStoreServes(account)) {
    const page = await mailStore().messages.list({ accounts: [account], view: "drafts", limit: MAX_DRAFT_ROWS });
    return page.threads.map((t) => ({
      id: t.latest.messageId,
      origin: "gmail" as const,
      account,
      threadId: t.threadId,
      subject: t.subject.trim() || "(no subject)",
      snippet: t.latest.snippet,
      to: t.latest.to.map((a) => a.email),
      updatedAt: t.latest.sentAt ? new Date(t.latest.sentAt).toISOString() : null,
    }));
  }

  const token = await accessTokenFor(account);
  const { ids } = await listMessageIds(token, "in:drafts");
  const rows = await mapWithConcurrency(
    ids.slice(0, MAX_DRAFT_ROWS),
    async (id) => {
      const m = await getMessageMetadata(token, id, METADATA_HEADERS);
      return {
        id: m.id,
        origin: "gmail" as const,
        account,
        threadId: m.threadId ?? null,
        subject: headerValue(m, "Subject").trim() || "(no subject)",
        snippet: decodeSnippet(m.snippet ?? ""),
        to: parseAddressList(headerValue(m, "To")).map((p) => p.email),
        updatedAt: messageDate(m)
          ? new Date(messageDate(m)).toISOString()
          : null,
      };
    }
  );
  return rows;
}
