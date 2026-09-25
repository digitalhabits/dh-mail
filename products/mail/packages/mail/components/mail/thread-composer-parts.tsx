"use client";

/*
 * Parts of the composer band's markup (ThreadComposerBand), moved out of
 * thread-pane-composer.tsx.
 *
 * Each component takes the pane's model (`m`, from useThreadPane) and reads the
 * names it needs from it; the band's own values come in as props. The JSX
 * is the band's own, word for word.
 */

import { Check, ChevronDown, Maximize2, Minimize2, PictureInPicture2 } from "lucide-react";

import { AiReplyMenu } from "@/components/mail/AiReplyMenu";
import { FromAccountMenu } from "@/components/mail/FromAccountMenu";
import { SentPreview, SignatureMetaControls } from "@/components/mail/composer-preview";
import { formatShortcut } from "@/lib/mail/shortcuts";
import {
  RecipientCarryProvider,
  RecipientField,
} from "@/components/mail/RecipientField";
import { isInteractiveDoubleClickTarget } from "@/components/mail/use-mail-layout";
import { bodyToEmailHtml } from "@/lib/client-email-html";
import { emailsOfRecipients } from "@/lib/mail/contact-list-types";
import { RecipientSummary } from "@/components/mail/AddressMenu";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
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
    forwardWholeAppendix,
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
              ? forwardWholeAppendix
                ? {
                    text: forwardWholeAppendix.text,
                    html: forwardWholeAppendix.html,
                  }
                : quotePayload
                  ? {
                      intro: `Forwarded message — from ${
                        quotePayload.fromName
                          ? `${quotePayload.fromName} <${quotePayload.fromEmail}>`
                          : quotePayload.fromEmail
                      }, ${quotePayload.date}:`,
                      text: quotePayload.text,
                      html: quotePayload.html,
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
    canSendLater,
    chatStyleBusy,
    composerSnapshotRef,
    draftReplyWithAi,
    draftingReply,
    floatReply,
    floating,
    forwardConversation,
    forwardFiles,
    forwardFilesBusy,
    forwardSource,
    forwardWhole,
    forwardWholeBusy,
    forwarding,
    fromAccount,
    includeSignature,
    mode,
    onFloatReply,
    replySubject,
    sending,
    setChatStyle,
    setForwardIncludeFiles,
    setForwardWholeConversation,
    setIncludeSignature,
    setSigDialogOpen,
    setSubjectDraft,
    setSubjectOpen,
    sigSettings,
    stopAiReply,
    subjectOpen,
    t,
  } = m;
  return (
    <>
      {/* Under the box, outside the card.
          Facts about the message, not the writing of it. Preview,
          Outlook and a CRM propose sit on the Send chevron. */}
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
            files has nothing for this to say. The whole-conversation box
            brings its own files, so this one stands down for it. */}
        {forwarding &&
        !forwardWhole &&
        forwardSource?.attachments?.length ? (
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
        {forwarding ? (
          <label
            className={cn(
              "flex cursor-pointer items-center gap-1.5 text-xs text-stone-500 hover:text-stone-800",
              forwardWholeBusy && "opacity-60"
            )}
          >
            <span className="relative inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                className="peer h-3.5 w-3.5 appearance-none rounded-[3px] border border-stone-300 bg-white outline-none checked:border-stone-400 focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-50"
                checked={forwardWhole}
                disabled={forwardWholeBusy}
                onChange={(e) =>
                  void setForwardWholeConversation(e.target.checked)
                }
              />
              <Check
                aria-hidden
                className="pointer-events-none absolute h-3 w-3 text-stone-700 opacity-0 peer-checked:opacity-100"
              />
            </span>
            {forwardWholeBusy
              ? t("fetchingConversation")
              : forwardWhole && forwardConversation
                ? t("forwardWholeConversationCount", { count: forwardConversation.length })
                : t("forwardWholeConversation")}
          </label>
        ) : null}
        {/* Quiet, on the right: the draft is about the whole mail,
            the same kind of thing this row already holds. */}
        {mailUsesCrmPeople() &&
        !forwarding &&
        (mode === "reply" || mode === "replyAll") ? (
          <AiReplyMenu
            className="ml-auto"
            drafting={draftingReply}
            disabled={sending}
            onDraft={(hint) => void draftReplyWithAi(hint)}
            onStop={stopAiReply}
          />
        ) : null}
        {/* Providers refuse a mail past their limit. Said here, while
            there are chips to prune, rather than as an error after the
            send. Base64 makes files a third bigger on the wire, which
            is why this speaks up short of the stated number. */}
        {forwarding &&
        attachTotalBytes >
          (canSendLater ? 20 : 25) * 1024 * 1024 * 0.72 ? (
          <p className="w-full text-[11px] leading-snug text-amber-700">
            {`The files together are about ${Math.round(
              attachTotalBytes / (1024 * 1024)
            )} MB. ${
              canSendLater ? "Outlook" : "Gmail"
            } takes about ${canSendLater ? 20 : 25} MB in one mail, so it may refuse this. Remove some files.`}
          </p>
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

/** From, To and Cc, and the buttons that float, fill or shrink the box. */
export function ComposerAddressRow({
  m,

}: {
  m: ThreadPaneModel;

}) {
  const {
    account,
    accounts,
    addressMenu,
    ccList,
    editRecipients,
    floatReply,
    floating,
    forwarding,
    fromAccount,
    onFloatReply,
    openAddressMenu,
    recipientInputRef,
    replyFocus,
    setCcList,
    setEditRecipients,
    setFromAccount,
    setReplyFocus,
    setShowCc,
    setToList,
    shortcuts,
    showCc,
    t,
    toList,
  } = m;
  return (
    <>
      <div
        className={cn(
          "mb-1 flex gap-2",
          /* On one line, the focus button is taller than the words
             beside it, and aligned to the top it hung below them —
             which read as space under the line rather than as a
             button standing proud of it. Centred, that height is
             shared above and below.

             Opened out into the recipient fields, the block is taller
             than the button and centring would strand it halfway down
             the side, so there it still sits at the top. */
          editRecipients ? "items-start" : "items-center",
          /* Stays at the top while the reply scrolls under it, so the
             pop-out and expand buttons are always in reach. Not when
             the recipient fields are open: that block is tall, and
             held in place it would cover the box you type in. */
          !editRecipients &&
            "sticky top-0 z-20 bg-[var(--mail-thread-chrome)] py-1"
        )}
        onDoubleClick={(e) => {
          if (floating) return;
          if (isInteractiveDoubleClickTarget(e.target)) return;
          setReplyFocus((v) => !v);
        }}
      >
        <div className="min-w-0 flex-1">
          {editRecipients ? (
            /* The provider is what lets a chip be dragged from To to
               Cc. The compose window has one; the reply had none, so
               its chips would not lift. */
            <RecipientCarryProvider>
            <div className="flex flex-col gap-1.5">
              {/*
                To beside From while there is room, From above To when
                there is not. The From box is as wide as an address and
                does not give, so on a narrow pane it squeezed the To
                field into a column of one chip per line. Wrapped in
                reverse, the line that no longer fits — From — goes
                above rather than below, which is where the compose
                window keeps it; and with the cross axis turned around,
                items-end is the top.
              */}
              <div className="flex flex-wrap-reverse items-end gap-2">
                <div className="min-w-[min(16rem,100%)] flex-1">
                  <RecipientField
                    label={t("fieldTo")}
                    values={toList}
                    onChange={setToList}
                    allowSaveList
                    // Reply-all to a circular is thirty addresses. Folded
                    // while nobody is editing them, as in the compose
                    // window — see RecipientField.
                    collapseAfter={6}
                    ownAccounts={accounts}
                    placeholder={
                      forwarding
                        ? "name@example.com, second@example.com"
                        : t("addRecipient")
                    }
                    inputRef={recipientInputRef}
                  />
                </div>
                <div className="flex max-w-full shrink-0 items-center gap-1.5 rounded-xl border border-stone-200 bg-white px-2.5 py-[7px]">
                  <span className="text-xs text-muted-foreground">
                    {t("fieldFrom")}
                  </span>
                  {accounts.length > 1 ? (
                    <span className="relative inline-flex items-center">
                      <select
                        value={fromAccount}
                        onChange={(e) => setFromAccount(e.target.value)}
                        className="max-w-[22ch] cursor-pointer appearance-none truncate bg-transparent py-0.5 pr-4 text-sm text-stone-700 outline-none"
                      >
                        {accounts.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-stone-400" />
                    </span>
                  ) : (
                    <span className="py-0.5 text-sm text-stone-700">
                      {account}
                    </span>
                  )}
                </div>
              </div>
              {ccList.length || showCc ? (
                <RecipientField
                  label={t("fieldCc")}
                  values={ccList}
                  onChange={setCcList}
                  collapseAfter={6}
                  ownAccounts={accounts}
                  placeholder={t("addRecipient")}
                />
              ) : (
                <p className="px-1 text-xs text-muted-foreground">
                  <button
                    type="button"
                    className="text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline"
                    onClick={() => setShowCc(true)}
                  >
                    {t("addCc")}
                  </button>
                </p>
              )}
            </div>
            </RecipientCarryProvider>
          ) : (
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
                  <RecipientSummary
                    recipients={toList}
                    onAddressMenu={openAddressMenu}
                  />
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
                }}
              >
                Cc
                {ccList.length ? (
                  <span className="ml-1 font-semibold text-stone-800">
                    <RecipientSummary
                      recipients={ccList}
                      onAddressMenu={openAddressMenu}
                    />
                  </span>
                ) : null}
              </button>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                from
                {accounts.length > 1 ? (
                  /* As wide as the address it names, with the chevron
                     where the words stop. A select was as wide as its
                     longest option, so with a team address in the list
                     the shorter ones left a gap with nothing in it. */
                  <FromAccountMenu
                    value={fromAccount}
                    accounts={accounts}
                    onChange={setFromAccount}
                  />
                ) : (
                  <span className="text-stone-700">{account}</span>
                )}
              </span>
            </p>
          )}
        </div>
        {onFloatReply && !floating ? (
          /*
           * Sends the reply to the floating card. The card does not
           * draw it: a button to pop out what is already out says
           * nothing, and the card's heading has the way back to the
           * thread. The shortcut still works both ways.
           */
          <button
            type="button"
            title={`${t("writeWhileYouBrowse")} (${formatShortcut(
              shortcuts.floatMessage
            )})`}
            aria-label={`${t("writeWhileYouBrowse")} (${formatShortcut(
              shortcuts.floatMessage
            )})`}
            className="shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
            /* Called, not handed to the button: the first argument is
               the snapshot to hand over, and a click event is not one. */
            onClick={() => floatReply()}
          >
            <PictureInPicture2 className="h-4 w-4" />
          </button>
        ) : null}
        {floating ? null : (
          /*
           * Grow the message over the thread. The card has no thread
           * under it to grow over — it is the message on its own, and
           * as big as it is dragged — so the button is not drawn there.
           * The compose window's card leaves it out for the same
           * reason. What the card does have is its heading, and the way
           * back to the thread on it.
           */
          <button
            type="button"
            title={`${t(replyFocus ? "showThread" : "focusMode")} (${formatShortcut(
              shortcuts.focusMessage
            )})`}
            aria-label={`${t(replyFocus ? "showThread" : "focusMode")} (${formatShortcut(
              shortcuts.focusMessage
            )})`}
            aria-pressed={replyFocus}
            className="shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-200/60 hover:text-stone-800"
            onClick={() => setReplyFocus((v) => !v)}
          >
            {replyFocus ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    </>
  );
}
