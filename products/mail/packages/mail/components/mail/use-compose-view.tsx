"use client";

/*
 * Everything the new-message composer knows and does, apart from what it
 * draws: the draft and its saving, the fields, the files, the account it
 * sends from, sending and scheduling, the card it floats in, and its keys.
 *
 * ComposeView calls this once, at its top, and draws from what it returns.
 * The statements here are ComposeView's own, in the order they ran, so the
 * hooks run in the same order as before.
 */

import * as React from "react";
import { sendsFromHere, shortcutMatchesEvent } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import { toast } from "@/lib/mail/toast";

import {
  useComposerFileDrop,
  useComposerPaste,
  useDraftAttachments,
} from "@/components/mail/draft-attachments";
import { composeFromDefault } from "@/lib/mail/compose-from";
import { sendWithUndo } from "@/components/mail/undo-send";
import {
  useCanSendLater,
  useOutlookAccounts,
} from "@/lib/mail/use-outlook-accounts";
import { isPublicMailProduct } from "@/lib/mail/product-flavor";
import { type AiReplyDraftResult } from "@/components/mail/AiReplyNotes";
import { outlookDraftAccount } from "@/lib/mail/outlook-handover";
import {
  bodyTravels,
  ccBackToSelf,
  copyMessageToClipboard,
  saveAttachmentsForHandover,
  withoutTrailingSignature,
  openOutlookCompose,
  outlookComposeUrl,
} from "@/lib/mail/outlook-compose";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { fetchSignatureSettings, type SignatureSettings } from "@/components/mail/SignatureDialog";
import { usePinchZoom } from "@/components/mail/use-mail-layout";
import { startPointerDrag } from "@/lib/pointer-drag";
import { type RichTextEditorHandle } from "@/components/ui/RichTextEditor";
import {
  bodyToEmailHtml,
  htmlToPlainText,
  plainTextToEditorHtml,
} from "@/lib/client-email-html";
import { mailApiJson as apiJson } from "@/lib/mail/api";
import {
  emailsOfRecipients,
  flattenRecipientsForSend,
  recipientsFromEmails,
  type MailRecipient,
} from "@/lib/mail/contact-list-types";
import {
  COMPOSE_DRAFT_KEY,
  newComposeDraftKey,
  deleteDraft,
  markDraftHandedOver,
  getDraft,
  setDraft,
  readyAttachmentsForDraft,
  saveComposeDraft,
  type ComposeMailDraft,
  type MailDraft,
} from "@/lib/mail/local-drafts";
import { mailSay, useMailT } from "@/lib/mail/i18n";
import { useFloatingCard } from "@/components/mail/floating-card";
/**
 * How large a pasted picture may be, written into the message.
 *
 * A screenshot from a modern display is several megabytes, and base64 adds a
 * third on top. Written into the body, that is what the recipient downloads
 * before they can read the first line — and nobody wants an email that
 * arrives at eight megabytes because a window was photographed.
 *
 * Above this it goes as a file instead, which is what an attachment is for.
 */
const MAX_INLINE_PASTE_BYTES = 2 * 1024 * 1024;

/**
 * How many lines the subject can take.
 *
 * The subject is the heading of the card. Two lines hold a long one. More
 * than two makes the heading the card, and pushes the message off it.
 */
const SUBJECT_MAX_LINES = 2;

/**
 * The type size of the subject, in pre-zoom pixels.
 *
 * A subject too long for two lines is set smaller until it fits, down to
 * the minimum. The maximum is the size the class gives it, repeated here
 * because the measurement writes the size on the element and then cannot
 * read the class value back.
 *
 * The ratio is the line height over the type size, which is `leading-8`
 * over `text-2xl`.
 */
const SUBJECT_MAX_PX = 24;
const SUBJECT_MIN_PX = 16;
const SUBJECT_LINE_RATIO = 4 / 3;

/** The same, measured on a data: URI — base64 is four bytes for every three. */
function dataUrlTooBig(dataUrl: string): boolean {
  const comma = dataUrl.indexOf(",");
  const base64 = comma < 0 ? dataUrl : dataUrl.slice(comma + 1);
  return Math.floor((base64.length * 3) / 4) > MAX_INLINE_PASTE_BYTES;
}

/** What to call a draft in the toast that says it has gone. */
function discardedDraftName(draft: MailDraft): string {
  const subject = draft.kind === "compose" ? draft.subject.trim() : "";
  if (subject) return subject.length > 60 ? `${subject.slice(0, 60)}…` : subject;
  const to = draft.toList.find((r) => r.kind === "email");
  if (to) return to.name || to.email;
  const list = draft.toList[0];
  return list && list.kind === "list" ? list.name : "";
}

