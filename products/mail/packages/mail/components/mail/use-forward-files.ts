"use client";

/*
 * The forwarded message's files, off the pane component: whether they go
 * with the forward, and the box that puts them in the strip or takes them
 * out. ThreadPane hands in the attachment strip. The history a forward
 * carries is forward-payload.ts.
 *
 * The state lives here. It writes only itself and the strip it was handed.
 * The start of a forward is the composer's, and stays in ThreadPane. It
 * calls `beginForwardFiles`. New work on what a forward carries goes in
 * this file, not in ThreadPane.
 */

import * as React from "react";
import { toast } from "@/lib/mail/toast";
import { mailApiFetch } from "@/lib/mail/api";
import { attachmentUrl } from "@/lib/mail/attachment-save";
import type { MailMessage } from "@/lib/mail/types";

export function useForwardFiles(input: {
  account: string;
  /** The strip as of this render — see useComposerAttachments. */
  attachItemsRef: React.RefObject<{ id: string; filename: string }[]>;
  addAttachFiles: (files: File[]) => void;
  removeAttach: (id: string) => void;
}) {
  const {
    account,
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
   * Undo after Send put a forward back in the composer. The box goes back to
   * what it was. The files are already in the strip, which the composer
   * restores, so this fetches nothing and adds nothing.
   */
  const restoreForwardBoxes = React.useCallback(
    (boxes: { includeFiles: boolean }) => {
      setForwardFiles(boxes.includeFiles);
    },
    []
  );

  return {
    forwardFiles,
    forwardFilesBusy,
    setForwardIncludeFiles,
    beginForwardFiles,
    restoreForwardBoxes,
  };
}
