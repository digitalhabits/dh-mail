"use client";

/*
 * What a forward carries, off the pane component: the forwarded message's
 * files, the "whole conversation" box with the thread it fetches, and the
 * conversation written out for the tail of the forward. ThreadPane hands
 * in the thread and the attachment strip. What comes back is the state of
 * the two boxes and the functions that tick them.
 *
 * The state lives here. It writes only itself and the strip it was handed.
 * The start of a forward is the composer's, and stays in ThreadPane. It
 * calls `beginForwardFiles`. New work on what a forward carries goes in
 * this file, not in ThreadPane.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { mailApiFetch } from "@/lib/mail/api";
import { attachmentUrl } from "@/components/mail/MailAttachments";
import { buildQuoteHistory } from "@/lib/mail/quote-history";
import type { MailChatPartSummary } from "@/lib/mail/chat-types";
import type { MailMessage, MailThreadDetail } from "@/lib/mail/types";
import {
  historyEntryOf,
  loadWholeThread,
} from "@/components/mail/thread-messages";

export function useForwardFiles(input: {
  account: string;
  threadId: string;
  thread: MailThreadDetail | null;
  chatParts: MailChatPartSummary[];
  /** The strip as of this render — see useComposerAttachments. */
  attachItemsRef: React.RefObject<{ id: string; filename: string }[]>;
  addAttachFiles: (files: File[]) => void;
  removeAttach: (id: string) => void;
}) {
  const {
    account,
    threadId,
    thread,
    chatParts,
    attachItemsRef,
    addAttachFiles,
    removeAttach,
  } = input;

  /**
   * The files on the message being forwarded, and whether they go with it.
   *
   * A forward that leaves the attachments behind is not a forward — the
   * point of most of them is the file. They are fetched into the ordinary
   * attachment strip when the composer opens, so they show as chips with a
   * total and a remove each, like anything else attached. The box below
   * takes them all off again, and puts them back.
   */
  const [forwardFiles, setForwardFiles] = React.useState(true);
  const [forwardFilesBusy, setForwardFilesBusy] = React.useState(false);
  /**
   * What was in the strip before the forwarded message's files went in.
   *
   * The ids cannot be had from `addFiles` — it makes them inside a state
   * update and returns nothing — and the ref of items has not caught up by
   * the time the call returns. So the pair is remembered the way the
   * whole-conversation box remembers it: what was already there, and the
   * names of what this added. Anything matching both is ours to take out.
   */
  const preForwardAttachIdsRef = React.useRef<Set<string>>(new Set());
  /** Forward the whole conversation, not only one message. */
  const [forwardWhole, setForwardWhole] = React.useState(false);
  const [forwardWholeBusy, setForwardWholeBusy] = React.useState(false);
  /** The full thread, fetched when the box above is ticked. */
  const [forwardConversation, setForwardConversation] = React.useState<
    MailMessage[] | null
  >(null);
  /** What was in the attachment strip before the conversation's files. */
  const preWholeAttachIdsRef = React.useRef<Set<string>>(new Set());

  /**
   * The files on some messages, as real files in the attachment strip.
   *
   * Through the mail transport, not the window's fetch: in the desktop app
   * nothing answers /api/mail/attachment over HTTP. Returns the ids added,
   * so taking them off again is exact rather than by filename.
   */
  const attachFilesFromMessages = React.useCallback(
    async (messages: MailMessage[]): Promise<{ failed: number }> => {
      const refs = messages.flatMap((m) =>
        (m.attachments ?? []).map((attachment) => ({
          messageId: m.id,
          attachment,
        }))
      );
      const files: File[] = [];
      let failed = 0;
      for (const ref of refs) {
        try {
          const res = await mailApiFetch(
            attachmentUrl({
              account,
              messageId: ref.messageId,
              attachment: ref.attachment,
            })
          );
          if (!res.ok) throw new Error(String(res.status));
          const blob = await res.blob();
          files.push(
            new File([blob], ref.attachment.filename, {
              type: ref.attachment.mimeType || blob.type,
            })
          );
        } catch {
          failed += 1;
        }
      }
      if (files.length) addAttachFiles(files);
      return { failed };
    },
    [account, addAttachFiles]
  );

  /**
   * Put the forwarded message's files in the strip, or take them out.
   *
   * The ids are remembered on the way in, so taking them out removes what
   * this added and never a file the writer attached themselves.
   *
   * `forwardSource` is the message being forwarded, as the caller's render
   * knows it. The pane works it out below the place this hook stands, so it
   * arrives with the call.
   */
  const setForwardIncludeFiles = React.useCallback(
    async (on: boolean, forwardSource: MailMessage | undefined) => {
      const names = new Set(
        (forwardSource?.attachments ?? []).map((a) => a.filename)
      );
      /** The chips this put in: not there before, and named by the source. */
      const ours = () =>
        attachItemsRef.current.filter(
          (item) =>
            !preForwardAttachIdsRef.current.has(item.id) &&
            names.has(item.filename)
        );
      if (!on) {
        for (const item of ours()) removeAttach(item.id);
        setForwardFiles(false);
        return;
      }
      setForwardFiles(true);
      if (!forwardSource?.attachments?.length) return;
      // Already in. Ticking a box that is on must not fetch them twice.
      if (ours().length) return;
      setForwardFilesBusy(true);
      try {
        const { failed } = await attachFilesFromMessages([forwardSource]);
        if (failed) {
          toast.warning(
            `${failed} file${failed === 1 ? "" : "s"} could not be fetched`
          );
        }
      } finally {
        setForwardFilesBusy(false);
      }
    },
    [attachItemsRef, attachFilesFromMessages, removeAttach]
  );

  /**
   * A forward starts. The files on the message go with it, which is what a
   * forward is usually for. The box under the composer takes them off again.
   */
  const beginForwardFiles = (forwardSource: MailMessage | undefined) => {
    preForwardAttachIdsRef.current = new Set(
      attachItemsRef.current.map((i) => i.id)
    );
    setForwardFiles(true);
    void setForwardIncludeFiles(true, forwardSource);
  };

  /**
   * Tick: fetch the full thread and put its files into the ordinary
   * attachment strip — chips, a running total, and a remove each, all
   * already there. Untick: take back the conversation's files and leave
   * what the writer added themselves; matching name as well as newness so
   * a file of their own added since ticking is not swept up with ours.
   */
  const setForwardWholeConversation = React.useCallback(
    async (on: boolean) => {
      if (!on) {
        const names = new Set(
          (forwardConversation ?? []).flatMap((m) =>
            (m.attachments ?? []).map((a) => a.filename)
          )
        );
        for (const item of attachItemsRef.current) {
          if (
            !preWholeAttachIdsRef.current.has(item.id) &&
            names.has(item.filename)
          ) {
            removeAttach(item.id);
          }
        }
        setForwardWhole(false);
        setForwardConversation(null);
        return;
      }
      if (!thread) return;
      setForwardWholeBusy(true);
      try {
        // The whole thread, fresh, from its first message. The window on
        // screen may be the middle of it, and one request answers at most
        // a page — asking for "the thread" got the newest fifty and no
        // more — so this walks the pages from the oldest until there is no
        // newer one. A conversation that has rotated through parts is
        // walked part by part, oldest part first.
        const currentPart = chatParts.find(
          (p) => p.providerThreadId === threadId
        );
        const partIds = [
          ...chatParts
            .filter(
              (p) =>
                currentPart && p.partIndex < currentPart.partIndex
            )
            .sort((a, b) => a.partIndex - b.partIndex)
            .map((p) => p.providerThreadId),
          threadId,
        ];
        const messages: MailMessage[] = [];
        for (const partThreadId of partIds) {
          messages.push(...(await loadWholeThread(account, partThreadId)));
        }
        preWholeAttachIdsRef.current = new Set(
          attachItemsRef.current.map((i) => i.id)
        );
        const refs = messages.flatMap((m) =>
          (m.attachments ?? []).map((attachment) => ({
            messageId: m.id,
            attachment,
          }))
        );
        const files: File[] = [];
        let failed = 0;
        for (const ref of refs) {
          try {
            // Through the mail transport, not the window's fetch: in the
            // desktop app nothing answers /api/mail/attachment over HTTP,
            // and the dev server's fallback page came back as the "file" —
            // 578 bytes of HTML with every attachment's name.
            const res = await mailApiFetch(
              attachmentUrl({
                account,
                messageId: ref.messageId,
                attachment: ref.attachment,
              })
            );
            if (!res.ok) throw new Error(String(res.status));
            const blob = await res.blob();
            files.push(
              new File([blob], ref.attachment.filename, {
                type: ref.attachment.mimeType || blob.type,
              })
            );
          } catch {
            failed += 1;
          }
        }
        if (files.length) addAttachFiles(files);
        if (failed) {
          toast.warning(
            `${failed} file${failed === 1 ? "" : "s"} from the conversation could not be fetched`
          );
        }
        setForwardConversation(messages);
        setForwardWhole(true);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Couldn't load the conversation"
        );
      } finally {
        setForwardWholeBusy(false);
      }
    },
    [
      thread,
      chatParts,
      account,
      threadId,
      forwardConversation,
      attachItemsRef,
      removeAttach,
      addAttachFiles,
    ]
  );

  /**
   * The composer closed. The whole-conversation box goes back to unticked.
   * The strip is the composer's to clear, and the single-message box is set
   * again by the next `beginForwardFiles`.
   */
  const resetForwardWhole = React.useCallback(() => {
    setForwardWhole(false);
    setForwardConversation(null);
    preWholeAttachIdsRef.current = new Set();
  }, []);

  /**
   * Undo after Send put a forward back in the composer. The two boxes go back
   * to what they were. The files are already in the strip, which the composer
   * restores, so this fetches nothing and adds nothing.
   *
   * The two "what was there before" sets are not written here. A box that is
   * unticked after this takes out the files that the forwarded messages name
   * and that were not in the strip before, which is what the reader asks for.
   */
  const restoreForwardBoxes = React.useCallback(
    (boxes: { includeFiles: boolean; conversation: MailMessage[] | null }) => {
      setForwardFiles(boxes.includeFiles);
      setForwardConversation(boxes.conversation);
      setForwardWhole(Boolean(boxes.conversation));
    },
    []
  );

  /** The forwarded conversation, oldest first — a story, not a chain. */
  const forwardWholeAppendix = React.useMemo(() => {
    if (!forwardWhole || !forwardConversation?.length || !thread) return null;
    return buildQuoteHistory(forwardConversation.map(historyEntryOf), {
      order: "oldest-first",
      heading: `Forwarded conversation — ${thread.subject} (${forwardConversation.length} messages)`,
    });
  }, [forwardWhole, forwardConversation, thread]);

  return {
    forwardFiles,
    forwardFilesBusy,
    setForwardIncludeFiles,
    beginForwardFiles,
    forwardWhole,
    forwardWholeBusy,
    forwardConversation,
    setForwardWholeConversation,
    resetForwardWhole,
    restoreForwardBoxes,
    forwardWholeAppendix,
  };
}