export type ComposeViewProps = {
  accounts: string[];
  /**
   * The account tabs in force, so a new message starts from the mailbox
   * being worked in. One tab is a scope; none or several is "All".
   */
  scope?: string[];
  zoom: number;
  onZoomAdjust: (delta: number) => void;
  focusMode: boolean;
  /** Absent on a phone, where there is no list beside this to put away. */
  onToggleFocus?: () => void;
  onClose: () => void;
  /**
   * The bin was pressed and the draft is gone. Absent means close, as for
   * any other ending. The Drafts view passes this to open the next draft,
   * the way a delete in the inbox lands on the next conversation.
   */
  onDiscarded?: () => void;
  /**
   * Send this message into a floating card, so the reader can look at
   * other mail while they write it. The draft is written first and this is
   * handed its key: the card opens on the same draft, so nothing travels
   * but the name of it.
   */
  onFloat?: (draftKey: string) => void;
  /** This composer IS the floating card — see `floating` in ThreadPane. */
  floating?: boolean;
  /** Put the card away and open the message in the pane again. */
  onUnfloat?: () => void;
  /** Refresh Sent for the From mailbox after a successful send. */
  onSent?: (accountEmail: string) => void;
  /**
   * The reader took the send back inside the count.
   *
   * Open the composer again on the draft named here. It was deliberately
   * left alone by the send, so it still holds what they had written.
   */
  onUndoSend?: (draftKey: string) => void;
  seed?: {
    to: string[];
    subject: string;
    continuedFromLabel: string;
    /** Continue this stored draft rather than starting a new one. */
    draftKey?: string;
  } | null;
};

