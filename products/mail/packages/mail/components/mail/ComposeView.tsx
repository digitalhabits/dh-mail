"use client";

/**
 * Writing a new message.
 *
 * A thread has its own reply box inside ThreadPane; this is the one that starts
 * something, so it owns the recipient fields and the subject as well as the
 * body. What the message will look like once sent is shown by
 * `composer-preview`, which the reply box shows too.
 *
 * This file draws the composer; use-compose-view.tsx holds its state. The
 * walks in mounted-new-mail-card and mounted-composer-send drive it.
 */

import { useRef, type RefObject } from "react";
import { formatShortcut } from "@/lib/mail/shortcuts";
import {
  ChevronDown,
  ExternalLink,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  SendHorizontal,
  Trash2,
} from "lucide-react";

import {
  SentPreview,
  SignatureMetaControls,
} from "@/components/mail/composer-preview";
import { EditableSignature } from "@/components/mail/editable-signature";
import {
  AttachToolbarButton,
  ComposerDropOverlay,
  DraftAttachmentChips,
} from "@/components/mail/draft-attachments";
import {
  DraftAttachmentPreviewDialog,
} from "@/components/mail/attachment-preview";
import { FromAccountMenu, SendAsAddress } from "@/components/mail/FromAccountMenu";
import { writeComposeFrom } from "@/lib/mail/compose-from";
import { RecipientCarryProvider, RecipientField } from "@/components/mail/RecipientField";
import { RecipientDropZone, withRecipient } from "@/components/mail/recipient-carry";
import { SendLaterMenu, sendButtonWord } from "@/components/mail/SendLaterMenu";
import { formatSnoozeWakeLabel } from "@/components/mail/SnoozeMenu";
import { DraftAssistMenu, DraftAssistNotes, useAccountAssist } from "@/components/mail/team-layer";
import { SignatureDialog } from "@/components/mail/SignatureDialog";
import { isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { ZoomTextSize } from "@/components/mail/ZoomControls";
import { ComposerToolbar } from "@/components/mail/ComposerToolbar";
import { textStyleVars, useTextStyleDefault } from "@/components/mail/use-text-style";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { Button } from "@/components/ui/button";
import { bodyToEmailHtml, plainTextToEditorHtml } from "@/lib/client-email-html";
import { mailHasTeamRecords } from "@/lib/mail/product-flavor";
import { cn } from "@/lib/utils";
import { FloatingCardChrome } from "@/components/mail/floating-card";
import { useComposeView, type ComposeViewProps } from "@/components/mail/use-compose-view";
import { useMailT } from "@/lib/mail/i18n";

export function ComposeView(props: ComposeViewProps) {
  const {
    accounts,
    addAttachFiles,
    draftNotes,
    draftWorking,
    attachDragging,
    attachDropHandlers,
    attachItems,
    attachPasteHandlers,
    bccList,
    body,
    bodyText,
    canOpenInOutlook,
    canSend,
    editingScheduled,
    armedSendAt,
    setArmedSendAt,
    canSendLater,
    card,
    cardH,
    cardShellRef,
    cardW,
    ccInputRef,
    ccList,
    discardCompose,
    discardChanges,
    deleteScheduled,
    keepAsDraft,
    draftComposeWithAssist,
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
    setDraftNotes,
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
    setSignatureHtml,
    setSubject,
    setToList,
    shortcuts,
    showBcc,
    showCc,
    showPreview,
    sigDialogOpen,
    sigSettings,
    sigTouchedRef,
    signatureHtml,
    startCardResize,
    stopDraft,
    subject,
    subjectInputRef,
    t,
    toInputRef,
    toList,
    zoom,
  } = useComposeView(props);
  /*
    Cc and Bcc were clicked to add somebody, so the new box takes the
    cursor, once it is drawn on the next frame.
  */
  const bccInputRef = useRef<HTMLInputElement | null>(null);
  const focusSoon = (ref: RefObject<HTMLInputElement | null>) =>
    requestAnimationFrame(() => requestAnimationFrame(() => ref.current?.focus()));
  const textDefaults = useTextStyleDefault(from);

  return (
    <div
      ref={setComposeNode}
      /* The size it was dragged to — one for the corner, one for the
         dialog. Put away, neither: that one is its heading, and as wide
         as a heading needs. */
      style={card.style}
      className={cn(
        "mail-thread-surface relative bg-[var(--mail-thread)]",
        floating
          ? // The card, in the same corner and the same frame as the
            // reply's card, so the two are the same thing.
            "mail-floating-reply flex flex-col overflow-hidden rounded-surface border border-stone-300 shadow-2xl"
          : "min-h-0 flex-1 overflow-y-auto",
        card.className,
        // A height of its own, not one the message grows: the message
        // scrolls inside it. Only in the corner — put away the card is its
        // heading, and full it is the window. A height the reader dragged
        // is an inline style, so it wins over this.
        card.floating && card.view === "normal" && "h-[32rem]"
      )}
    >
      {/*
        The dimmed page, the edges that size the card, and the heading with
        its buttons — the frame both floating cards stand in. The subject
        is written inside the card, on the row it belongs to, so the
        heading only names the message.
      */}
      {/* No button back to the pane. Close puts the card away and the
          draft stays in the one new-message slot, so the two buttons did
          the same thing and differed only in what the reader looked at
          afterwards — which the reply card dropped its own such button
          over. The key still does it: see the shortcut below. */}
      <FloatingCardChrome
        card={card}
        title={subject.trim() || t("newEmail")}
        onClose={onClose}
      />
      {/* Half the padding above, full below. The zoom pill is in the
          flow, not over the card. If the card keeps its own margin above,
          that space sits above the pill and pushes the card down the
          pane. */}
      <div
        className={cn(
          floating
            ? "flex min-h-0 flex-1 flex-col p-0"
            : "px-8 pb-8 pt-4",
          // Put away, the card shows none of what it holds: the heading is
          // all there is, on the bottom edge.
          card.minimised && "hidden"
        )}
      >
        {/* The zoom sits above the card, not on its top right corner.
            Floated over the corner it covered the end of the subject, and
            the subject is now two lines deep. Here it lines up with the
            card's right edge, ten pixels clear of it.

            Outside the card, so the preview keeps it: the preview is
            drawn at the same zoom and replaces the card below.

            `cardW * zoom` for the width, the same as the signature row
            under the card — the card is drawn at the composer's text size
            and this row is not. */}
        {floating ? null : (
          /* The band above the card, from the pane's top edge to the card,
             answers a double click the way the reader's toolbar strip
             does: the composer takes the whole pane, or gives the list
             back. The subject row does the same, but the subject is a box
             that takes the click itself, so its margins were all that was
             left of it; this band is the open ground. Not on the zoom
             buttons: two presses of one of those is already an answer. */
          <div
            className="-mx-8 -mt-4 mb-2.5 select-none px-8 pt-4"
            /* The second press of a double click starts the browser's own
               word selection, and on open ground with no word under it
               the selection reached the nearest text: the subject came
               up selected. Refusing the press's default stops that and
               leaves the click itself alone. */
            onMouseDown={(e) => {
              if (e.detail > 1 && !isInteractiveDoubleClickTarget(e.target)) {
                e.preventDefault();
              }
            }}
            onDoubleClick={(e) => {
              if (isInteractiveDoubleClickTarget(e.target)) return;
              onToggleFocus?.();
            }}
          >
            <div
              className="mx-auto flex justify-end"
              style={{ width: cardW * zoom, maxWidth: "100%" }}
            >
              <ZoomTextSize zoom={zoom} onAdjust={onZoomAdjust} />
            </div>
          </div>
        )}
        {/* Hidden (not unmounted) during preview so the draft is kept. */}
        <div
          className={cn(
            showPreview ? "hidden" : undefined,
            floating && "flex min-h-0 flex-1 flex-col"
          )}
        >
          <div
            ref={cardShellRef}
            className={cn(
              // The card is app chrome and goes dark with the rest of it.
              // Only the sheet you write on stays white — see the body
              // below. If the whole card is the light island, the dark
              // theme puts a white page the size of the window in front of
              // somebody who asked for no white pages.
              "mail-composer-card relative mx-auto flex min-h-0 flex-col rounded-surface border border-stone-200 bg-white shadow-sm",
              (floating || cardH != null) && "overflow-hidden",
              // In the corner the card is the card: it takes the room it is
              // given and the message scrolls inside it, which is the same
              // arrangement a dragged height already uses.
              floating && "flex-1 rounded-none border-0 shadow-none"
            )}
            style={
              floating
                ? { width: "100%", maxWidth: "100%", zoom }
                : {
                    width: cardW,
                    height: cardH ?? undefined,
                    maxWidth: "100%",
                    zoom,
                  }
            }
            {...attachDropHandlers}
            {...attachPasteHandlers}
          >
            <ComposerDropOverlay visible={attachDragging} />
            {editingScheduled ? <EditingScheduledHeading original={editingScheduled} armed={armedSendAt} t={t} /> : null}
            <ComposeHeader floatCompose={floatCompose} floating={floating} focusMode={focusMode} onFloat={onFloat} onSubjectKeyDown={onSubjectKeyDown} onToggleFocus={onToggleFocus} setSubject={setSubject} shortcuts={shortcuts} subject={subject} subjectInputRef={subjectInputRef} t={t} />

            <div className={rowClass}>
              <span className={labelClass}>{t("fieldFrom")}</span>
              {accounts.length > 1 ? (
                <FromAccountMenu
                  ref={fromSelectRef}
                  variant="row"
                  value={from}
                  accounts={accounts}
                  onChange={(account) => {
                    setFrom(account);
                    fromSettledRef.current = true;
                    if (rememberFrom) writeComposeFrom(account);
                  }}
                  label={t("fieldFrom")}
                  remember={{
                    checked: rememberFrom,
                    onChange: setRememberFrom,
                    label: t("rememberFromForNewMessages"),
                  }}
                />
              ) : (
                <span className="text-stone-800">
                  <SendAsAddress account={from} />
                </span>
              )}
            </div>

            <ComposeRecipients accounts={accounts} bccInputRef={bccInputRef} bccList={bccList} ccInputRef={ccInputRef} ccList={ccList} focusBody={focusBody} focusSoon={focusSoon} from={from} labelClass={labelClass} rowClass={rowClass} setBccList={setBccList} setCcList={setCcList} setShowBcc={setShowBcc} setShowCc={setShowCc} setToList={setToList} showBcc={showBcc} showCc={showCc} t={t} toInputRef={toInputRef} toList={toList} />
            {/* Where the words go. No light island: a message is shown in
                the thread on a dark bubble now, so writing it on a white one
                would be the odd half of the pair. */}
            <div
              className={cn(
                "min-h-0",
                floating || cardH != null
                  ? "flex flex-1 flex-col overflow-y-auto"
                  : undefined
              )}
            >
              {draftNotes || draftWorking ? (
                <DraftAssistNotes
                  purpose="compose"
                  result={draftNotes}
                  working={draftWorking}
                  onStop={stopDraft}
                  onRestoreBrief={(brief) => {
                    setBody(plainTextToEditorHtml(brief));
                    setEditorKey((k) => k + 1);
                    setDraftNotes(null);
                  }}
                  onDismiss={() => setDraftNotes(null)}
                />
              ) : null}
              {/* The box writes in the account's default font and size,
                  which mail.css reads from these. */}
              <div className="contents" style={textStyleVars(textDefaults)}>
              <RichTextEditor
                key={editorKey}
                className="mail-message-editor"
                toolbarId="mail-compose-toolbar"
                handleRef={editorHandle}
                defaultValue={body}
                onChange={setBody}
                placeholder={t("writeYourMessage")}
                /* Enough to write in, not so much that the signature sits a
                   screen below the first line. The box grows with the words,
                   and the panel scrolls once it outgrows the window. */
                minHeight={120}
              />
              </div>
              {includeSignature && sigSettings?.signature ? (
                <EditableSignature
                  saved={sigSettings.signature}
                  copy={signatureHtml}
                  onChange={setSignatureHtml}
                  editorKey={editorKey}
                  bodyHandle={editorHandle}
                />
              ) : null}
            </div>

            <ComposeFoot addAttachFiles={addAttachFiles} armedSendAt={armedSendAt} attachItems={attachItems} bodyText={bodyText} canOpenInOutlook={canOpenInOutlook} canSend={canSend} canSendLater={canSendLater} deleteScheduled={deleteScheduled} discardChanges={discardChanges} discardCompose={discardCompose} editing={Boolean(editingScheduled)} keepAsDraft={keepAsDraft} editorHandle={editorHandle} from={from} handingOver={handingOver} hasRecipient={hasRecipient} openInOutlook={openInOutlook} outlookElsewhere={outlookElsewhere} outlookTarget={outlookTarget} removeAttach={removeAttach} send={send} sending={sending} setArmedSendAt={setArmedSendAt} setDraftPreviewId={setDraftPreviewId} setShowPreview={setShowPreview} shortcuts={shortcuts} t={t} />
          {/* Edge / corner handles for resizing the card. None in the
              corner: the card is the size of the card, and a handle that
              cannot move reads as broken. */}
          {floating ? null : <CardResizeHandles start={startCardResize} />}
          </div>
          {/* Under the box, outside the card — where a reply keeps them.
              A signature to write is about the message, not about typing
              it. Preview and Outlook sit on the Send chevron. */}
          <ComposeMetaRow
            width={cardW * zoom}
            account={from}
            signature={sigSettings?.signature}
            includeSignature={includeSignature}
            onAddSignature={() => {
              sigTouchedRef.current = true;
              if (sigSettings?.signature) setIncludeSignature(true);
              else setSigDialogOpen(true);
            }}
            onEditSignature={() => setSigDialogOpen(true)}
            onRemoveSignature={() => {
              sigTouchedRef.current = true;
              setIncludeSignature(false);
            }}
            drafting={draftingReply}
            sending={sending}
            onDraft={(hint) => void draftComposeWithAssist(hint)}
            onStopDraft={stopDraft}
          />
        </div>

        {showPreview ? (
          <SentPreview
            from={from}
            to={flatTo.emails}
            cc={flatCc.emails}
            subject={subject.trim()}
            bodyHtml={bodyToEmailHtml(body)}
            hasBody={Boolean(bodyText.trim())}
            includeSignature={Boolean(
              includeSignature && sigSettings?.signature
            )}
            signatureCopy={signatureHtml}
            zoom={zoom}
            recipientName={
              toList[0]?.kind === "list"
                ? toList[0].name
                : toList[0]?.kind === "email"
                  ? toList[0].name || toList[0].email
                  : "the recipient"
            }
            sending={sending}
            canSend={canSend}
            onSend={() => void send()}
            onBack={() => setShowPreview(false)}
          />
        ) : null}

        <DraftAttachmentPreviewDialog
          items={attachItems}
          previewId={draftPreviewId}
          onSelect={setDraftPreviewId}
          onClose={() => setDraftPreviewId(null)}
        />

        <SignatureDialog
          open={sigDialogOpen}
          accounts={accounts}
          initialAccount={from}
          onClose={() => setSigDialogOpen(false)}
          onSaved={(savedAccount, settings) => {
            if (savedAccount === from) setSigSettings(settings);
          }}
        />
      </div>
    </div>
  );
}

/** The composer's head: its title, and the buttons to float, focus and close it. */
function ComposeHeader({
  floatCompose,
  floating,
  focusMode,
  onFloat,
  onSubjectKeyDown,
  onToggleFocus,
  setSubject,
  shortcuts,
  subject,
  subjectInputRef,
  t,
}: {
  floatCompose: ReturnType<typeof useComposeView>["floatCompose"];
  floating: ReturnType<typeof useComposeView>["floating"];
  focusMode: ReturnType<typeof useComposeView>["focusMode"];
  onFloat: ReturnType<typeof useComposeView>["onFloat"];
  onSubjectKeyDown: ReturnType<typeof useComposeView>["onSubjectKeyDown"];
  onToggleFocus: ReturnType<typeof useComposeView>["onToggleFocus"];
  setSubject: ReturnType<typeof useComposeView>["setSubject"];
  shortcuts: ReturnType<typeof useComposeView>["shortcuts"];
  subject: ReturnType<typeof useComposeView>["subject"];
  subjectInputRef: ReturnType<typeof useComposeView>["subjectInputRef"];
  t: ReturnType<typeof useComposeView>["t"];
}) {
  return (
    <div
              className="flex shrink-0 items-center gap-3 border-b border-stone-200 px-5 py-3.5"
              onDoubleClick={(e) => {
                if (isInteractiveDoubleClickTarget(e.target)) return;
                onToggleFocus?.();
              }}
            >
              {/* The heading is the subject. Not a heading *and* a Subject
                  row lower down: that was one line of text written into a
                  small box and then echoed in large type above it, and the
                  echo was the part that looked like the real thing.
                  The subject is the one line the other person triages by,
                  so it gets the size — and typing it is typing here. */}
              <textarea
                ref={subjectInputRef}
                rows={1}
                value={subject}
                // Pasted mail headers carry line breaks. The subject is one
                // line, so a break becomes a space.
                onChange={(e) =>
                  setSubject(e.target.value.replace(/[\r\n]+/g, " "))
                }
                placeholder={t("subject")}
                aria-label={t("subject")}
                onKeyDown={onSubjectKeyDown}
                className={cn(
                  "min-w-0 flex-1 resize-none bg-transparent font-serif text-2xl font-bold leading-8 text-stone-900 outline-none",
                  // Grey until there are words, which is the placeholder
                  // saying what the line is for rather than a title saying
                  // the message has one.
                  "placeholder:font-bold placeholder:text-stone-400",
                  // A rule only under the pointer or the caret. Always drawn,
                  // it would make the top of the card look like another form
                  // row, which is the thing this replaced.
                  "border-b border-dashed border-transparent hover:border-stone-300 focus:border-stone-300"
                )}
              />
              {onFloat && !floating ? (
                <button
                  type="button"
                  title={`${t("writeWhileYouBrowse")} (${formatShortcut(
                    shortcuts.floatMessage
                  )})`}
                  aria-label={`${t("writeWhileYouBrowse")} (${formatShortcut(
                    shortcuts.floatMessage
                  )})`}
                  className="shrink-0 rounded-inner p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                  onClick={floatCompose}
                >
                  <PictureInPicture2 className="h-4 w-4" />
                </button>
              ) : null}
              {/* In the card these two stand in the heading above, beside
                  the three the frame gives every card. Here the row holds
                  only what the pane needs. */}
              {floating ? null : onToggleFocus ? (
                <button
                  type="button"
                  title={`${focusMode ? t("showMailList") : t("focusMode")} (${formatShortcut(
                    shortcuts.focusMessage
                  )})`}
                  aria-label={`${focusMode ? t("showMailList") : t("focusMode")} (${formatShortcut(
                    shortcuts.focusMessage
                  )})`}
                  aria-pressed={focusMode}
                  className="shrink-0 rounded-inner p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                  onClick={onToggleFocus}
                >
                  {focusMode ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </button>
              ) : null}
            </div>
  );
}

/**
 * At the top of the card while a scheduled message is edited (2026-10-31):
 * what is being edited, and that nothing changes until Send is pressed. It
 * follows the time on Send, which the menu can change.
 */
function EditingScheduledHeading({
  original,
  armed,
  t,
}: {
  original: { sendAt: string };
  armed: string | null;
  t: ReturnType<typeof useComposeView>["t"];
}) {
  const button = sendButtonWord(t, { sending: false, armed });
  const when = formatSnoozeWakeLabel(original.sendAt);
  const missed = Date.parse(original.sendAt) <= Date.now();
  return (
    <div className="rounded-t-[inherit] border-b border-stone-200 bg-[var(--mail-bubble-own)] px-6 py-3">
      <p className="text-[15px] font-semibold text-stone-900">{t("editingScheduledTitle")}</p>
      <p className="text-sm text-stone-600">
        {t(missed ? "editingScheduledMissed" : "editingScheduledUntil", { button, when })}
      </p>
    </div>
  );
}

/** The From, To, Cc and Bcc rows, and the subject. */
function ComposeRecipients({
  accounts,
  bccInputRef,
  bccList,
  ccInputRef,
  ccList,
  focusBody,
  focusSoon,
  from,
  labelClass,
  rowClass,
  setBccList,
  setCcList,
  setShowBcc,
  setShowCc,
  setToList,
  showBcc,
  showCc,
  t,
  toInputRef,
  toList,
}: {
  accounts: ReturnType<typeof useComposeView>["accounts"];
  bccInputRef: RefObject<HTMLInputElement | null>;
  bccList: ReturnType<typeof useComposeView>["bccList"];
  ccInputRef: ReturnType<typeof useComposeView>["ccInputRef"];
  ccList: ReturnType<typeof useComposeView>["ccList"];
  focusBody: ReturnType<typeof useComposeView>["focusBody"];
  focusSoon: (ref: RefObject<HTMLInputElement | null>) => number;
  from: ReturnType<typeof useComposeView>["from"];
  labelClass: ReturnType<typeof useComposeView>["labelClass"];
  rowClass: ReturnType<typeof useComposeView>["rowClass"];
  setBccList: ReturnType<typeof useComposeView>["setBccList"];
  setCcList: ReturnType<typeof useComposeView>["setCcList"];
  setShowBcc: ReturnType<typeof useComposeView>["setShowBcc"];
  setShowCc: ReturnType<typeof useComposeView>["setShowCc"];
  setToList: ReturnType<typeof useComposeView>["setToList"];
  showBcc: ReturnType<typeof useComposeView>["showBcc"];
  showCc: ReturnType<typeof useComposeView>["showCc"];
  t: ReturnType<typeof useComposeView>["t"];
  toInputRef: ReturnType<typeof useComposeView>["toInputRef"];
  toList: ReturnType<typeof useComposeView>["toList"];
}) {
  return (
    <RecipientCarryProvider>
              <div className={rowClass}>
                <span className={labelClass}>{t("fieldTo")}</span>
                <RecipientField
                  inputRef={toInputRef}
                  label={t("fieldTo")}
                  variant="inline"
                  values={toList}
                  onChange={setToList}
                  allowSaveList
                  // A long list folds down to this while nobody is editing it,
                  // so the message keeps the window rather than the addresses.
                  collapseAfter={6}
                  ownAccounts={accounts}
                  directoryAccount={from}
                  placeholder={t("startTypingName")}
                  onTabOut={() =>
                    showCc ? ccInputRef.current?.focus() : focusBody()
                  }
                  actions={
                    <span className="flex items-center gap-2.5 text-[15px] text-stone-500">
                      {!showCc ? (
                        <RecipientDropZone
                          onDropRecipient={(r) => {
                            setShowCc(true);
                            setCcList(withRecipient(ccList, r));
                          }}
                        >
                          <button
                            type="button"
                            className="underline-offset-2 hover:text-stone-800 hover:underline"
                            onClick={() => {
                              setShowCc(true);
                              focusSoon(ccInputRef);
                            }}
                          >
                            Cc
                          </button>
                        </RecipientDropZone>
                      ) : null}
                      {!showBcc ? (
                        <RecipientDropZone
                          onDropRecipient={(r) => {
                            setShowBcc(true);
                            setBccList(withRecipient(bccList, r));
                          }}
                        >
                          <button
                            type="button"
                            className="underline-offset-2 hover:text-stone-800 hover:underline"
                            onClick={() => {
                              setShowBcc(true);
                              focusSoon(bccInputRef);
                            }}
                          >
                            {t("fieldBcc")}
                          </button>
                        </RecipientDropZone>
                      ) : null}
                    </span>
                  }
                />
              </div>
              {showCc ? (
                <div className={rowClass}>
                  <span className={labelClass}>{t("fieldCc")}</span>
                  <RecipientField
                    inputRef={ccInputRef}
                    label={t("fieldCc")}
                    variant="inline"
                    values={ccList}
                    onChange={setCcList}
                    collapseAfter={6}
                    ownAccounts={accounts}
                  directoryAccount={from}
                    placeholder={t("optional")}
                  />
                </div>
              ) : null}
              {showBcc ? (
                <div className={rowClass}>
                  <span className={labelClass}>{t("fieldBcc")}</span>
                  <RecipientField
                    inputRef={bccInputRef}
                    label={t("fieldBcc")}
                    variant="inline"
                    values={bccList}
                    onChange={setBccList}
                    collapseAfter={6}
                    ownAccounts={accounts}
                  directoryAccount={from}
                    placeholder={t("optional")}
                  />
                </div>
              ) : null}
            </RecipientCarryProvider>
  );
}

/** The composer's foot: the files, Send and its menu, and the tools. */
function ComposeFoot({
  addAttachFiles,
  armedSendAt,
  attachItems,
  bodyText,
  canOpenInOutlook,
  canSend,
  canSendLater,
  deleteScheduled,
  discardChanges,
  discardCompose,
  editing,
  keepAsDraft,
  editorHandle,
  from,
  handingOver,
  hasRecipient,
  openInOutlook,
  outlookElsewhere,
  outlookTarget,
  removeAttach,
  send,
  sending,
  setArmedSendAt,
  setDraftPreviewId,
  setShowPreview,
  shortcuts,
  t,
}: {
  addAttachFiles: ReturnType<typeof useComposeView>["addAttachFiles"];
  armedSendAt: ReturnType<typeof useComposeView>["armedSendAt"];
  attachItems: ReturnType<typeof useComposeView>["attachItems"];
  bodyText: ReturnType<typeof useComposeView>["bodyText"];
  canOpenInOutlook: ReturnType<typeof useComposeView>["canOpenInOutlook"];
  canSend: ReturnType<typeof useComposeView>["canSend"];
  canSendLater: ReturnType<typeof useComposeView>["canSendLater"];
  deleteScheduled: ReturnType<typeof useComposeView>["deleteScheduled"];
  discardChanges: ReturnType<typeof useComposeView>["discardChanges"];
  discardCompose: ReturnType<typeof useComposeView>["discardCompose"];
  /** Editing a scheduled message (2026-10-31). */
  editing: boolean;
  keepAsDraft: ReturnType<typeof useComposeView>["keepAsDraft"];
  editorHandle: ReturnType<typeof useComposeView>["editorHandle"];
  from: ReturnType<typeof useComposeView>["from"];
  handingOver: ReturnType<typeof useComposeView>["handingOver"];
  hasRecipient: ReturnType<typeof useComposeView>["hasRecipient"];
  openInOutlook: ReturnType<typeof useComposeView>["openInOutlook"];
  outlookElsewhere: ReturnType<typeof useComposeView>["outlookElsewhere"];
  outlookTarget: ReturnType<typeof useComposeView>["outlookTarget"];
  removeAttach: ReturnType<typeof useComposeView>["removeAttach"];
  send: ReturnType<typeof useComposeView>["send"];
  sending: ReturnType<typeof useComposeView>["sending"];
  setArmedSendAt: ReturnType<typeof useComposeView>["setArmedSendAt"];
  setDraftPreviewId: ReturnType<typeof useComposeView>["setDraftPreviewId"];
  setShowPreview: ReturnType<typeof useComposeView>["setShowPreview"];
  shortcuts: ReturnType<typeof useComposeView>["shortcuts"];
  t: ReturnType<typeof useComposeView>["t"];
}) {
  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-stone-200 px-4 py-3">
              {/* The files, docked here above Send, as in the reply box. */}
              <DraftAttachmentChips
                docked
                className="pb-1"
                items={attachItems}
                onRemove={removeAttach}
                onPreview={setDraftPreviewId}
              />
              <div className="flex flex-wrap items-center gap-3">
                {/* One control: Send, and a section that says when. */}
                <div className="inline-flex items-stretch overflow-hidden rounded-control">
                  <Button
                    type="button"
                    className="h-9 rounded-none bg-teal-600 pl-3 pr-2 text-[15px] font-semibold text-white hover:bg-teal-700"
                    /* Named with its key, the way the thread's own actions
                       are. The button says Send; the tooltip says there is
                       a way to do it without reaching for the button. */
                    title={`Send (${formatShortcut(shortcuts.send)})`}
                    disabled={!canSend}
                    data-send-main=""
                    onClick={() => void send()}
                  >
                    {/* Before the word, pointing the way out. Under the
                        16px the button gives its icons — see the reply
                        box, which explains the `!`. */}
                    <SendHorizontal aria-hidden className="!size-3.5" />
                    {sendButtonWord(t, { sending, armed: armedSendAt })}
                  </Button>
                  <SendLaterMenu
                    account={from}
                    armed={armedSendAt}
                    onArm={setArmedSendAt}
                    schedule={canSendLater}
                    onPick={(iso) => void send(iso)}
                    editing={editing}
                    onKeepAsDraft={editing ? keepAsDraft : undefined}
                    extras={[
                      {
                        id: "preview",
                        label: t("previewFirst"),
                        onSelect: () => setShowPreview(true),
                      },
                      ...(canOpenInOutlook
                        ? [
                            {
                              id: "outlook",
                              label: t("openInOutlookInstead"),
                              icon: <ExternalLink aria-hidden />,
                              title: outlookElsewhere
                                ? t("openInOutlookFrom", {
                                    account: outlookTarget,
                                  })
                                : undefined,
                              disabled:
                                sending ||
                                handingOver ||
                                !hasRecipient ||
                                !bodyText.trim(),
                              onSelect: () => void openInOutlook(),
                            },
                          ]
                        : []),
                    ]}
                    trigger={
                      <button
                        type="button"
                        aria-label={t("sendOptions")}
                        title={t("sendOptions")}
                        className="flex h-9 items-center border-l border-white/25 bg-teal-600 pl-1.5 pr-2 text-white hover:bg-teal-700 disabled:opacity-50"
                      >
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      </button>
                    }
                  />
                </div>
                {editing ? (
                  // The edits go; the scheduled message goes on as it was.
                  <button
                    type="button"
                    className="rounded-control px-2 py-1.5 text-sm font-semibold text-stone-700 hover:bg-stone-100"
                    onClick={discardChanges}
                  >
                    {t("discardChanges")}
                  </button>
                ) : null}
                <ComposerToolbar id="mail-compose-toolbar" editorHandle={editorHandle} account={from} />
                <AttachToolbarButton
                  onPick={addAttachFiles}
                  disabled={sending}
                />
                {/* No size line here: the chips above the row already name
                    every file, and the row said the same thing twice. The
                    bin ends the row, level with the formatting buttons. */}
                <span className="ml-auto flex items-center gap-3">
                  <button
                    type="button"
                    // Editing a scheduled message, the bin deletes it: it
                    // will not be sent. Discard changes drops the edits alone.
                    title={t(editing ? "deleteScheduledEmail" : "discard")}
                    aria-label={t(editing ? "deleteScheduledEmail" : "discard")}
                    className="mail-composer-discard rounded p-1 text-stone-400"
                    onClick={editing ? deleteScheduled : discardCompose}
                  >
                    <Trash2 className="h-5 w-5" />
                  </button>
                </span>
              </div>
            </div>
  );
}


/**
 * The handles on the card's right edge, bottom edge and corner, which
 * resize it. Shown only when the card is not floating (see the caller).
 */
function CardResizeHandles({
  start,
}: {
  start: (edge: "e" | "s" | "se") => (event: React.PointerEvent) => void;
}) {
  const t = useMailT();
  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("resizeWidth")}
        title={t("dragToResizeWidth")}
        onPointerDown={start("e")}
        className="absolute -right-1 top-3 bottom-3 z-10 w-2 cursor-ew-resize touch-none rounded-full hover:bg-stone-300/50"
      />
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("resizeHeight")}
        title={t("dragToResizeHeight")}
        onPointerDown={start("s")}
        className="absolute -bottom-1 left-3 right-3 z-10 h-2 cursor-ns-resize touch-none rounded-full hover:bg-stone-300/50"
      />
      <div
        role="separator"
        aria-label={t("resizeWidthAndHeight")}
        title={t("dragToResize")}
        onPointerDown={start("se")}
        className="absolute bottom-0 right-0 z-10 h-4 w-4 cursor-nwse-resize touch-none"
      />
    </>
  );
}

