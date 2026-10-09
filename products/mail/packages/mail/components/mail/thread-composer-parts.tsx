"use client";

/*
 * Parts of the composer band's markup (ThreadComposerBand), moved out of
 * thread-pane-composer.tsx.
 *
 * Each component takes the pane's model (`m`, from useThreadPane) and reads the
 * names it needs from it; the band's own values come in as props. The JSX
 * is the band's own, word for word.
 */

import { forwardSizeWarning } from "@/lib/mail/forward-size";
import { useSenderProvider } from "@/lib/mail/use-outlook-accounts";
import { Check, Maximize2, Minimize2, PictureInPicture2 } from "lucide-react";

import { DraftAssistMenu } from "@/components/mail/team-layer";
import { FromAccountMenu } from "@/components/mail/FromAccountMenu";
import { forwardPayload } from "@/components/mail/forward-payload";
import { SentPreview, SignatureMetaControls } from "@/components/mail/composer-preview";
import { formatShortcut } from "@/lib/mail/shortcuts";
import { isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { bodyToEmailHtml } from "@/lib/client-email-html";
import { emailsOfRecipients } from "@/lib/mail/contact-list-types";
import { RecipientSummary } from "@/components/mail/AddressMenu";
import { mailHasTeamRecords } from "@/lib/mail/product-flavor";
import { cn } from "@/lib/utils";
import type { ThreadPaneModel } from "@/components/mail/use-thread-pane";

/** The preview of the message as it will go, in place of the box while it is shown. */
export function ComposerPreview({
  m,
  chatStyle,
}: {
  m: ThreadPaneModel;
  chatStyle: boolean;
}) {
  const {
    attachItems,
    attachmentsReady,
    ccList,
    forwarding,
    fromAccount,
    historyAppendix,
    includeSignature,
    outgoingSubject,
    quoteMessageId,
    quotePayload,
    recipientName,
    reply,
    replyText,
    send,
    sendForward,
    senderName,
    sending,
    setShowPreview,
    showPreview,
    sigSettings,
    t,
    toList,
    zoom,
  } = m;
  // The forward as it will go: the message and the conversation before it.
  const forwarded =
    showPreview && forwarding && m.forwardSource && m.thread
      ? forwardPayload({ source: m.forwardSource, thread: m.thread, olderParts: m.olderParts })
      : null;
  return (
    <>
      {showPreview ? (
        <SentPreview
          fromName={senderName}
          from={fromAccount}
          to={emailsOfRecipients(toList)}
          cc={emailsOfRecipients(ccList)}
          subject={outgoingSubject}
          bodyHtml={bodyToEmailHtml(reply)}
          hasBody={Boolean(replyText.trim())}
          includeSignature={Boolean(
            includeSignature && sigSettings?.signature
          )}
          zoom={zoom}
          /* The preview is the mail as it will land, so a reply that
             quotes nothing previews with nothing quoted. This used to
             be handled by the preview not being reachable at all with
             the history left out. */
          /* The preview is the mail as it will land. A forwarded
             conversation and a rebuilt tail carry their attributions
             inside themselves, so those pass no intro line; the one
             remaining single-message case is a reply to a picked
             message, which still introduces itself the old way. */
          quote={
            forwarding
              ? forwarded
                ? {
                    intro: `Forwarded message — from ${
                      forwarded.fromName ? `${forwarded.fromName} <${forwarded.fromEmail}>` : forwarded.fromEmail
                    }, ${forwarded.date}:`,
                    text: forwarded.text,
                    html: forwarded.html,
                  }
                : undefined
              : chatStyle
                ? undefined
                : quoteMessageId && quotePayload
                  ? {
                      intro: `On ${quotePayload.date}, ${
                        quotePayload.fromName
                          ? `${quotePayload.fromName} <${quotePayload.fromEmail}>`
                          : quotePayload.fromEmail
                      } wrote:`,
                      text: quotePayload.text,
                      html: quotePayload.html,
                    }
                  : historyAppendix
                    ? {
                        text: historyAppendix.text,
                        html: historyAppendix.html,
                      }
                    : undefined
          }
          recipientName={recipientName}
          sending={sending}
          canSend={Boolean(
            emailsOfRecipients(toList).length &&
              attachmentsReady &&
              (forwarding || replyText.trim() || attachItems.length)
          )}
          sendLabel={t(forwarding ? "actionForward" : "send")}
          onSend={() => void (forwarding ? sendForward() : send())}
          onBack={() => setShowPreview(false)}
        />
      ) : null}
    </>
  );
}

/** The row under the box: send, send later, files, and the other tools of the message. */
export function ComposerFooter({
  m,
  chatStyle,
}: {
  m: ThreadPaneModel;
  chatStyle: boolean;
}) {
  const {
    attachTotalBytes,
    chatStyleBusy,
    composerSnapshotRef,
    draftReplyWithAssist,
    draftingReply,
    floatReply,
    floating,
    forwardFiles,
    forwardFilesBusy,
    forwardSource,
    forwarding,
    fromAccount,
    includeSignature,
    mode,
    onFloatReply,
    replySubject,
    sending,
    setChatStyle,
    setForwardIncludeFiles,
    setIncludeSignature,
    setSigDialogOpen,
    setSubjectDraft,
    setSubjectOpen,
    sigSettings,
    stopDraft,
    subjectOpen,
    t,
  } = m;
  const sizeWarning = forwardSizeWarning(useSenderProvider(fromAccount), attachTotalBytes);
  return (
    <>
      {/* Under the box, outside the card.
          Facts about the message, not the writing of it. Preview,
          Outlook and a build's own actions sit on the Send chevron. */}
      <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <SignatureMetaControls
          account={fromAccount}
          configured={Boolean(sigSettings?.signature)}
          included={includeSignature}
          onAdd={() => {
            if (sigSettings?.signature) setIncludeSignature(true);
            else setSigDialogOpen(true);
          }}
          onEdit={() => setSigDialogOpen(true)}
          onRemove={() => setIncludeSignature(false)}
        />
        {/* A reply under a subject that no longer fits.
            The conversation stays whole — same thread, same quoted
            history — and only the name of it changes. Offered rather
            than shown, because on most replies the subject is not a
            question worth putting a field in front of somebody for.
            A forward's row is always up, so it needs no way in. */}
        {!forwarding && !subjectOpen ? (
          <button
            type="button"
            title={t("changeSubjectHint")}
            className="text-xs text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
            onClick={() => {
              setSubjectDraft(replySubject);
              setSubjectOpen(true);
              /*
                And out of the thread, into the card in the corner.

                The message is about to stop being part of the
                conversation it is written under, and that is worth
                seeing at the moment it is asked for rather than in
                somebody else's inbox afterwards. Gmail says the same
                thing by popping the reply out.

                The card passes its own snapshot: the subject was set
                a line ago and is not in the rendered one yet. Already
                in the card, or on a phone that has no card, the row
                simply opens.
              */
              if (!floating && onFloatReply) {
                floatReply({
                  ...composerSnapshotRef.current,
                  subject: replySubject,
                });
              }
            }}
          >
            {t("changeSubject")}
          </button>
        ) : null}
        {/* Asked the way round it is answered: quoting the history is
            what a reply does, so the box is ticked and unticking it is
            the choice. `chatStyle` is still the state underneath — the
            name of a reply that quotes nothing — and this is its
            opposite, which is why the two are crossed here. */}
        {!forwarding && mode === "reply" ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800">
            {/* Drawn rather than accented. `accent-color` fills the box
                with the colour and leaves the tick white, so teal was
                a solid teal square on a line of quiet grey — the
                loudest thing under the message. This is the box the
                line is written in, with the tick in the same ink.

                Both colours are turned over by the dark theme, which
                rewrites bg-white and text-stone-700 for the shell — so
                a dark box with a light tick needs nothing said here. */}
            <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                className="peer h-3.5 w-3.5 appearance-none rounded-[3px] border border-stone-300 bg-white outline-none checked:border-stone-400 focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-50"
                checked={!chatStyle}
                disabled={chatStyleBusy}
                onChange={(e) => void setChatStyle(!e.target.checked)}
              />
              <Check
                aria-hidden
                className="pointer-events-none absolute h-3 w-3 text-stone-700 opacity-0 peer-checked:opacity-100"
              />
            </span>
            {t("quoteHistory")}
          </label>
        ) : null}
        {/* The same drawn box as Quote history. This is the forward's
            version of the same question — how much of the past goes
            with the mail — so it stands where that one stands. */}
        {/* Only where there is something to include. A message with no
            files has nothing for this to say. */}
        {forwarding && forwardSource?.attachments?.length ? (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800",
              forwardFilesBusy && "opacity-60"
            )}
          >
            <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                className="peer h-3.5 w-3.5 appearance-none rounded-[3px] border border-stone-300 bg-white outline-none checked:border-stone-400 focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-50"
                checked={forwardFiles}
                disabled={forwardFilesBusy}
                onChange={(e) =>
                  void setForwardIncludeFiles(e.target.checked, forwardSource)
                }
              />
              <Check
                aria-hidden
                className="pointer-events-none absolute h-3 w-3 text-stone-700 opacity-0 peer-checked:opacity-100"
              />
            </span>
            {forwardFilesBusy
              ? t("fetchingFiles")
              : t("includeAttachmentsCount", { count: forwardSource.attachments.length })}
          </label>
        ) : null}
        {/* Quiet, on the right: the draft is about the whole mail,
            the same kind of thing this row already holds. */}
        {mailHasTeamRecords() &&
        !forwarding &&
        (mode === "reply" || mode === "replyAll") ? (
          <DraftAssistMenu
            className="ml-auto"
            drafting={draftingReply}
            disabled={sending}
            onDraft={(hint) => void draftReplyWithAssist(hint)}
            onStop={stopDraft}
          />
        ) : null}
        {/* Providers refuse a mail past their limit: see forward-size.ts. */}
        {forwarding && sizeWarning ? (
          <p className="w-full text-[11px] leading-snug text-amber-700">{sizeWarning}</p>
        ) : null}
        {!forwarding && mode === "reply" && chatStyle ? (
          <p className="text-[11px] text-stone-400">
            {t("rememberedForConversation")}
          </p>
        ) : null}
      </div>
    </>
  );
}

