"use client";

/*
 * The thread composer, off the pane component: what the message being
 * written holds, and the few ways that the whole of it changes at once.
 *
 * Two hooks, and the reason is the order of effects. The pane reads `mode`
 * and `fromAccount` from its first lines, so `useThreadComposerState` stands
 * at the top. The draft effects always ran lower, after the attachment
 * strip, so `useThreadComposer` stands at that place.
 *
 * Three rules keep this file from the stale-closure bugs the pane had:
 *
 * - The hooks return the fields one by one. No callback lists the whole
 *   state in its dependencies. `reply` changes on each keystroke, and a list
 *   that is too wide makes every callback again on each key press.
 * - No function that writes has state in its dependency list. A setter
 *   lists nothing. `open`, `restore`, `close` and `handOver` list only
 *   `dispatch`, the strip's own stable functions and the thread's identity,
 *   which does not change in the life of a pane. So each identity holds, and
 *   a child that receives one as `onChange` does not render again for it.
 * - A write of the words from outside the editor always makes a new editor.
 *   The reducer does it, so no caller can forget it.
 *
 * New composer state goes in this file, not in ThreadPane.
 */

import * as React from "react";
import {
  recipientsFromEmails,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import {
  composerReducer,
  initialComposerState,
  snapshotPatch,
  type ComposerPatch,
  type ComposerSnapshot,
  type ComposerState,
  type EditableField,
} from "@/lib/mail/thread-composer-state";
import type { useDraftAttachments } from "@/components/mail/draft-attachments";
import { stripQuotedHtml } from "@/lib/mail/email-html";
import {
  draftBodyForComposer,
  shouldImportProviderDraft,
} from "@/lib/mail/import-provider-draft";
import { dropRemoteImagesForEditing } from "@/lib/mail/editor-html";
import {
  deleteDraft,
  getDraft,
  readyAttachmentsForDraft,
  saveThreadDraft,
  threadDraftKey,
  type ThreadMailDraft,
} from "@/lib/mail/local-drafts";
import type { MailThreadDetail } from "@/lib/mail/types";


/** A setter for one field. It accepts a value or an updater function. */
export type FieldSetter<F extends EditableField> = (
  value: ComposerState[F] | ((previous: ComposerState[F]) => ComposerState[F])
) => void;

/** The composer's state. Call it at the top of the pane. */
export function useThreadComposerState(account: string) {
  const [state, dispatch] = React.useReducer(
    composerReducer,
    account,
    initialComposerState
  );

  /*
    One setter for each field, made once. `dispatch` never changes, so each
    list is empty and each identity holds for the life of the pane. The
    recipient fields, the From menu and the editor receive these as
    `onChange`.
  */
  const setters = React.useMemo(() => {
    const setterFor =
      <F extends EditableField>(field: F): FieldSetter<F> =>
      (value) =>
        dispatch({ type: "edit", field, value });
    return {
      setMode: setterFor("mode"),
      setReply: setterFor("reply"),
      setSubjectDraft: setterFor("subjectDraft"),
      setSubjectOpen: setterFor("subjectOpen"),
      setToList: setterFor("toList"),
      setCcList: setterFor("ccList"),
      setShowCc: setterFor("showCc"),
      setEditRecipients: setterFor("editRecipients"),
      setIncludeSignature: setterFor("includeSignature"),
      setFromAccount: setterFor("fromAccount"),
      setReplyFocus: setterFor("replyFocus"),
      setQuoteMessageId: setterFor("quoteMessageId"),
      setShowPreview: setterFor("showPreview"),
      setUpdateCrmNotes: setterFor("updateCrmNotes"),
      setConfirmDiscard: setterFor("confirmDiscard"),
    };
  }, []);

  /** Write some fields in one step. A patch with words makes a new editor. */
  const patchComposer = React.useCallback(
    (patch: ComposerPatch) => dispatch({ type: "patch", patch }),
    []
  );

  const {
    mode,
    reply,
    editorKey,
    subjectDraft,
    subjectOpen,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    quoteMessageId,
    showPreview,
    updateCrmNotes,
    confirmDiscard,
  } = state;
  // One by one, and never as `state`: see the rules at the top of the file.
  return {
    mode,
    reply,
    editorKey,
    subjectDraft,
    subjectOpen,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    quoteMessageId,
    showPreview,
    updateCrmNotes,
    confirmDiscard,
    ...setters,
    patchComposer,
  };
}

type Strip = ReturnType<typeof useDraftAttachments>;
type StripFiles = Parameters<Strip["replaceAll"]>[0];


/**
 * The code that drives the composer: the stored draft, and the ways that the
 * whole message changes at once. Call it where the pane always ran the draft
 * effects, below the attachment strip.
 */
export function useThreadComposer(
  composer: ReturnType<typeof useThreadComposerState>,
  input: {
    account: string;
    threadId: string;
    thread: MailThreadDetail | null;
    /** This thread's reply is in the floating card right now. */
    replyFloating?: boolean;
    attachItems: Strip["items"];
    replaceAttachments: Strip["replaceAll"];
    clearAttachments: Strip["clear"];
    /** The whole-conversation box of a forward — see use-forward-files.ts. */
    resetForwardWhole: () => void;
  }
) {
  const {
    mode,
    reply,
    subjectDraft,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    quoteMessageId,
    patchComposer,
  } = composer;
  const {
    account,
    threadId,
    thread,
    replyFloating,
    attachItems,
    replaceAttachments,
    clearAttachments,
    resetForwardWhole,
  } = input;

  /** The provider draft this composer was opened from, if any. */
  const importedDraftRef = React.useRef<string | null>(null);
  /**
   * Null until the local draft has been looked for, then whether one was
   * found. State rather than a ref: the thread can paint from the RAM cache
   * before IndexedDB answers, and the import effect has to run again once it
   * does.
   */
  const [localDraftAt, setLocalDraftAt] = React.useState<number | null>(
    null
  );
  /** null = still looking, false = none, a number = written then. */
  const localDraftFound = localDraftAt === null ? null : localDraftAt >= 0;
  /** The thread whose provider draft has already been offered. */
  const importedForThreadRef = React.useRef<string | null>(null);

  // Local draft: skip saves until hydrate finishes.
  const draftReadyRef = React.useRef(false);
  /*
    Two reasons why this pane must not save the stored draft. They were one
    ref with two meanings, and they are apart now so that code can clear one
    and leave the other. The hydrate does that: a draft that it puts in the
    composer is not a discarded one, and it says nothing about the card.

    `draftDiscardedRef`: the composer here was closed, after a send, a
    discard or a second press of Reply. The draft was deleted, and a save
    would bring it back.

    `cardOwnsDraftRef`: the floating card holds this thread's draft. A read
    here would put a second composer on the same words. A save would write
    over the card's edits.

    `open` and `restore` clear both, as the one ref did: a message that a
    press or an Undo puts in this composer is this pane's to save.
  */
  const draftDiscardedRef = React.useRef(false);
  const cardOwnsDraftRef = React.useRef(false);
  /** True when a save from this pane would be wrong, for either reason. */
  const mustNotSave = React.useCallback(
    () => draftDiscardedRef.current || cardOwnsDraftRef.current,
    []
  );
  /** The draft key already thrown away, so it is not thrown away twice. */
  const discardedKeyRef = React.useRef<string | null>(null);
  /*
    A new reply is a new draft to discard.

    The guard stops one discard from running twice, when the bin and a key
    answer the same question. It was cleared only by Undo, so a reply written
    after a discard on the same thread could not be discarded: Discard closed
    the question and left the draft where it was. Opening the composer again
    clears the guard.
  */
  React.useEffect(() => {
    if (mode) discardedKeyRef.current = null;
  }, [mode]);
  const draftSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  /*
    The message as of this render, for the code that outlives one: the flush
    when the pane goes away, the hand-over to the card, and the discard.

    Written during render, and not in an effect. The flush runs in an
    effect's cleanup, and an effect here would run after it, so the last
    words before a change of thread would not be in the stored draft.
  */
  const composerSnapshotRef = React.useRef({
    mode,
    reply,
    subject: subjectDraft,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    attachItems,
    quoteMessageId,
  });
  composerSnapshotRef.current = {
    mode,
    reply,
    subject: subjectDraft,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    attachItems,
    quoteMessageId,
  };
  const threadDefaultsRef = React.useRef<{
    to: MailRecipient[];
    cc: MailRecipient[];
    allTo: MailRecipient[];
    allCc: MailRecipient[];
  }>({ to: [], cc: [], allTo: [], allCc: [] });
  if (thread) {
    threadDefaultsRef.current = {
      to: recipientsFromEmails(thread.reply.to),
      cc: recipientsFromEmails(thread.reply.cc),
      allTo: recipientsFromEmails(thread.reply.allTo ?? thread.reply.to),
      allCc: recipientsFromEmails(thread.reply.allCc ?? thread.reply.cc),
    };
  }

  const persistThreadDraft = React.useCallback(
    (snapshot = composerSnapshotRef.current, keepEmpty = false) => {
      if (!snapshot.mode || mustNotSave()) return;
      const defaults = threadDefaultsRef.current;
      const defaultTo =
        snapshot.mode === "forward"
          ? []
          : snapshot.mode === "replyAll"
            ? defaults.allTo
            : defaults.to;
      const defaultCc =
        snapshot.mode === "forward"
          ? []
          : snapshot.mode === "replyAll"
            ? defaults.allCc
            : defaults.cc;
      const draft: ThreadMailDraft = {
        key: threadDraftKey(account, threadId),
        kind: "thread",
        account,
        threadId,
        mode: snapshot.mode,
        body: snapshot.reply,
        subject: snapshot.subject.trim() || undefined,
        toList: snapshot.toList,
        ccList: snapshot.ccList,
        showCc: snapshot.showCc,
        editRecipients: snapshot.editRecipients,
        includeSignature: snapshot.includeSignature,
        fromAccount: snapshot.fromAccount,
        replyFocus: snapshot.replyFocus,
        attachments: readyAttachmentsForDraft(snapshot.attachItems),
        quoteMessageId: snapshot.quoteMessageId,
        updatedAt: Date.now(),
      };
      void saveThreadDraft(draft, defaultTo, defaultCc, keepEmpty);
    },
    [account, threadId, mustNotSave]
  );

  /**
   * Put a whole message in the composer, with its files.
   *
   * The files are not optional, and there is no way to leave the strip as
   * it is. A restore that forgot the files is how Undo after Send came back
   * with no attachments, and how a draft from the pop-out lost its files at
   * the next save. A message with no files passes an empty list.
   */
  const applySnapshot = React.useCallback(
    (snapshot: ComposerSnapshot, files: StripFiles) => {
      patchComposer(snapshotPatch(snapshot));
      replaceAttachments(files);
    },
    [patchComposer, replaceAttachments]
  );

  // Hydrate local draft for this thread (if any), then enable saves.
  React.useEffect(() => {
    let cancelled = false;
    draftReadyRef.current = false;
    draftDiscardedRef.current = false;
    cardOwnsDraftRef.current = false;
    setLocalDraftAt(null);
    importedDraftRef.current = null;
    importedForThreadRef.current = null;
    // The floating card holds this thread's draft. Reading it here would
    // put a second composer on the same words; saving would write over
    // the card's edits. The pane waits — and when the reply comes home,
    // this effect runs again and picks the draft up.
    if (replyFloating) {
      cardOwnsDraftRef.current = true;
      return;
    }
    void getDraft(threadDraftKey(account, threadId)).then((raw) => {
      if (cancelled) return;
      if (raw?.kind === "thread") {
        /*
          This draft is in the composer now, so it is not a discarded one.
          A slow store can answer after the reader opened and closed the
          composer, and the close said "discarded" about that empty box.
          Left set, it stopped every save of the draft that then opened, and
          the words typed into it were gone at the next change of thread.

          Not `restore`, which also clears `cardOwnsDraftRef`. A store that
          answers after the reply went to the card says nothing about who
          owns the draft.
        */
        draftDiscardedRef.current = false;
        applySnapshot(
          {
            mode: raw.mode,
            reply: raw.body,
            subject: raw.subject ?? "",
            toList: raw.toList,
            ccList: raw.ccList,
            showCc: raw.showCc,
            editRecipients: raw.editRecipients,
            includeSignature: raw.includeSignature,
            fromAccount: raw.fromAccount,
            replyFocus: raw.replyFocus,
            quoteMessageId: raw.quoteMessageId ?? null,
            showPreview: false,
          },
          raw.attachments
        );
      }
      // -1 stands for "looked, found none" so null can keep meaning
      // "still looking" — the difference the whole import turns on.
      setLocalDraftAt(raw?.kind === "thread" ? (raw.updatedAt ?? 0) : -1);
      draftReadyRef.current = true;
    });
    return () => {
      cancelled = true;
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      // Flush latest keystrokes when switching threads.
      if (draftReadyRef.current && !mustNotSave()) {
        persistThreadDraft();
      }
    };
  }, [account, threadId, applySnapshot, persistThreadDraft, replyFloating, mustNotSave]);

  /**
   * A reply the reader started in Gmail or Outlook, opened in the composer.
   *
   * Ours wins when both exist: a local draft is what they were editing here,
   * and it was saved on a keystroke. This also runs once per thread, so
   * closing the composer does not reopen it on the next render.
   */
  React.useEffect(() => {
    const providerDraft = thread?.providerDraft;
    const go = shouldImportProviderDraft({
      hasProviderDraft: Boolean(providerDraft),
      localDraftFound,
      localDraftAt: localDraftAt != null && localDraftAt >= 0 ? localDraftAt : null,
      providerDraftAt: providerDraft?.updatedAt
        ? Date.parse(providerDraft.updatedAt)
        : null,
      importedForThread: importedForThreadRef.current,
      threadId,
      composerOpen: Boolean(mode),
    });
    if (!go || !providerDraft) return;
    importedForThreadRef.current = threadId;
    importedDraftRef.current = providerDraft.ref;
    // Only what the reader wrote. The quoted thread under it comes off — this
    // composer adds its own quote when it sends.
    const htmlSplit = providerDraft.bodyHtml
      ? stripQuotedHtml(providerDraft.bodyHtml)
      : null;
    patchComposer({
      mode: "reply",
      reply:
        // Only trust the HTML when it actually had a quote block to cut. HTML
        // that is really flat text with ">" markers has no block to find, and
        // taking it whole is what put the entire conversation in the box.
        htmlSplit?.hadQuote
          ? dropRemoteImagesForEditing(htmlSplit.html)
          : draftBodyForComposer(providerDraft),
      toList: recipientsFromEmails(providerDraft.to),
      ccList: recipientsFromEmails(providerDraft.cc),
      showCc: providerDraft.cc.length > 0,
      showPreview: false,
    });
  }, [thread, threadId, mode, localDraftFound, localDraftAt, patchComposer]);

  // Debounced persist while the composer is open.
  React.useEffect(() => {
    if (!draftReadyRef.current || mustNotSave() || !mode) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      persistThreadDraft();
    }, 400);
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [
    mode,
    reply,
    toList,
    ccList,
    showCc,
    editRecipients,
    includeSignature,
    fromAccount,
    replyFocus,
    attachItems,
    persistThreadDraft,
    mustNotSave,
  ]);

  /**
   * Open the composer, or change what an open one is for.
   *
   * The draft is this pane's to save from here on. A patch with words makes
   * a new editor. A patch without them keeps the editor and its words, which
   * is how Reply becomes Reply all without the loss of a sentence.
   */
  const open = React.useCallback(
    (patch: ComposerPatch) => {
      draftDiscardedRef.current = false;
      cardOwnsDraftRef.current = false;
      patchComposer(patch);
    },
    [patchComposer]
  );

  /** Put a whole message back, with its files. The draft is ours to save. */
  const restore = React.useCallback(
    (snapshot: ComposerSnapshot, files: StripFiles) => {
      draftDiscardedRef.current = false;
      cardOwnsDraftRef.current = false;
      applySnapshot(snapshot, files);
    },
    [applySnapshot]
  );

  /**
   * Shut the composer and forget the draft: after a send, a discard, or a
   * second press of Reply. The strip empties with it.
   */
  const close = React.useCallback(() => {
    draftDiscardedRef.current = true;
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    void deleteDraft(threadDraftKey(account, threadId));
    patchComposer({
      mode: null,
      replyFocus: false,
      toList: threadDefaultsRef.current.to,
      ccList: threadDefaultsRef.current.cc,
      reply: "",
      showPreview: false,
      editRecipients: false,
      showCc: false,
      updateCrmNotes: false,
      // Along with everything else the closed composer leaves behind. A
      // question about a reply that has gone would otherwise be waiting,
      // still true, over the next reply written here.
      confirmDiscard: false,
      // A subject belongs to the message it was typed over. Left standing, it
      // would sit on the next reply written in this pane — under the name of
      // a conversation that has gone.
      subjectDraft: "",
      subjectOpen: false,
    });
    resetForwardWhole();
    clearAttachments();
  }, [account, threadId, patchComposer, resetForwardWhole, clearAttachments]);

  /**
   * Hand the message to the floating card: store it, then empty this box.
   *
   * `snapshot` is what to store. The default is what is on screen. "Change
   * subject" passes its own, because it sets the subject and floats in one
   * press, and the state it just set is not in the snapshot until the next
   * render.
   */
  const handOver = React.useCallback(
    (snapshot = composerSnapshotRef.current) => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      // Kept even when it says nothing yet: the card opens from this draft,
      // and an empty composer must arrive there as a composer.
      persistThreadDraft(snapshot, true);
      // No saves after the handover: the card owns the draft now, and a
      // stale timer here must not write yesterday's words over its edits.
      cardOwnsDraftRef.current = true;
      patchComposer({
        mode: null,
        replyFocus: false,
        reply: "",
        showPreview: false,
        editRecipients: false,
        showCc: false,
        confirmDiscard: false,
      });
      clearAttachments();
    },
    [persistThreadDraft, patchComposer, clearAttachments]
  );

  /** New words from outside the editor: an AI draft, or the brief back. */
  const replaceWords = React.useCallback(
    (html: string) => patchComposer({ reply: html }),
    [patchComposer]
  );

  return {
    open,
    restore,
    close,
    handOver,
    replaceWords,
    composerSnapshotRef,
    discardedKeyRef,
    importedDraftRef,
    importedForThreadRef,
  };
}