/** The row under the card: the signature, and a build's own draft menu. */
function ComposeMetaRow({
  width,
  account,
  signature,
  includeSignature,
  onAddSignature,
  onEditSignature,
  onRemoveSignature,
  drafting,
  sending,
  onDraft,
  onStopDraft,
}: {
  width: number;
  account: string;
  signature: string | undefined;
  includeSignature: boolean;
  onAddSignature: () => void;
  onEditSignature: () => void;
  onRemoveSignature: () => void;
  drafting: boolean;
  sending: boolean;
  onDraft: (hint: string) => void;
  onStopDraft: () => void;
}) {
  // Off for a mailbox whose owner keeps it private (Settings → Accounts).
  const assistOn = useAccountAssist(account);
  return (
    <div
      className="mx-auto mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5"
      /*
        The same width as the card, so the row starts where the card
        starts. The card is centred and resizable, and the row was
        the full width of the pane under it — which put "Signature:"
        out at the left edge of the window with the card's own edge
        a couple of hundred pixels to the right of it.

        `cardW * zoom` rather than the card's own width and zoom: the
        card is drawn at the composer's text size and this row is not,
        the same way the reply's row is outside its card's zoom.
      */
      style={{ width, maxWidth: "100%" }}
    >
      <SignatureMetaControls
        account={account}
        configured={Boolean(signature)}
        included={includeSignature}
        onAdd={onAddSignature}
        onEdit={onEditSignature}
        onRemove={onRemoveSignature}
      />
      {mailHasTeamRecords() && assistOn ? (
        <DraftAssistMenu
          className="ml-auto"
          purpose="compose"
          drafting={drafting}
          disabled={sending}
          onDraft={onDraft}
          onStop={onStopDraft}
        />
      ) : null}
      {/*
        No chat-style box here.

        It said "does not quote the history", and a message that
        starts a thread has no history to quote — so on this one
        screen the words meant nothing. What it did was bind the new
        thread as a chat, so that later replies would not quote; that
        choice still exists, on the first reply, where "Quote
        history" is a question about something real. See ThreadPane.
      */}
    </div>
  );
}