export function useComposeView(props: ComposeViewProps) {
  const {
  accounts,
  scope,
  zoom,
  onZoomAdjust,
  focusMode,
  onToggleFocus,
  onClose,
  onDiscarded,
  onFloat,
  floating,
  onUnfloat,
  onSent,
  onUndoSend,
  seed,
} = props;

  const t = useMailT();
  /**
   * The address this composer opens on, settled before the first paint.
   *
   * Read while the state is made, not in an effect afterwards: an effect
   * runs after the paint, so the composer showed the first mailbox for a
   * frame and then swapped it for the remembered one, which reads as a
   * flicker on the line the eye is already on. Nothing here is
   * server-rendered to mismatch — the planner's mail route hosts a webview
   * rather than drawing the composer, so this only ever runs in the app,
   * where `localStorage` is there to be read.
   */
  const [from, setFrom] = React.useState(() =>
    composeFromDefault(accounts, scope)
  );
  /** Ticked, the next address picked becomes the one new messages open on. */
  const [rememberFrom, setRememberFrom] = React.useState(false);
  /**
   * Whether that address is settled — by the line above, by the remembered
   * choice arriving late, or by a draft that carries its own. Whichever
   * lands first, the others must not overwrite it.
   */
  const fromSettledRef = React.useRef(accounts.length > 0);
  // Only for a composer opened before its mailboxes are known: there was
  // nothing to resolve against above, so it is resolved when they arrive.
  React.useEffect(() => {
    if (fromSettledRef.current || !accounts.length) return;
    fromSettledRef.current = true;
    setFrom(composeFromDefault(accounts, scope));
  }, [accounts, scope]);
  const canSendLater = useCanSendLater(from);
  /*
    Where a hand-over to Outlook would put this message — see the reply
    box, which explains the choice. This one is simpler: a new message
    belongs to no conversation, so there is nothing to thread it into
    either way, and the only difference the other mailbox makes is the
    address it will leave from.
  */
  const outlookAccounts = useOutlookAccounts();
  const outlookTarget = React.useMemo(
    () => outlookDraftAccount(outlookAccounts, from),
    [outlookAccounts, from]
  );
  /*
    The button no longer waits for a mailbox. The route that needs one is
    the better of the two — a real draft, in the conversation — but the one
    that needs nothing is the one that reaches the mailbox this app cannot
    sign in to, which is usually the mailbox the reader is reaching for.
  */
  const canOpenInOutlook = !isPublicMailProduct();
  const outlookElsewhere = Boolean(outlookTarget) && outlookTarget !== from;
  const [handingOver, setHandingOver] = React.useState(false);
  /** Finish this one in Outlook: the draft is made in the mailbox, not sent. */
  const openInOutlook = async () => {
    if (!canOpenInOutlook || handingOver) return;
    if (!attachmentsReady) {
      toast.error(mailSay("stillPreparingAttachments"));
      return;
    }
    const attachments = attachmentPayload();
    const bcc = [...flatBcc, ...flatTo.bccEmails, ...flatCc.bccEmails];
    setHandingOver(true);
    try {
      // No mailbox of ours to write into — see the reply box, which explains
      // why that is the ordinary case rather than the odd one.
      if (!outlookTarget) {
        const html = bodyText.trim() ? bodyToEmailHtml(body) : "";
        // Outlook puts its own signature on what it opens, so ours does not
        // go over with the words — see withoutTrailingSignature.
        const carrying = withoutTrailingSignature(
          { html: html || bodyText, text: bodyText },
          htmlToPlainText(sigSettings?.signature ?? "")
        );
        const carried = bodyTravels(carrying.html, carrying.text);
        if (!carried) {
          await copyMessageToClipboard(carrying);
        }
        await openOutlookCompose(
          outlookComposeUrl({
            to: flatTo.emails,
            // A copy back to the mailbox it was written from, so what goes
            // out from Outlook lands in this app's mail too.
            cc: ccBackToSelf({
              from: from,
              to: flatTo.emails,
              cc: flatCc.emails,
            }),
            subject: subject.trim(),
            body: carried ? carrying.text : undefined,
          })
        );
        /*
          The files, which a mailto: cannot carry.

          They were dropped without a word before this: the message opened
          in Outlook and the attachments simply were not on it. Now they go
          to the downloads folder with the file manager pointed at them, and
          the toast says where they are — or says they did not travel, when
          there is nowhere to put them.
        */
        const savedFiles = await saveAttachmentsForHandover(attachments);
        toast.success(
          carried ? mailSay("outlookIsOpen") : mailSay("outlookIsOpenPaste"),
          attachments.length
            ? {
                description: savedFiles
                  ? mailSay("outlookFilesInDownloads", {
                      count: `${savedFiles} file${savedFiles === 1 ? "" : "s"}`,
                    })
                  : mailSay("outlookFilesLeftBehind", {
                      count: `${attachments.length} file${attachments.length === 1 ? "" : "s"}`,
                    }),
                duration: 12_000,
              }
            : undefined
        );
        return;
      }
      await apiJson("/api/mail/outlook-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: outlookTarget,
          to: flatTo.emails,
          cc: flatCc.emails.length ? flatCc.emails : undefined,
          bcc: bcc.length ? [...new Set(bcc)] : undefined,
          subject: subject.trim(),
          body: bodyText,
          html: bodyText.trim() ? bodyToEmailHtml(body) : undefined,
          // The signature belongs to the mailbox it is sent from, and that
          // mailbox will add its own.
          includeSignature: outlookElsewhere ? false : includeSignature,
          attachments: attachments.length ? attachments : undefined,
        }),
      });
      const invoke = tauriInvoke();
      const refused = invoke
        ? await invoke("activate_outlook").then(
            () => "",
            (err: unknown) => {
              console.warn("[mail] couldn't bring Outlook forward:", err);
              // What Rust said, which is what `open` said. A reason on the
              // screen is the difference between a bug report and a shrug.
              return err instanceof Error
                ? err.message
                : String(err) || mailSay("outlookDidNotOpen");
            }
          )
        : mailSay("outlookDidNotOpen");
      const landed = outlookElsewhere
        ? mailSay("draftIsInOutlookFrom", { account: outlookTarget })
        : mailSay("draftIsInOutlook");
      void markDraftHandedOver(draftKeyRef.current, from);
      /* The same offer the reply box makes: a handover is not a send, so
         the copy here would sit in Drafts for ever otherwise. */
      toast.success(landed, {
        ...(refused ? { description: refused } : null),
        duration: 12_000,
        action: {
          label: mailSay("discardTheCopyHere"),
          onClick: () => discardCompose(),
        },
      });
    } catch (err) {
      const fallback = outlookTarget
        ? mailSay("couldNotDraftInOutlook")
        : mailSay("couldNotOpenOutlook");
      /*
        Tauri refuses with a string, not an Error.

        Reading `.message` off it and falling back to a sentence of our own
        threw away the only line that said what was wrong — "command not
        found", when the window is older than the command it is calling.
      */
      const said =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "";
      toast.error(said.trim() || fallback);
    } finally {
      setHandingOver(false);
    }
  };
  const [toList, setToList] = React.useState<MailRecipient[]>(() =>
    seed?.to?.length ? recipientsFromEmails(seed.to) : []
  );
  const [ccList, setCcList] = React.useState<MailRecipient[]>([]);
  const [bccList, setBccList] = React.useState<MailRecipient[]>([]);
  const [showCc, setShowCc] = React.useState(false);
  const [showBcc, setShowBcc] = React.useState(false);
  const [subject, setSubject] = React.useState(seed?.subject ?? "");
  const [body, setBody] = React.useState("");
  const [editorKey, setEditorKey] = React.useState(0);
  const [includeSignature, setIncludeSignature] = React.useState(true);
  const [showPreview, setShowPreview] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [draftingReply, setDraftingReply] = React.useState(false);
  const [aiReplyNotes, setAiReplyNotes] =
    React.useState<AiReplyDraftResult | null>(null);
  const [aiReplyWorking, setAiReplyWorking] = React.useState<
    "reading" | "writing" | null
  >(null);
  const aiReplyRun = React.useRef<AbortController | null>(null);
  const [sigSettings, setSigSettings] = React.useState<SignatureSettings | null>(
    null
  );
  const [sigDialogOpen, setSigDialogOpen] = React.useState(false);
  /**
   * This composer's own draft key, fixed for its lifetime.
   *
   * A composer opened to continue a draft is handed that draft's key. Any
   * other composer makes a new one, so two unsent messages can exist at once
   * — they used to share a single key and the second wrote over the first.
   */
  const draftKeyRef = React.useRef<string>(
    seed?.draftKey ?? newComposeDraftKey()
  );
  const editorHandle = React.useRef<RichTextEditorHandle | null>(null);
  const composeRef = React.useRef<HTMLDivElement | null>(null);
  /**
   * Out of the way, ordinary, or the whole window — see `floating-card`,
   * the frame this card shares with the reply card.
   *
   * Only ever the first of those in the pane, which is not a card.
   */
  const card = useFloatingCard(
    Boolean(floating),
    "dh-mail-floating-compose-size"
  );
  /** The root element, to the pinch zoom and to the card alike. */
  const setComposeNode = React.useCallback(
    (node: HTMLDivElement | null) => {
      composeRef.current = node;
      card.cardRef.current = node;
    },
    [card.cardRef]
  );
  const {
    items: attachItems,
    ready: attachmentsReady,
    addFiles: addAttachFiles,
    remove: removeAttach,
    replaceAll: replaceAttachments,
    payload: attachmentPayload,
  } = useDraftAttachments();
  /** The draft attachment open in the preview, by strip id. */
  const [draftPreviewId, setDraftPreviewId] = React.useState<string | null>(
    null
  );
  /**
   * A picture into the message itself, at the caret.
   *
   * The same for a paste and for a drop on the words, so both land the
   * same way. Too big to write in, or no editor to write into: it is a
   * file, and the caller attaches it instead.
   */
  const insertInlineImage = React.useCallback((dataUrl: string) => {
    if (dataUrlTooBig(dataUrl) || !editorHandle.current) return false;
    editorHandle.current.insertImage(dataUrl);
  }, []);
  const { dragging: attachDragging, dropHandlers: attachDropHandlers } =
    useComposerFileDrop(addAttachFiles, {
      caretToPoint: (x, y) =>
        editorHandle.current?.caretToPoint(x, y) ?? false,
      insert: insertInlineImage,
    });
  const { pasteHandlers: attachPasteHandlers } =
    useComposerPaste(addAttachFiles, insertInlineImage);
  usePinchZoom(composeRef, onZoomAdjust, true);
  // Follow the sending account's "include on new messages" preference until
  // the user adds/removes the signature themselves.
  const sigTouchedRef = React.useRef(false);
  const draftReadyRef = React.useRef(false);
  const draftDiscardedRef = React.useRef(false);
  /** The draft key already thrown away, so it is not thrown away twice. */
  const discardedKeyRef = React.useRef<string | null>(null);
  const draftSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const composeSnapshotRef = React.useRef({
    from,
    toList,
    ccList,
    bccList,
    showCc,
    showBcc,
    subject,
    body,
    includeSignature,
    attachItems,
  });
  composeSnapshotRef.current = {
    from,
    toList,
    ccList,
    bccList,
    showCc,
    showBcc,
    subject,
    body,
    includeSignature,
    attachItems,
  };
  const persistComposeDraft = React.useCallback(
    (snapshot = composeSnapshotRef.current) => {
      if (draftDiscardedRef.current) return;
      const draft: ComposeMailDraft = {
        key: draftKeyRef.current,
        kind: "compose",
        from: snapshot.from,
        subject: snapshot.subject,
        body: snapshot.body,
        toList: snapshot.toList,
        ccList: snapshot.ccList,
        bccList: snapshot.bccList,
        showCc: snapshot.showCc,
        showBcc: snapshot.showBcc,
        includeSignature: snapshot.includeSignature,
        attachments: readyAttachmentsForDraft(snapshot.attachItems),
        updatedAt: Date.now(),
      };
      void saveComposeDraft(draft);
    },
    []
  );
  /**
   * Hand the message to the floating card.
   *
   * Written now and closed without deleting, which is the whole difference
   * from closing: the words survive the handover, and the card opens on the
   * same draft key.
   */
  const floatCompose = React.useCallback(() => {
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    persistComposeDraft();
    // No saves after the handover: the card owns the draft now.
    draftDiscardedRef.current = true;
    onFloat?.(draftKeyRef.current);
  }, [persistComposeDraft, onFloat]);
  /**
   * Throw the message away, with a way back.
   *
   * The draft as it stands is read before it goes, so Undo can put the
   * same one back — the bin is a key as well as a button now, and a key
   * is easy to press by mistake. Nothing here waits for the read: the
   * composer closes at once, and the offer stands for the toast's life.
   */
  const discardCompose = React.useCallback(() => {
    const key = draftKeyRef.current;
    // Once for one draft — the bin and the delete key both come here, and
    // the read below is asynchronous, so two runs would both find a draft
    // to save and both say it had gone.
    if (discardedKeyRef.current === key) return;
    discardedKeyRef.current = key;
    draftDiscardedRef.current = true;
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    void (async () => {
      const saved = await getDraft(key).catch(() => null);
      await deleteDraft(key);
      if (!saved) return;
      // Named, so a bin pressed by mistake says which message it took: the
      // subject, or whom it was to when it had none yet.
      const name = discardedDraftName(saved);
      toast(
        name
          ? mailSay("draftDiscardedNamed", { name })
          : mailSay("draftDiscarded"),
        {
        action: {
          label: mailSay("undo"),
          onClick: () => {
            discardedKeyRef.current = null;
            void setDraft(saved);
          },
        },
        }
      );
    })();
    (onDiscarded ?? onClose)();
  }, [onClose, onDiscarded]);
  /**
   * Load the one new-message draft, or stand off it.
   *
   * There is a single slot. A composer opened with a seed is a different
   * message from whatever is in it, so it neither loads it nor writes over it
   * — it used to do the second, which threw away a half-written email every
   * time an address was clicked in a message.
   */
  React.useEffect(() => {
    let cancelled = false;
    draftReadyRef.current = false;
    draftDiscardedRef.current = false;
    // A seeded composer starts from its seed, not from anything stored. The
    // one exception is a seed that names a draft to continue.
    if (seed && !seed.draftKey) {
      draftReadyRef.current = true;
      placeCaret(Boolean(seed.subject?.trim()));
      return () => {
        cancelled = true;
        if (draftSaveTimerRef.current) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        if (draftReadyRef.current && !draftDiscardedRef.current) {
          persistComposeDraft();
        }
      };
    }
    // No seed: pick up the draft written before keys existed, so nothing in
    // flight is stranded by this change.
    const loadKey = seed?.draftKey ?? COMPOSE_DRAFT_KEY;
    void getDraft(loadKey).then((raw) => {
      if (cancelled) return;
      if (raw?.kind === "compose") {
        // Write back to where it came from. Saving a loaded draft under a
        // fresh key would leave the original behind and make two of it.
        draftKeyRef.current = loadKey;
        // The draft's own address wins: it was chosen for this message.
        // Only a draft that never recorded one falls back to the default.
        fromSettledRef.current = true;
        setFrom(raw.from || composeFromDefault(accounts));
        setToList(raw.toList);
        setCcList(raw.ccList);
        setBccList(raw.bccList);
        setShowCc(raw.showCc);
        setShowBcc(raw.showBcc);
        setSubject(raw.subject);
        setBody(raw.body);
        setIncludeSignature(raw.includeSignature);
        replaceAttachments(raw.attachments);
        setEditorKey((k) => k + 1);
        sigTouchedRef.current = true;
      }
      draftReadyRef.current = true;
      placeCaret(Boolean(raw?.kind === "compose" && raw.subject?.trim()));
    });
    return () => {
      cancelled = true;
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
      if (draftReadyRef.current && !draftDiscardedRef.current) {
        persistComposeDraft();
      }
    };
    // Mount-only hydrate for this compose session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    if (!draftReadyRef.current || draftDiscardedRef.current) return;
    if (draftSaveTimerRef.current) clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = setTimeout(() => {
      draftSaveTimerRef.current = null;
      persistComposeDraft();
    }, 400);
    return () => {
      if (draftSaveTimerRef.current) {
        clearTimeout(draftSaveTimerRef.current);
        draftSaveTimerRef.current = null;
      }
    };
  }, [
    from,
    toList,
    ccList,
    bccList,
    showCc,
    showBcc,
    subject,
    body,
    includeSignature,
    attachItems,
    persistComposeDraft,
  ]);
  React.useEffect(() => {
    let cancelled = false;
    void fetchSignatureSettings(from)
      .then((s) => {
        if (cancelled) return;
        setSigSettings(s);
        if (!sigTouchedRef.current) {
          setIncludeSignature(s.includeOnNew);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [from]);
  const bodyText = htmlToPlainText(body);
  const flatTo = flattenRecipientsForSend(toList);
  const flatCc = flattenRecipientsForSend(ccList);
  const flatBcc = emailsOfRecipients(bccList);
  /**
   * Enough of a message to send.
   *
   * A subject counts. Plenty of real mail is a single line in the subject and
   * nothing under it — "Running ten minutes late", "Approved" — and refusing
   * to send one means retyping it into the body to satisfy us.
   */
  /**
   * Somebody to send it to, anywhere on the envelope.
   *
   * A course mail goes to two dozen people in Bcc and to nobody in To,
   * which is what Bcc is for. Counting only To greyed out Send and Open in
   * Outlook on exactly the message Bcc exists for — and the app's own
   * Facilitators page hands the addresses over saying "paste into Bcc".
   */
  const hasRecipient = Boolean(
    flatTo.emails.length || flatCc.emails.length || flatBcc.length
  );
  const canSend =
    Boolean(
      from &&
        hasRecipient &&
        (bodyText.trim() || subject.trim() || attachItems.length) &&
        attachmentsReady
    ) && !sending;
  const shortcuts = useMailShortcuts();
  const stopAiReply = React.useCallback(() => {
    aiReplyRun.current?.abort();
    aiReplyRun.current = null;
    setDraftingReply(false);
    setAiReplyWorking(null);
    setAiReplyNotes(null);
  }, []);
  /**
   * Draft this new message with the AI.
   *
   * Same path as a reply: the planner matches the people in To and Cc to
   * CRM records, reads past mail with them, and answers a draft. There is
   * no thread. The box is the brief when it already holds notes.
   */
  const draftComposeWithAi = React.useCallback(
    async (hint: string) => {
      if (draftingReply || !from) return;
      const notes = bodyText.trim();
      const run = new AbortController();
      aiReplyRun.current?.abort();
      aiReplyRun.current = run;
      setDraftingReply(true);
      setAiReplyNotes(null);
      setAiReplyWorking("reading");
      const compose = {
        to: flattenRecipientsForSend(toList).emails,
        cc: flattenRecipientsForSend(ccList).emails,
        subject: subject.trim(),
      };
      try {
        try {
          const matched = await apiJson<Partial<AiReplyDraftResult>>(
            "/api/mail/reply-draft",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                account: from,
                compose,
                phase: "match",
              }),
              signal: run.signal,
            }
          );
          if (run.signal.aborted) return;
          if (matched.scenario) {
            setAiReplyNotes({
              body: "",
              scenario: matched.scenario,
              usedRecords: matched.usedRecords ?? [],
              gaps: [],
            });
          }
        } catch {
          // Keep the plain "reading" line and go on to the draft.
        }
        if (run.signal.aborted) return;
        setAiReplyWorking("writing");
        const result = await apiJson<Partial<AiReplyDraftResult>>(
          "/api/mail/reply-draft",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              account: from,
              compose,
              hint: hint || undefined,
              notes: notes || undefined,
            }),
            signal: run.signal,
          }
        );
        if (run.signal.aborted) return;
        if (typeof result.body !== "string" || !result.body.trim()) {
          throw new Error(t("aiReplyEmpty"));
        }
        setBody(plainTextToEditorHtml(result.body));
        setEditorKey((k) => k + 1);
        if (result.subject?.trim() && !subject.trim()) {
          setSubject(result.subject.trim());
        }
        setAiReplyNotes({
          body: result.body,
          ...(result.subject ? { subject: result.subject } : {}),
          scenario: result.scenario ?? "cold",
          usedRecords: result.usedRecords ?? [],
          gaps: result.gaps ?? [],
          ...(notes ? { brief: notes } : {}),
        });
      } catch (err) {
        if (run.signal.aborted) return;
        setAiReplyNotes(null);
        toast.error(
          `${t("aiComposeFailed")}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } finally {
        if (aiReplyRun.current === run) {
          aiReplyRun.current = null;
          setDraftingReply(false);
          setAiReplyWorking(null);
        }
      }
    },
    [bodyText, ccList, draftingReply, from, subject, t, toList]
  );
  const send = async (sendAt?: string) => {
    if (!canSend) return;
    if (!attachmentsReady) {
      toast.error(mailSay("stillPreparingAttachments"));
      return;
    }
    const attachments = attachmentPayload();
    const bcc = [
      ...flatBcc,
      ...flatTo.bccEmails,
      ...flatCc.bccEmails,
    ];
    const payload = JSON.stringify({
      account: from,
      to: flatTo.emails,
      cc: flatCc.emails.length ? flatCc.emails : undefined,
      bcc: bcc.length ? [...new Set(bcc)] : undefined,
      subject: subject.trim(),
      body: bodyText,
      html: bodyText.trim() ? bodyToEmailHtml(body) : undefined,
      includeSignature,
      attachments: attachments.length ? attachments : undefined,
      sendAt,
    });

    /**
     * The message going out, once nobody has taken it back.
     *
     * Runs after this composer has closed, and after it has unmounted, so it
     * holds everything it needs. The draft is only dropped here: until the
     * mail is away it is what the reader gets back.
     */
    const deliver = async () => {
      try {
        await apiJson("/api/mail/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
        if (sendAt) {
          // Where it is waiting, not just when it goes. The whole point of
          // handing the time to Exchange is that this machine can be shut,
          // and a reader who does not know that will leave it running.
          toast.success(
            mailSay("sendsWhen", { when: formatSnoozeWakeLabel(sendAt) }),
            { description: mailSay("outlookHoldsIt") }
          );
        } else {
          toast.success(mailSay("sent"));
        }
        onSent?.(from);
        // The key this composer writes under, which is not the shared one:
        // deleting that instead left the real draft behind after every send.
        void deleteDraft(draftKeyRef.current);
      } catch (err) {
        /* Retry re-runs this same closure: the payload was captured whole
           when Send was pressed, so it needs nothing from the composer,
           which closed before the count ran out. The draft is still there
           until a send succeeds, so nothing is lost either way. */
        const firstTo = flatTo.emails[0] ?? "the recipient";
        toast.error(`Your message to ${firstTo} did not send`, {
          description: err instanceof Error ? err.message : undefined,
          duration: 15_000,
          action: { label: "Retry", onClick: () => void deliver() },
        });
      }
    };

    // A time was picked: the provider does the waiting, and there is nothing
    // for a countdown to hold back.
    if (sendAt) {
      setSending(true);
      try {
        await deliver();
        draftDiscardedRef.current = true;
        if (draftSaveTimerRef.current) {
          clearTimeout(draftSaveTimerRef.current);
          draftSaveTimerRef.current = null;
        }
        onClose();
      } finally {
        setSending(false);
      }
      return;
    }

    // The composer is finished with either way, so it closes now. The draft
    // stays until `deliver` runs, which is what Undo comes back to.
    if (draftSaveTimerRef.current) {
      clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    onClose();
    sendWithUndo({
      onSend: () => void deliver(),
      // With the key, because a composer opened with nothing looks for the
      // shared draft and this one was written under its own.
      onUndo: () => onUndoSend?.(draftKeyRef.current),
    });
  };
  /**
   * Send, focus-message, and float-message from inside the message being written.
   *
   * The thread's other shortcuts stand down whenever the focus is in a field,
   * so a reply can contain the letter R. These have to work from exactly
   * there, so the composer listens for them itself. `send` guards its own
   * preconditions, so a press with nothing to send does nothing. Focus uses
   * the same toggle the button calls. Float uses the same toggle the card
   * button calls.
   */
  const sendShortcutRef = React.useRef(send);
  sendShortcutRef.current = send;
  const focusMessageShortcutRef = React.useRef(onToggleFocus);
  focusMessageShortcutRef.current = onToggleFocus;
  const floatMessageShortcutRef = React.useRef<() => void>(() => {});
  floatMessageShortcutRef.current = () => {
    if (floating) {
      onUnfloat?.();
      return;
    }
    if (!onFloat) return;
    floatCompose();
  };
  const discardShortcutRef = React.useRef(discardCompose);
  discardShortcutRef.current = discardCompose;
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const sendHit = shortcutMatchesEvent(event, shortcuts.send);
      const focusHit = shortcutMatchesEvent(event, shortcuts.focusMessage);
      const floatHit = shortcutMatchesEvent(event, shortcuts.floatMessage);
      /*
        The delete key means this message, because this message is what
        is on screen. It reached nothing before: the reader pane holds
        that shortcut and the reader pane is not mounted while a message
        is being written, so a draft opened from the list answered the
        key with silence.

        Only from outside a field. Backspace inside the words is a
        backspace, which is the whole reason this one is guarded and the
        send key is not.
      */
      if (shortcutMatchesEvent(event, shortcuts.delete)) {
        const active = document.activeElement as HTMLElement | null;
        if (active?.closest('input, textarea, [contenteditable="true"]')) {
          return;
        }
        if (
          !sendsFromHere({
            caretHere: Boolean(composeRef.current?.contains(active)),
            caretNowhere: !active || active === document.body,
            floating: Boolean(floating),
          })
        ) {
          return;
        }
        event.preventDefault();
        if (event.repeat) return;
        discardShortcutRef.current();
        return;
      }
      if (!sendHit && !focusHit && !floatHit) return;
      if (floatHit) {
        if (
          !sendsFromHere({
            caretHere: Boolean(
              composeRef.current?.contains(document.activeElement)
            ),
            caretNowhere:
              !document.activeElement ||
              document.activeElement === document.body,
            floating: Boolean(floating),
          })
        ) {
          return;
        }
        event.preventDefault();
        if (event.repeat) return;
        floatMessageShortcutRef.current();
        return;
      }
      event.preventDefault();
      if (focusHit) {
        if (event.repeat) return;
        focusMessageShortcutRef.current?.();
        return;
      }
      void sendShortcutRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, floating]);
  /* px-4 and a narrower label column: "From" and "To" are four letters and
     two, and sixty-four pixels of nothing after them pushed every address
     into the middle of the window. */
  const rowClass =
    "flex shrink-0 items-start gap-2 border-b border-stone-200 px-4 py-2.5";
  const labelClass = "w-10 shrink-0 pt-0.5 text-[15px] text-stone-500";
  /** Where Tab goes from To: the next thing to fill in, not the Cc button. */
  const ccInputRef = React.useRef<HTMLInputElement | null>(null);
  const subjectInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  /**
   * Tab out of the last recipient field lands in the message.
   *
   * It used to land in the Subject row, which was the next thing down the
   * card. The subject is the heading now and sits above From, so sending
   * Tab to it would walk back up the card past everything already filled
   * in. Quill has no focus on its handle, so the editor is found the way
   * the thread composer finds it.
   */
  const focusBody = React.useCallback(() => {
    composeRef.current?.querySelector<HTMLElement>(".ql-editor")?.focus();
  }, []);
  const fromSelectRef = React.useRef<HTMLButtonElement | null>(null);
  const toInputRef = React.useRef<HTMLInputElement | null>(null);
  /**
   * Where the caret is when the card opens.
   *
   * The subject, on a message that has none. It is the first thing written
   * and the card used to open with nothing focused at all, so the first
   * words went to the page and were lost.
   *
   * A card opened on a stored draft, or on a seed that brought a subject
   * with it, already has one — there the message is what is unfinished, so
   * the caret goes into it instead of landing in the middle of a line
   * somebody has already written.
   *
   * Asked for as a state, and done in the effect below, because what it
   * has to land on may not be there yet: the draft arrives after the card,
   * and loading one swaps the editor for a new one, which would take the
   * focus off whatever had it.
   */
  const [caretGoesTo, setCaretGoesTo] = React.useState<
    "subject" | "body" | null
  >(null);
  const placeCaret = React.useCallback(
    (hasSubject: boolean) => setCaretGoesTo(hasSubject ? "body" : "subject"),
    []
  );
  /**
   * Tab out of the subject goes on down the card.
   *
   * The heading shares its row with the focus-mode button, so that button
   * is the next thing in the document and Tab landed on it — a control
   * that rearranges the window, in the middle of filling one in. The next
   * thing to fill in is From, or To when there is only one account to send
   * from and no From to land on.
   */
  const onSubjectKeyDown = (event: React.KeyboardEvent) => {
    // The subject wraps, but it is still one line of text. Enter would put
    // a real break in it, so it goes to the message instead.
    if (event.key === "Enter") {
      event.preventDefault();
      focusBody();
      return;
    }
    if (event.key !== "Tab" || event.shiftKey) return;
    const next = fromSelectRef.current ?? toInputRef.current;
    if (!next) return;
    event.preventDefault();
    next.focus();
  };
  /**
   * Put the caret where the card asked for it, once there is something to
   * put it in.
   *
   * Keyed on the editor as well, so a draft loading — which remounts it —
   * is followed rather than lost. Cleared as soon as it lands, so nothing
   * here steals the focus back from the reader afterwards.
   */
  React.useEffect(() => {
    if (!caretGoesTo) return;
    if (caretGoesTo === "subject") {
      const el = subjectInputRef.current;
      if (!el) return;
      el.focus();
      setCaretGoesTo(null);
      return;
    }
    const editor = composeRef.current?.querySelector<HTMLElement>(".ql-editor");
    if (!editor) return;
    // Unless the reader got there first. The editor is a chunk of its own
    // and can arrive late; by then the caret may be somewhere they put it.
    const active = document.activeElement;
    if (active && active !== document.body && composeRef.current?.contains(active)) {
      setCaretGoesTo(null);
      return;
    }
    editor.focus();
    setCaretGoesTo(null);
  }, [caretGoesTo, editorKey]);
  const cardShellRef = React.useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = React.useState(720);
  const [cardH, setCardH] = React.useState<number | null>(null);
  /** Drag the card's right / bottom / corner edges to resize. */
  const startCardResize = React.useCallback(
    (edge: "e" | "s" | "se") => (event: React.PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const shell = cardShellRef.current;
      if (!shell) return;
      // Screen deltas ÷ zoom → pre-zoom layout sizes. Width uses ×2 because
      // the card is centered (mx-auto): each side moves half the width change.
      const z = zoom || 1;
      const startX = event.clientX;
      const startY = event.clientY;
      const startW = cardW;
      const startH =
        cardH ?? shell.getBoundingClientRect().height / z;
      const minW = 480;
      const minH = 360;
      const maxW = Math.max(
        minW,
        ((composeRef.current?.clientWidth ?? window.innerWidth) - 48) / z
      );
      const maxH = Math.max(
        minH,
        ((composeRef.current?.clientHeight ?? window.innerHeight) - 48) / z
      );

      document.body.style.cursor =
        edge === "e" ? "ew-resize" : edge === "s" ? "ns-resize" : "nwse-resize";
      document.body.style.userSelect = "none";

      const onMove = (e: PointerEvent) => {
        if (edge === "e" || edge === "se") {
          setCardW(
            Math.min(
              maxW,
              Math.max(minW, startW + (2 * (e.clientX - startX)) / z)
            )
          );
        }
        if (edge === "s" || edge === "se") {
          setCardH(
            Math.min(
              maxH,
              Math.max(minH, startH + (e.clientY - startY) / z)
            )
          );
        }
      };
      startPointerDrag(
        { handle: event.currentTarget as HTMLElement, pointerId: event.pointerId },
        { onMove }
      );
    },
    [zoom, cardW, cardH]
  );
  /**
   * The subject grows to a second line, and stops there.
   *
   * A long subject used to scroll sideways out of its own box, which hid
   * the end of the line the other person triages by. The box is a textarea
   * now, so the words wrap. Two lines is the limit, because more than two
   * pushes the message itself down the card.
   *
   * A subject too long for two lines is set smaller until it fits. The
   * whole line stays in sight that way. Below the minimum size the words
   * stop shrinking and the box scrolls, which only a very long subject
   * reaches.
   *
   * Re-measured on the card width, because a narrower card wraps earlier.
   */
  React.useLayoutEffect(() => {
    const el = subjectInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    let size = SUBJECT_MAX_PX;
    let line = 0;
    let full = 0;
    for (;;) {
      line = Math.round(size * SUBJECT_LINE_RATIO);
      el.style.fontSize = `${size}px`;
      el.style.lineHeight = `${line}px`;
      full = el.scrollHeight;
      if (full <= line * SUBJECT_MAX_LINES || size <= SUBJECT_MIN_PX) break;
      size -= 1;
    }
    const max = line * SUBJECT_MAX_LINES;
    el.style.height = `${Math.min(full, max)}px`;
    el.style.overflowY = full > max ? "auto" : "hidden";
  }, [subject, cardW]);

  return {
    accounts,
    addAttachFiles,
    aiReplyNotes,
    aiReplyWorking,
    attachDragging,
    attachDropHandlers,
    attachItems,
    attachPasteHandlers,
    bccList,
    body,
    bodyText,
    canOpenInOutlook,
    canSend,
    canSendLater,
    card,
    cardH,
    cardShellRef,
    cardW,
    ccInputRef,
    ccList,
    discardCompose,
    draftComposeWithAi,
    draftPreviewId,
    draftingReply,
    editorHandle,
    editorKey,
    flatCc,
    flatTo,
    floatCompose,
    floating,
    focusBody,
    focusMode,
    from,
    fromSelectRef,
    fromSettledRef,
    handingOver,
    hasRecipient,
    includeSignature,
    labelClass,
    onClose,
    onFloat,
    onSubjectKeyDown,
    onToggleFocus,
    onZoomAdjust,
    openInOutlook,
    outlookElsewhere,
    outlookTarget,
    rememberFrom,
    removeAttach,
    rowClass,
    send,
    sending,
    setAiReplyNotes,
    setBccList,
    setBody,
    setCcList,
    setComposeNode,
    setDraftPreviewId,
    setEditorKey,
    setFrom,
    setIncludeSignature,
    setRememberFrom,
    setShowBcc,
    setShowCc,
    setShowPreview,
    setSigDialogOpen,
    setSigSettings,
    setSubject,
    setToList,
    shortcuts,
    showBcc,
    showCc,
    showPreview,
    sigDialogOpen,
    sigSettings,
    sigTouchedRef,
    startCardResize,
    stopAiReply,
    subject,
    subjectInputRef,
    t,
    toInputRef,
    toList,
    zoom,
  };
}
