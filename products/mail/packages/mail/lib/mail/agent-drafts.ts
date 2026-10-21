/**
 * Drafts another program made through the drafts folder, as Mail answers
 * for them (lib/mail/drafts-inbox, components/mail/use-drafts-inbox).
 *
 * A draft's fingerprint is a short hash of what would go out: From, To, Cc,
 * Bcc, the subject, the body as text and the files' names and sizes. It is
 * on the receipt Mail writes for a draft it made, and it is the token a
 * send preview gives. So a program can change, remove or send a draft only
 * as it last saw it: when the person has changed the draft since, the
 * fingerprint is another one, and Mail says no.
 *
 * The body is hashed as text, so an editor that only rewrites the HTML of a
 * draft it opens does not count as a change.
 *
 * No React and no storage here, so a suite can read it.
 */

import { htmlToPlainText } from "@/lib/client-email-html";
import { flattenRecipientsForSend } from "@/lib/mail/contact-list-types";
import type { MailDraft } from "@/lib/mail/local-drafts";

/** What a draft would send, as a person reads it before saying yes. */
export type DraftPreview = {
  key: string;
  kind: "compose" | "thread";
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: { filename: string; size: number }[];
  /** A reply: the thread it goes into. */
  threadId?: string;
  includeSignature: boolean;
};

/**
 * Who a draft goes to, as the send carries it: a list's members in To or
 * Cc, or in Bcc when the list says so (the composers do the same).
 */
export function sendRecipients(draft: Pick<MailDraft, "toList" | "ccList" | "bccList">): {
  to: string[];
  cc: string[];
  bcc: string[];
} {
  const to = flattenRecipientsForSend(draft.toList ?? []);
  const cc = flattenRecipientsForSend(draft.ccList ?? []);
  const bccOwn = flattenRecipientsForSend(draft.bccList ?? []);
  const bcc = [...new Set([...bccOwn.emails, ...bccOwn.bccEmails, ...to.bccEmails, ...cc.bccEmails])];
  return { to: to.emails, cc: cc.emails, bcc };
}

export function draftPreview(draft: MailDraft, threadSubject?: string): DraftPreview {
  const common = {
    key: draft.key,
    ...sendRecipients(draft),
    body: htmlToPlainText(draft.body).trim(),
    attachments: (draft.attachments ?? []).map((a) => ({ filename: a.filename, size: a.size })),
    includeSignature: draft.includeSignature,
  };
  if (draft.kind === "thread") {
    const base = (threadSubject ?? "").trim();
    const reply = draft.mode === "forward" ? `Fwd: ${base}` : /^re:/i.test(base) ? base : `Re: ${base}`;
    return {
      ...common,
      kind: "thread",
      from: (draft.fromAccount || draft.account).toLowerCase(),
      subject: draft.subject?.trim() || (base ? reply : ""),
      threadId: draft.threadId,
    };
  }
  return { ...common, kind: "compose", from: draft.from.toLowerCase(), subject: draft.subject.trim() };
}

/** cyrb53: short, fast and the same on every run. Not a secret. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/** See the note at the top. The subject is left out of a reply that keeps the thread's. */
export function draftFingerprint(draft: MailDraft): string {
  const p = draftPreview(draft);
  return hash(
    JSON.stringify([
      p.kind,
      p.from,
      p.to,
      p.cc,
      p.bcc,
      draft.kind === "thread" ? draft.subject?.trim() ?? "" : p.subject,
      p.body,
      p.attachments,
      draft.kind === "thread" ? [draft.threadId, draft.mode] : null,
      p.includeSignature,
    ])
  );
}

/**
 * The mailboxes a draft may be from: every one connected, hidden or not.
 * Hiding a mailbox is about what the list shows, not about writing.
 */
export function connectedAccountEmails(rows: readonly { email: string }[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}
