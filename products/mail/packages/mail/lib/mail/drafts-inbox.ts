/**
 * The drafts folder: a draft another program on this computer left for Mail
 * (mail_native::drafts_inbox), checked and made into one of ours.
 *
 * One JSON file per draft:
 *
 *   {
 *     "from": "you@example.org",          a mailbox connected in Mail
 *     "to": ["them@example.org"],
 *     "cc": [], "bcc": [],                optional
 *     "subject": "Hello",                 a new message's subject
 *     "body": "Plain text.\n\nParagraphs are kept.",
 *     "attachments": ["/Users/you/plan.pdf"],  optional: files Mail reads and attaches
 *     "replyTo": {                        optional: a reply in a thread
 *       "threadId": "18f2c4…",            the thread's id (Gmail's own id)
 *       "mode": "reply"                   or "replyAll"
 *     }
 *   }
 *
 * `bodyHtml` may stand in for `body`. Nothing is sent: the draft lands in
 * Drafts for a person to read and send. A draft that cannot be made comes
 * back with the reason, which the folder keeps in `not-made`.
 *
 * No React and no storage here, so a suite can read it.
 */

import { plainTextToEditorHtml } from "@/lib/client-email-html";
import type { MailRecipient } from "@/lib/mail/contact-list-types";
import type { ComposeMailDraft, ThreadMailDraft } from "@/lib/mail/local-drafts";

export type DraftsInboxResult =
  | { ok: true; draft: Omit<ComposeMailDraft, "key" | "updatedAt"> | Omit<ThreadMailDraft, "key" | "updatedAt"> }
  | { ok: false; reason: string };

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

function addresses(value: unknown, field: string): MailRecipient[] | string {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (!list) return `"${field}" must be a list of addresses`;
  const out: MailRecipient[] = [];
  for (const item of list) {
    const email = typeof item === "string" ? item.trim() : "";
    if (!email) continue;
    if (!EMAIL.test(email)) return `"${field}" has an address that is not one: ${String(item).slice(0, 80)}`;
    out.push({ kind: "email", email });
  }
  return out;
}

/**
 * Plain text as the composer's HTML, as a generated reply puts it there: a
 * paragraph for each line and an empty one for each blank line, which is
 * the gap the editor shows. A paragraph for each block of lines showed no
 * gap at all, and the lines inside it ran on.
 */
export function textToDraftHtml(text: string): string {
  return plainTextToEditorHtml(text);
}

/**
 * HTML another program wrote, without what could run: scripts, styles,
 * frames, event handlers and javascript: links. The composer shows the rest.
 */
export function cleanDraftHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|link|meta)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "$1=$2#$2");
}

/**
 * Check a draft from the folder and say what to save. `accounts` are the
 * mailboxes connected here; `from` must be one of them.
 */
export function draftFromInbox(raw: unknown, accounts: readonly string[]): DraftsInboxResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "A draft is a JSON object" };
  }
  const file = raw as Record<string, unknown>;
  const fromRaw = typeof file.from === "string" ? file.from.trim().toLowerCase() : "";
  if (!fromRaw) return { ok: false, reason: '"from" is missing: say which mailbox the draft is from' };
  const from = accounts.find((a) => a.toLowerCase() === fromRaw);
  if (!from) {
    return {
      ok: false,
      reason: `"from" is ${fromRaw}, which is not connected in Mail. Connected: ${accounts.join(", ") || "none"}`,
    };
  }
  const to = addresses(file.to, "to");
  const cc = addresses(file.cc, "cc");
  const bcc = addresses(file.bcc, "bcc");
  for (const list of [to, cc, bcc]) if (typeof list === "string") return { ok: false, reason: list };
  const toList = to as MailRecipient[];
  const ccList = cc as MailRecipient[];
  const bccList = bcc as MailRecipient[];

  const body =
    typeof file.bodyHtml === "string" && file.bodyHtml.trim()
      ? cleanDraftHtml(file.bodyHtml)
      : typeof file.body === "string" && file.body.trim()
        ? textToDraftHtml(file.body)
        : "";
  if (!body) return { ok: false, reason: '"body" is missing or empty' };

  const replyTo = file.replyTo;
  if (replyTo !== undefined && replyTo !== null) {
    const r = replyTo as Record<string, unknown>;
    const threadId = typeof r.threadId === "string" ? r.threadId.trim() : "";
    if (!threadId) return { ok: false, reason: '"replyTo.threadId" is missing' };
    const mode = r.mode === "replyAll" ? "replyAll" : "reply";
    if (!toList.length) return { ok: false, reason: 'A reply needs "to": who it goes to' };
    return {
      ok: true,
      draft: {
        kind: "thread",
        account: from,
        threadId,
        mode,
        body,
        toList,
        ccList,
        showCc: ccList.length > 0,
        bccList,
        editRecipients: false,
        includeSignature: true,
        fromAccount: from,
        replyFocus: false,
        attachments: [],
      },
    };
  }

  const subject = typeof file.subject === "string" ? file.subject.trim().slice(0, 500) : "";
  return {
    ok: true,
    draft: {
      kind: "compose",
      from,
      subject,
      body,
      toList,
      ccList,
      bccList,
      showCc: ccList.length > 0,
      showBcc: bccList.length > 0,
      includeSignature: true,
      attachments: [],
    },
  };
}
