/**
 * The server copy of an Exchange (EWS) draft, kept from the drafts here
 * (phase 5, section 14.1 of docs/mail-exchange-ews.md).
 *
 * `local-drafts.ts` says on the window when a draft is written or deleted.
 * For a draft from an Exchange mailbox, this saves a copy in the server's
 * Drafts folder 20 seconds after the last change, and deletes the copy
 * when the draft here goes (sent or discarded). Each window listens for its
 * own drafts: a composer in a pop-out writes in the pop-out.
 *
 * Desktop app only, in every flavor.
 */

import { htmlToPlainText } from "@/lib/client-email-html";
import { emailsOfRecipients, flattenRecipientsForSend } from "@/lib/mail/contact-list-types";
import { hasExchangeAccount } from "@/lib/mail/exchange-accounts";
import { deleteExchangeDraftCopy, saveExchangeDraftCopy } from "@/lib/mail/exchange-drafts";
import { buildExchangeDraftMime } from "@/lib/mail/inbox-send";
import {
  MAIL_DRAFT_DELETED_EVENT,
  MAIL_DRAFT_WRITTEN_EVENT,
  type MailDraft,
  type ThreadMailDraft,
} from "@/lib/mail/local-drafts";
import { mailStore } from "@/lib/mail/store";
import { tauriInvoke } from "@/lib/mail/store/tauri";

/** How long a draft must be still before its copy is saved. */
export const DRAFT_COPY_WAIT_MS = 20_000;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/**
 * A count per draft that goes up when the draft is written or dropped. A save
 * takes the count when it starts and stands down if it has moved by the time
 * it would write: a save already under way when the reader pressed Send used
 * to finish after the delete, and left a copy on the server that the thread
 * then showed as a draft, and the composer opened again.
 */
const generation = new Map<string, number>();
const bump = (key: string) => generation.set(key, (generation.get(key) ?? 0) + 1);
/** What each draft's copy says now, so a caret move saves nothing. */
const saved = new Map<string, string>();

/** The mailbox a draft is from. */
function accountOf(draft: MailDraft): string {
  return (draft.kind === "compose" ? draft.from : draft.fromAccount || draft.account).trim().toLowerCase();
}

/** What a copy carries: when this is unchanged, nothing is saved again. */
function contentOf(draft: MailDraft): string {
  const bcc = draft.kind === "compose" ? draft.bccList : [];
  return JSON.stringify([
    accountOf(draft),
    draft.kind === "compose" ? draft.subject : (draft.subject ?? ""),
    draft.body,
    emailsOfRecipients(draft.toList),
    emailsOfRecipients(draft.ccList),
    emailsOfRecipients(bcc),
    draft.attachments.map((a) => [a.filename, a.size]),
  ]);
}

function isEmpty(draft: MailDraft): boolean {
  const subject = draft.kind === "compose" ? draft.subject : (draft.subject ?? "");
  return !htmlToPlainText(draft.body).trim() && !subject.trim() && !draft.attachments.length;
}

/** "Re: " or "Fwd: " before the thread's subject, once. */
function subjectFor(mode: ThreadMailDraft["mode"], subject: string): string {
  const prefix = mode === "forward" ? "Fwd: " : "Re: ";
  return new RegExp(`^${prefix.trim()}`, "i").test(subject.trim()) ? subject.trim() : `${prefix}${subject.trim()}`;
}

/** The subject and the thread headers of a reply or a forward. */
async function threadFields(draft: ThreadMailDraft) {
  const rows = await mailStore().messages.thread(draft.account, draft.threadId).catch(() => []);
  const latest = rows.filter((r) => !r.isDraft).sort((a, b) => b.sentAt - a.sentAt)[0];
  const reply = draft.mode !== "forward" && latest?.rfcMessageId;
  return {
    subject: draft.subject?.trim() || subjectFor(draft.mode, latest?.subject ?? ""),
    inReplyTo: reply ? latest.rfcMessageId! : undefined,
    references: reply ? [latest.references ?? "", latest.rfcMessageId ?? ""].join(" ").trim() : undefined,
  };
}

async function saveNow(draft: MailDraft, startedAt: number): Promise<void> {
  const stale = () => generation.get(draft.key) !== startedAt;
  const account = accountOf(draft);
  if (!account || !(await hasExchangeAccount(account).catch(() => false))) return;
  if (isEmpty(draft)) return dropCopy(draft.key);
  const content = contentOf(draft);
  if (saved.get(draft.key) === content) return;
  const fields = draft.kind === "thread" ? await threadFields(draft) : { subject: draft.subject };
  // As a send flattens them: a list sent as Bcc goes to Bcc.
  const to = flattenRecipientsForSend(draft.toList);
  const cc = flattenRecipientsForSend(draft.ccList);
  const bcc = [
    ...to.bccEmails,
    ...cc.bccEmails,
    ...(draft.kind === "compose" ? emailsOfRecipients(draft.bccList) : []),
  ];
  const mime = await buildExchangeDraftMime({
    account,
    to: to.emails,
    cc: cc.emails,
    bcc,
    body: htmlToPlainText(draft.body),
    html: draft.body,
    attachments: draft.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, contentBase64: a.contentBase64 })),
    ...fields,
  });
  // Sent or discarded (or written again) while the copy was being built.
  if (stale()) return;
  await saveExchangeDraftCopy(draft.key, account, mime, bcc);
  saved.set(draft.key, content);
}

function schedule(draft: MailDraft, waitMs: number): void {
  bump(draft.key);
  const startedAt = generation.get(draft.key) ?? 0;
  const before = timers.get(draft.key);
  if (before) clearTimeout(before);
  if (saved.get(draft.key) === contentOf(draft)) return;
  timers.set(
    draft.key,
    setTimeout(() => {
      timers.delete(draft.key);
      void saveNow(draft, startedAt).catch((err: unknown) => console.warn("[mail] the draft copy on the server was not saved:", err));
    }, waitMs)
  );
}

function dropCopy(key: string): void {
  bump(key);
  const before = timers.get(key);
  if (before) clearTimeout(before);
  timers.delete(key);
  saved.delete(key);
  void deleteExchangeDraftCopy(key).catch((err: unknown) => console.warn("[mail] the draft copy on the server was not deleted:", err));
}

/** Listen in this window. Nothing outside the app. */
export function installExchangeDraftCopy(target: Window = window, waitMs = DRAFT_COPY_WAIT_MS): void {
  if (!tauriInvoke()) return;
  target.addEventListener(MAIL_DRAFT_WRITTEN_EVENT, (event) => {
    const draft = (event as CustomEvent<{ draft: MailDraft }>).detail?.draft;
    if (draft) schedule(draft, waitMs);
  });
  target.addEventListener(MAIL_DRAFT_DELETED_EVENT, (event) => {
    const key = (event as CustomEvent<{ key: string }>).detail?.key;
    if (key) dropCopy(key);
  });
}