/**
 * The recipients folded to one line above the card: who it goes to, Cc,
 * and from. A click opens them as rows at the top of the card
 * (thread-composer-rows.tsx).
 */
export function ComposerAddressRow({
  m,
}: {
  m: ThreadPaneModel;
}) {
  const {
    account,
    accounts,
    addressMenu,
    ccInputRef,
    ccList,
    floating,
    forwarding,
    fromAccount,
    openAddressMenu,
    setEditRecipients,
    setFromAccount,
    setReplyFocus,
    setShowCc,
    t,
    toList,
  } = m;
  return (
    <div
      className="mb-1 flex items-center gap-2"
      onDoubleClick={(e) => {
        if (floating) return;
        if (isInteractiveDoubleClickTarget(e.target)) return;
        setReplyFocus((v) => !v);
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-xs text-muted-foreground">
          <span>{t(forwarding ? "forwardingTo" : "replyingTo")}</span>
          {addressMenu}
          <button
            type="button"
            title={t("editRecipients")}
            className="min-w-0 truncate font-semibold text-stone-800 underline-offset-2 hover:underline"
            onClick={() => setEditRecipients(true)}
          >
            {toList.length ? (
              <RecipientSummary recipients={toList} onAddressMenu={openAddressMenu} />
            ) : (
              t("addRecipients")
            )}
          </button>
          <span aria-hidden>·</span>
          <button
            type="button"
            title={t(ccList.length ? "editCc" : "addCc")}
            className="min-w-0 truncate text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
            onClick={() => {
              setShowCc(true);
              setEditRecipients(true);
              // Straight into the box: Cc was clicked to add somebody. The
              // field is drawn on the next frame, so it is focused after it.
              requestAnimationFrame(() => requestAnimationFrame(() => ccInputRef.current?.focus()));
            }}
          >
            Cc
            {ccList.length ? (
              <span className="ml-1 font-semibold text-stone-800">
                <RecipientSummary recipients={ccList} onAddressMenu={openAddressMenu} />
              </span>
            ) : null}
          </button>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            from
            {accounts.length > 1 ? (
              /* As wide as the address it names, with the chevron where the
                 words stop. */
              <FromAccountMenu value={fromAccount} accounts={accounts} onChange={setFromAccount} />
            ) : (
              <span className="text-stone-700">{account}</span>
            )}
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * Pop out and grow, in the row with Send. The floating card draws neither:
 * it is already out, and it is as big as it is dragged.
 */
export function ComposerCardButtons({ m }: { m: ThreadPaneModel }) {
  const { floatReply, floating, onFloatReply, replyFocus, setReplyFocus, shortcuts, t } = m;
  const button = "shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-200/60 hover:text-stone-800";
  return (
    <>
      {onFloatReply && !floating ? (
        <button
          type="button"
          title={`${t("writeWhileYouBrowse")} (${formatShortcut(shortcuts.floatMessage)})`}
          aria-label={`${t("writeWhileYouBrowse")} (${formatShortcut(shortcuts.floatMessage)})`}
          className={button}
          /* Called, not handed to the button: the first argument is the
             snapshot to hand over, and a click event is not one. */
          onClick={() => floatReply()}
        >
          <PictureInPicture2 className="h-4 w-4" />
        </button>
      ) : null}
      {floating ? null : (
      <button
        type="button"
        title={`${t(replyFocus ? "showThread" : "focusMode")} (${formatShortcut(shortcuts.focusMessage)})`}
        aria-label={`${t(replyFocus ? "showThread" : "focusMode")} (${formatShortcut(shortcuts.focusMessage)})`}
        aria-pressed={replyFocus}
        className={button}
        onClick={() => setReplyFocus((v) => !v)}
      >
        {replyFocus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
      )}
    </>
  );
}
