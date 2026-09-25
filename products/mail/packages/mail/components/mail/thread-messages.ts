"use client";

import * as React from "react";
import { isPendingLocalMessage, type OutboxStatus } from "@/components/mail/MailBubble";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import { type MailRecipient } from "@/lib/mail/contact-list-types";
import { signalPopoutSend } from "@/lib/mail/popout";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import type { DraftAttachmentSnapshot } from "@/lib/mail/local-drafts";
import { sanitizeEmailHtml, stripQuotedHtml } from "@/lib/mail/email-html";
import { replyHistoryEntry } from "@/lib/mail/reply-history";
import { restoreAnchorsForEditing } from "@/lib/mail/soften-anchors";

/** What the composer at the bottom of a thread is currently writing. */
export type ComposerMode = "reply" | "replyAll" | "forward";

/**
 * What makes a message the same message across two pages.
 *
 * The provider's item id is not it. Cc'd to yourself, Exchange holds two
 * items with one Message-ID, and the server folds them — but the two are
 * seconds apart, so a page boundary can fall between them and hand the
 * second one back on the next page as something new. The id it shares with
 * its twin is the one to compare.
 */
export function messageKey(m: { id: string; rfcMessageId?: string }): string {
  return m.rfcMessageId?.trim().toLowerCase() || m.id;
}

export function messageKeys(
  messages: { id: string; rfcMessageId?: string }[]
): Set<string> {
  return new Set(messages.map(messageKey));
}

/** Where the composer stops being a card and becomes the whole pane. */

export type OutboxEntry = {
  status: OutboxStatus;
  mode: ComposerMode;
  reply: string;
  /** The subject the writer set, if they set one. Empty means the thread's. */
  subject: string;
  /**
   * Under a name of its own, so it is not part of the thread it answers.
   *
   * No bubble is put in that thread for it, and it is said in a toast
   * instead — the message is on its way to a conversation of its own.
   */
  startsNewThread?: boolean;
  toList: MailRecipient[];
  ccList: MailRecipient[];
  showCc: boolean;
  editRecipients: boolean;
  includeSignature: boolean;
  fromAccount: string;
  /**
   * The files that were in the strip, so that Undo can put them back.
   *
   * Not the same as `request.attachments`. That one is what goes to the
   * provider. This one is what the strip shows, and Send empties the strip
   * with the composer. A reaction has no files and leaves this out.
   */
  attachments?: DraftAttachmentSnapshot[];
  /**
   * Set for a forward only: what Undo needs beyond the composer's own fields.
   *
   * A forward waits out the same count as a reply. It has no bubble in the
   * thread, because it goes to somebody else, so a toast says that it went.
   * The two boxes under the composer are not part of the composer's state,
   * and Send resets them, so they travel here.
   */
  forward?: {
    /** The message that was picked to forward. Null: the newest one. */
    quoteMessageId: string | null;
    /** The "include its files" box. */
    includeFiles: boolean;
    /** The "whole conversation" box: the fetched thread, or null for off. */
    conversation: MailMessage[] | null;
    /** The recipients as the toast names them. */
    who: string;
  };
  /** POST /api/mail/send body (minus account-specific bits filled at send time). */
  request: {
    account: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    html?: string;
    includeSignature: boolean;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    discardProviderDraft?: string;
    /** The thread's history, rebuilt by the composer. */
    appendix?: { text: string; html: string };
    /** The one message that a forward carries. Left out for a whole conversation. */
    forward?: {
      fromName: string;
      fromEmail: string;
      date: string;
      subject: string;
      to: string[];
      text: string;
      html?: string;
    };
    noQuote?: boolean;
    messageCount?: number;
    /** After send, Grok prepends Notes on related CRM records. */
    updateCrmNotes?: boolean;
    attachments?: {
      filename: string;
      mimeType: string;
      contentBase64: string;
    }[];
    /**
     * Hold until this time (ISO 8601). Outlook only.
     *
     * A scheduled reply never reaches the outbox — nothing is in flight to
     * retry or to paint ahead of — so this is only ever set on the body that
     * goes straight out.
     */
    sendAt?: string;
  };
};
/**
 * After send, providers can take a moment to index the message into the
 * conversation. Refetch with backoff and keep any optimistic bubble until
 * a real copy shows up (see mergeNewestThreadPage).
 */
export function scheduleThreadRefetchAfterSend(
  account: string,
  threadId: string,
  setThread: React.Dispatch<React.SetStateAction<MailThreadDetail | null>>
): void {
  /*
    Tell the other windows first. The pop-out chat on this thread polls on
    a slow clock, and a reply sent from the reader took until that clock's
    next tick to appear in it — the same signal the pop-out already sends
    the reader, made mutual.
  */
  signalPopoutSend(account, threadId);
  const delaysMs = [800, 2000, 4500];
  void (async () => {
    for (const delayMs of delaysMs) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, delayMs);
      });
      try {
        const params = new URLSearchParams({ account, id: threadId });
        const json = await apiJson<{ thread: MailThreadDetail }>(
          `/api/mail/thread?${params.toString()}`
        );
        let stillHasLocal = false;
        setThread((current) => {
          if (!current) return json.thread;
          const merged = mergeNewestThreadPage(current, json.thread);
          stillHasLocal = merged.messages.some((m) =>
            isPendingLocalMessage(m.id)
          );
          return merged;
        });
        if (!stillHasLocal) return;
      } catch {
        /* keep optimistic bubble; try again */
      }
    }
  })();
}


