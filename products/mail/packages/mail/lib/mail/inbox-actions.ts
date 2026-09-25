/*
 * What can be done to a thread on the provider: archive and back, read
 * and unread, junk and not, trash and back, delete forever, and snooze.
 *
 * Part of the inbox core; lib/mail/inbox.ts re-exports what the rest of the
 * app uses, so callers import from there.
 */

import "server-only";

import { applyLocalAction, queueLocalAction } from "@/lib/mail/local-store";
import { wakeOutlookSync } from "@/lib/mail/outlook-sync";
import { getThreadMetadata, getThreadMinimal, headerValue, modifyMessageLabels, modifyThreadLabels, trashThread, untrashThread, deleteMessagesForever, threadMessageIdsWithLabel } from "@/lib/gmail/api";
import { mailStore } from "@/lib/mail/store";
import { accessTokenFor } from "@/lib/mail/mail-gmail-token";
import { archiveOutlookThread, markOutlookThreadRead, markOutlookThreadUnread, outlookAccessTokenFor, trashOutlookThread, unarchiveOutlookThread, untrashOutlookThread } from "@/lib/mail/outlook-inbox";
import { listConversationMessages, moveOutlookConversation, purgeOutlookConversation } from "@/lib/outlook/api";
import { resolveMailProvider } from "@/lib/mail/providers";
import { invalidateInboxCache } from "@/lib/mail/inbox-cache";
import { PlanError } from "@/lib/plan/errors";
import { forgetThreadInStoredPages } from "@/lib/mail/inbox-gmail-pages";
import { messageDate, normalizeRfcMessageId, translateGmailError } from "@/lib/mail/inbox-gmail-common";

export async function archiveMailThread(
  account: string,
  threadId: string,
  /** Owner of the stored list page, so the row can be dropped from it too. */
  clerkUserId?: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "archive")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await archiveOutlookThread(account, threadId);
    await applyLocalAction(account, threadId, "archive");
    wakeOutlookSync(account);
    if (clerkUserId) {
      await forgetThreadInStoredPages(clerkUserId, account, threadId);
    }
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await modifyThreadLabels(token, threadId, {
      removeLabelIds: ["INBOX", "UNREAD"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  if (clerkUserId) {
    await forgetThreadInStoredPages(clerkUserId, account, threadId);
  }
  invalidateInboxCache();
}

/** Undo of archive: put the thread back in the inbox. */
export async function unarchiveMailThread(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "unarchive")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await unarchiveOutlookThread(account, threadId);
    await applyLocalAction(account, threadId, "unarchive");
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    // Spam and Trash come off with it. Gmail hides a thread that still
    // carries either, whatever else it is labelled, so "back to the inbox"
    // from Junk added the inbox label and left the thread in Junk.
    await modifyThreadLabels(token, threadId, {
      addLabelIds: ["INBOX"],
      removeLabelIds: ["SPAM", "TRASH"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/**
 * Put the newest message of a thread back to unread.
 *
 * The newest, not the whole thread. Someone marking an eleven-message thread
 * unread wants the last one back in front of them, not the ten they have
 * already read. Outlook has always worked this way; Gmail marked all of them
 * until August 2026, because a thread-level modify is the obvious call and the
 * difference does not show in the list.
 */
export async function markMailThreadUnread(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "unread")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await markOutlookThreadUnread(account, threadId);
    await applyLocalAction(account, threadId, "unread");
    wakeOutlookSync(account, "inbox");
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    const thread = await getThreadMinimal(token, threadId);
    const newest = thread.messages?.[thread.messages.length - 1];
    if (newest?.id) {
      await modifyMessageLabels(token, newest.id, { addLabelIds: ["UNREAD"] });
    } else {
      // No message list came back; the thread label is better than nothing.
      await modifyThreadLabels(token, threadId, { addLabelIds: ["UNREAD"] });
    }
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/**
 * Mark every message in a thread read.
 *
 * The whole thread here, which is the mirror of the above: "I have dealt with
 * this" is about the conversation, not about its last line.
 */
export async function markMailThreadRead(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "read")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await markOutlookThreadRead(account, threadId);
    await applyLocalAction(account, threadId, "read");
    wakeOutlookSync(account, "inbox");
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await modifyThreadLabels(token, threadId, {
      removeLabelIds: ["UNREAD"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/**
 * File a conversation as junk, on whichever provider holds it.
 *
 * Filing, not reporting. Neither API exposes the signal the web buttons send
 * to train the provider's filter, so this puts the mail in Junk everywhere
 * the reader looks and teaches Gmail and Outlook nothing. The next message
 * from the same sender arrives exactly as before, which is why the button
 * says "Move to Junk" rather than "Report spam".
 */
export async function markMailThreadJunk(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "junk")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    const token = await outlookAccessTokenFor(account);
    await moveOutlookConversation(token, threadId, "junkemail");
    await applyLocalAction(account, threadId, "junk");
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await modifyThreadLabels(token, threadId, {
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/** Take it back out again — the half that stops a Junk view being a dead end. */
export async function markMailThreadNotJunk(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "notjunk")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    const token = await outlookAccessTokenFor(account);
    await moveOutlookConversation(token, threadId, "inbox");
    await applyLocalAction(account, threadId, "notjunk");
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await modifyThreadLabels(token, threadId, {
      addLabelIds: ["INBOX"],
      removeLabelIds: ["SPAM"],
    });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

export async function trashMailThread(
  account: string,
  threadId: string,
  /** Owner of the stored list page, so the row can be dropped from it too. */
  clerkUserId?: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "trash")) {
    invalidateInboxCache();
    return;
  }
  const forget = async () => {
    if (clerkUserId) {
      await forgetThreadInStoredPages(clerkUserId, account, threadId);
    }
  };
  if ((await resolveMailProvider(account)) === "outlook") {
    await trashOutlookThread(account, threadId);
    await applyLocalAction(account, threadId, "trash");
    wakeOutlookSync(account);
    await forget();
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await trashThread(token, threadId);
  } catch (err) {
    translateGmailError(err, account);
  }
  await forget();
  invalidateInboxCache();
}

/** Undo of trash: restore the thread and put it back in the inbox. */
export async function untrashMailThread(
  account: string,
  threadId: string
): Promise<void> {
  // The copy first, when it serves this mailbox: the worker carries the
  // change to the server on its next pass.
  if (await queueLocalAction(account, threadId, "untrash")) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    await untrashOutlookThread(account, threadId);
    await applyLocalAction(account, threadId, "untrash");
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    await untrashThread(token, threadId);
    // Untrash alone doesn't re-add INBOX, so the thread would end up
    // archived rather than back where the user deleted it from.
    await modifyThreadLabels(token, threadId, { addLabelIds: ["INBOX"] });
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/** The two folders that mail can be deleted from for good. */
export type MailPurgeFolder = "trash" | "junk";
/**
 * Delete for good the messages of a thread that are in Trash or in Junk.
 *
 * This cannot be undone: the caller asks the reader first. Only the messages
 * in that folder go. A thread can have one message in Trash and the others in
 * the inbox, and those stay.
 */
export async function deleteMailThreadForever(
  account: string,
  threadId: string,
  from: MailPurgeFolder
): Promise<void> {
  if (await queueLocalAction(account, threadId, "deleteForever", { from })) {
    invalidateInboxCache();
    return;
  }
  if ((await resolveMailProvider(account)) === "outlook") {
    const token = await outlookAccessTokenFor(account);
    await purgeOutlookConversation(
      token,
      from === "trash" ? "deleteditems" : "junkemail",
      threadId
    );
    await applyLocalAction(account, threadId, "deleteForever", { from });
    wakeOutlookSync(account);
    invalidateInboxCache();
    return;
  }
  const token = await accessTokenFor(account);
  try {
    const ids = await threadMessageIdsWithLabel(
      token,
      threadId,
      from === "trash" ? "TRASH" : "SPAM"
    );
    if (ids.length) await deleteMessagesForever(token, ids);
  } catch (err) {
    translateGmailError(err, account);
  }
  invalidateInboxCache();
}

/** Best-effort tip Message-ID so sibling mailbox copies stay snoozed too. */
async function tipMessageIdForThread(
  account: string,
  threadId: string
): Promise<string | null> {
  try {
    if ((await resolveMailProvider(account)) === "outlook") {
      const token = await outlookAccessTokenFor(account);
      const tipPage = await listConversationMessages(token, threadId, {
        top: 1,
      });
      const tip = tipPage.messages[tipPage.messages.length - 1];
      return normalizeRfcMessageId(tip?.internetMessageId);
    }
    const token = await accessTokenFor(account);
    const thread = await getThreadMetadata(token, threadId, ["Message-ID"]);
    const messages = [...(thread.messages ?? [])];
    if (!messages.length) return null;
    messages.sort((a, b) => messageDate(a) - messageDate(b));
    const latest = messages[messages.length - 1];
    return normalizeRfcMessageId(headerValue(latest, "Message-ID"));
  } catch (err) {
    console.warn(`[mail] tip Message-ID for snooze failed (${account}):`, err);
    return null;
  }
}

export async function snoozeMailThread(
  account: string,
  threadId: string,
  untilIso: string
): Promise<void> {
  const until = new Date(untilIso);
  if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) {
    throw new PlanError("Snooze time must be in the future", 400);
  }
  const tipMessageId = await tipMessageIdForThread(account, threadId);
  await mailStore().snoozes.set({
    accountEmail: account,
    threadId,
    snoozedUntil: until.toISOString(),
    tipMessageId,
  });
  invalidateInboxCache();
}

export async function unsnoozeMailThread(
  account: string,
  threadId: string
): Promise<void> {
  await mailStore().snoozes.remove(account, threadId);
  invalidateInboxCache();
}