/** Merge a newest-page fetch into a thread that may already have older pages. */
export function mergeNewestThreadPage(
  current: MailThreadDetail,
  newest: MailThreadDetail
): MailThreadDetail {
  const pageIds = new Set(newest.messages.map((m) => m.id));
  const pageOldestAt = Date.parse(newest.messages[0]?.sentAt ?? "");
  const older = current.messages.filter((m) => {
    if (pageIds.has(m.id)) return false;
    // Keep optimistic local-* bubbles until the provider returns a match.
    if (isPendingLocalMessage(m.id)) {
      return !optimisticCoveredBy(m, newest.messages);
    }
    const at = Date.parse(m.sentAt ?? "");
    return Number.isFinite(pageOldestAt) && Number.isFinite(at)
      ? at < pageOldestAt
      : true;
  });
  // Locals that still aren't indexed belong after the server page (newest).
  const pendingLocal = older.filter((m) => isPendingLocalMessage(m.id));
  const olderHistory = older.filter((m) => !isPendingLocalMessage(m.id));
  return {
    ...newest,
    messages: [...olderHistory, ...newest.messages, ...pendingLocal],
    hasOlder: olderHistory.length ? current.hasOlder : newest.hasOlder,
  };
}


/**
 * True when a real (provider) message is the indexed copy of an optimistic
 * local-* bubble. Providers (especially Outlook) can lag on conversation
 * queries right after send — we must not drop the bubble until then.
 */
function optimisticCoveredBy(
  local: MailMessage,
  reals: MailMessage[]
): boolean {
  const localLead = optimisticBodyLead(local.bodyText);
  const localAt = Date.parse(local.sentAt ?? "") || 0;
  return reals.some((m) => {
    if (!m.own || isPendingLocalMessage(m.id)) return false;
    const at = Date.parse(m.sentAt ?? "") || 0;
    if (localAt && at && Math.abs(at - localAt) > 15 * 60 * 1000) return false;
    const lead = optimisticBodyLead(m.bodyText);
    if (!localLead) return Math.abs(at - localAt) < 2 * 60 * 1000;
    const n = Math.min(40, localLead.length, lead.length || 40);
    if (n <= 0) return Math.abs(at - localAt) < 2 * 60 * 1000;
    return (
      lead.slice(0, n) === localLead.slice(0, n) ||
      lead.includes(localLead.slice(0, Math.min(30, localLead.length))) ||
      localLead.includes(lead.slice(0, Math.min(30, lead.length)))
    );
  });
}

/** Normalize body text for matching optimistic bubbles to provider copies. */
function optimisticBodyLead(text: string): string {
  return text.trim().replace(/\s+/g, " ").slice(0, 120).toLowerCase();
}

/**
 * Every message of a provider thread, oldest first.
 *
 * The thread API answers a window — up to a hundred messages — so this asks
 * for the oldest window and then each one after it until the provider says
 * there is nothing newer. Local pending sends are left out: they are not in
 * the thread yet, and a forward should carry what was sent.
 */
export async function loadWholeThread(
  account: string,
  threadId: string
): Promise<MailMessage[]> {
  const out: MailMessage[] = [];
  let after: string | null = null;
  // Twenty pages is two thousand messages. A thread past that is not one
  // anybody forwards whole; the cap is there so a provider that always says
  // "newer" cannot keep this going for ever.
  for (let page = 0; page < 20; page += 1) {
    const params = new URLSearchParams({
      account,
      id: threadId,
      markRead: "0",
      limit: "100",
    });
    if (after) params.set("after", after);
    else params.set("oldest", "1");
    const json = await apiJson<{ thread: MailThreadDetail }>(
      `/api/mail/thread?${params.toString()}`
    );
    const got = json.thread.messages.filter(
      (m) => !isPendingLocalMessage(m.id)
    );
    out.push(...got);
    const last = json.thread.messages[json.thread.messages.length - 1];
    if (!json.thread.hasNewer || !last) break;
    after = last.id;
  }
  return out;
}

/**
 * The message's own words, shaped for the rebuilt history.
 *
 * Each entry goes in stripped of its own quoted tail: quoting bodies
 * whole would nest every mail's tail inside the new one and send the
 * thread many times over. A message that is nothing but a quote falls
 * back to its full text rather than vanishing.
 */
export function historyEntryOf(m: MailMessage) {
  let html: string | undefined;
  if (m.bodyHtml) {
    const safe = sanitizeEmailHtml(m.bodyHtml);
    const split = stripQuotedHtml(safe);
    // The same put-back as a copied message needs. This tail is quoted
    // into a mail that goes out, where a span carrying an address is a
    // dead link at the other end — nobody there has our click bridge.
    html = restoreAnchorsForEditing(
      split.hadQuote && split.html.trim() ? split.html : safe
    );
  }
  return replyHistoryEntry(m, html);
}
