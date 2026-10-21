"use client";

/*
 * Parts of ChatPopout's markup (ChatPopout.tsx): the head of the window,
 * the bubbles, and the foot. Each takes the values it reads as props of
 * the same name.
 */

import * as React from "react";
import { Minus, Square, X } from "lucide-react";
import { attachmentUrl } from "@/lib/mail/attachment-save";
import { AttachmentSizeSummary, AttachToolbarButton, DraftAttachmentThumbs } from "@/components/mail/draft-attachments";
import { openAttachmentOutside } from "@/components/mail/attachment-files";
import { MailBubble } from "@/components/mail/MailBubble";
import { EmojiPickerButton } from "@/components/ui/EmojiPicker";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import {
  avatarStyle,
  senderInitials,
} from "@/components/mail/avatar";
import { chatDayLabel, sameDay, timeOfDay } from "@/lib/mail/date-format";
import { reactionQuoteText } from "@/lib/mail/reaction-message";
import { teamAvatarSrc } from "@/lib/mail/team-avatars";
import { cn } from "@/lib/utils";
import type { ChatPopoutProps, useChatHistory, useChatSend, useChatState, useChatWindow } from "@/components/mail/ChatPopout";

/** The window's head: the person, the subject, what is not seen yet, fold and close. */
export function ChatHeader({
  close,
  collapsed,
  personEmail,
  personName,
  setWindowCollapsed,
  subject,
  t,
  unseenCount,
}: {
  close: ReturnType<typeof useChatSend>["close"];
  collapsed: ReturnType<typeof useChatState>["collapsed"];
  personEmail: ChatPopoutProps["personEmail"];
  personName: ChatPopoutProps["personName"];
  setWindowCollapsed: ReturnType<typeof useChatWindow>["setWindowCollapsed"];
  subject: ChatPopoutProps["subject"];
  t: ReturnType<typeof useChatState>["t"];
  unseenCount: ReturnType<typeof useChatHistory>["unseenCount"];
}) {
  return (
    <div
      data-tauri-drag-region
      // The same cream as the main window's chrome, so the strip that names
      // who you are talking to reads as chrome here too, and the messages
      // below it keep the pane to themselves. The rule only makes sense when
      // there is something under it — folded, this strip is the whole card,
      // and fills it.
      className={cn(
        "flex shrink-0 items-center bg-[var(--mail-chrome)]",
        // Folded it is the whole window, so it gives back the room it does
        // not need: a smaller face, less air around it.
        collapsed ? "gap-2.5 px-3 py-1.5" : "gap-3 px-4 py-2",
        // Folded, this strip is the whole card, so it takes the whole of it.
        // Left at its own height it sat centred in a taller white card, and
        // the card showed above and below it as two white bands.
        collapsed && "grow",
        !collapsed && "border-b border-[var(--mail-chrome-border)]"
      )}
    >
      {teamAvatarSrc(personEmail) ? (
        <img
          aria-hidden
          data-tauri-drag-region
          src={teamAvatarSrc(personEmail)}
          alt=""
          className={cn(
            "shrink-0 rounded-full object-cover",
            collapsed ? "h-8 w-8" : "h-10 w-10"
          )}
        />
      ) : (
        <span
          aria-hidden
          data-tauri-drag-region
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            collapsed ? "h-8 w-8" : "h-10 w-10",
            avatarStyle((personEmail || personName).toLowerCase())
          )}
        >
          <span data-tauri-drag-region className="pointer-events-none">
            {senderInitials(personName, personEmail)}
          </span>
        </span>
      )}
      <div data-tauri-drag-region className="min-w-0 flex-1">
        <p
          data-tauri-drag-region
          className="truncate text-[15px] font-bold leading-tight text-stone-900"
        >
          {personName || personEmail}
        </p>
        <p
          data-tauri-drag-region
          className="truncate text-[13px] leading-tight text-stone-500"
        >
          {subject}
        </p>
      </div>
      {unseenCount > 0 ? (
        <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-teal-600 px-1.5 text-xs font-semibold text-white">
          {unseenCount}
        </span>
      ) : null}
      <button
        type="button"
        aria-label={collapsed ? "Expand" : "Collapse"}
        title={collapsed ? "Expand" : "Collapse"}
        className="rounded-inner p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
        onClick={() => void setWindowCollapsed(!collapsed)}
      >
        {collapsed ? (
          <Square className="h-4 w-4" />
        ) : (
          <Minus className="h-4 w-4" />
        )}
      </button>
      <button
        type="button"
        aria-label={t("close")}
        title={t("close")}
        className="rounded-inner p-1.5 text-stone-500 hover:bg-stone-100 hover:text-stone-800"
        onClick={close}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** The bubbles, with the way to older messages over them. */
export function ChatMessages({
  account,
  bubbleActions,
  canLoadOlder,
  contentRef,
  earlierBySender,
  loadError,
  loadOlder,
  loadingOlder,
  messages,
  readerScrolledRef,
  scrollRef,
  subject,
  t,
  thread,
}: {
  account: ChatPopoutProps["account"];
  bubbleActions: ReturnType<typeof useChatSend>["bubbleActions"];
  canLoadOlder: ReturnType<typeof useChatHistory>["canLoadOlder"];
  contentRef: ReturnType<typeof useChatState>["contentRef"];
  earlierBySender: ReturnType<typeof useChatHistory>["earlierBySender"];
  loadError: ReturnType<typeof useChatState>["loadError"];
  loadOlder: ReturnType<typeof useChatHistory>["loadOlder"];
  loadingOlder: ReturnType<typeof useChatHistory>["loadingOlder"];
  messages: ReturnType<typeof useChatHistory>["messages"];
  readerScrolledRef: ReturnType<typeof useChatState>["readerScrolledRef"];
  scrollRef: ReturnType<typeof useChatState>["scrollRef"];
  subject: ChatPopoutProps["subject"];
  t: ReturnType<typeof useChatState>["t"];
  thread: ReturnType<typeof useChatState>["thread"];
}) {
  return (
    <div
                ref={scrollRef}
                className="mail-thread-surface min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2"
                /**
                 * The browser must not move the view for us.
                 *
                 * Scroll anchoring shifts scrollTop when content around the
                 * view resizes, which is a second thing pulling at the scroll
                 * while the window loads. One rule owns the position here.
                 */
                style={{ overflowAnchor: "none" }}
                /* A person did this. Nothing else sets it. */
                onWheel={() => {
                  readerScrolledRef.current = true;
                }}
                onTouchMove={() => {
                  readerScrolledRef.current = true;
                }}
                onKeyDown={() => {
                  readerScrolledRef.current = true;
                }}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  // Only ever hands the view back. Scrolling to the end says
                  // "keep me here"; nothing a scroll event says can take the
                  // end away, because the window's own loading fires these.
                  if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) {
                    readerScrolledRef.current = false;
                  }
                  // Near the top and there is more behind it.
                  //
                  // Only for a reader who scrolled there. A window that has
                  // just opened is also at the top: every HTML message is a
                  // frame 140pt tall until it paints, so a long thread is far
                  // shorter than it will be, and the pin to the end lands at
                  // the start and fires this. The window then fetched a page
                  // nobody asked for and put the view back where that page
                  // began — which is the wrong place, held for as long as the
                  // fetch took, until the frames settled and the pin threw
                  // the reader to the end.
                  if (!readerScrolledRef.current) return;
                  if (el.scrollTop > 60) return;
                  if (!canLoadOlder || loadingOlder) return;
                  void loadOlder();
                }}
              >
                {/* One box around the messages, so their growth is one thing
                    to watch. The spacing rides with them. */}
                <div ref={contentRef} className="space-y-2">
                {canLoadOlder ? (
                  <p className="py-2 text-center text-[11px] text-stone-400">
                    {loadingOlder ? t("loadingEarlierMessages") : t("scrollUpForEarlier")}
                  </p>
                ) : null}
                {loadError && !thread ? (
                  <p className="pt-6 text-center text-sm text-stone-400">
                    {loadError}
                  </p>
                ) : !thread ? (
                  <p className="pt-6 text-center text-sm text-stone-400">
                    {t("loading")}
                  </p>
                ) : null}
                {messages.map((m, i) => {
                  const previous = messages[i - 1];
                  const newDay =
                    !previous || !sameDay(previous.sentAt, m.sentAt);
                  return (
                  <React.Fragment key={`day-${m.id}`}>
                  {/* The day, once, over the messages that belong to it —
                      in the mail list's small capitals, the same as the
                      thread reader's. This window shows the same
                      conversation the reader does. */}
                  {newDay && m.sentAt ? (
                    <p className="pb-1 pt-3 text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--mail-chrome-faint)]">
                      {chatDayLabel(m.sentAt, t)}
                    </p>
                  ) : null}
                  <div key={m.id} className="min-w-0">
                    <MailBubble
                      {...bubbleActions(m)}
                      earlierFromSender={earlierBySender.get(m.id)}
                      showPrint={false}
                      // One window, one conversation, one person: their name
                      // over every message says nothing that the window does
                      // not already. The time goes in the bubble instead.
                      showMeta={false}
                      timeLabel={timeOfDay(m.sentAt)}
                      message={m}
                      account={account}
                      subject={subject}
                      defaultAllowImages
                      // Never folded here. This window holds one short
                      // conversation, and a fold in it hid the very thing
                      // somebody opened the window to read.
                      sendStatus={
                        m.id.startsWith("local-") ? "sending" : undefined
                      }
                      onPreviewAttachment={(attachment) =>
                        openAttachmentOutside({
                          path: attachmentUrl({
                            account,
                            messageId: m.id,
                            attachment,
                          }),
                          filename: attachment.filename,
                        })
                      }
                    />
                  </div>
                  </React.Fragment>
                  );
                })}
                </div>
              </div>
  );
}

/** The foot of the window: the error, the quote, the attachments, and the box to write in. */
export function ChatComposer({
  addAttachFiles,
  attachItems,
  attachPasteHandlers,
  attachTotalBytes,
  composerKey,
  composerRef,
  draft,
  inputRef,
  insertEmoji,
  quotedForReply,
  removeAttach,
  send,
  sendError,
  sending,
  setDraft,
  setDraftPreviewId,
  setQuoteMessageId,
  t,
  thread,
}: {
  addAttachFiles: ReturnType<typeof useChatState>["addAttachFiles"];
  attachItems: ReturnType<typeof useChatState>["attachItems"];
  attachPasteHandlers: ReturnType<typeof useChatState>["attachPasteHandlers"];
  attachTotalBytes: ReturnType<typeof useChatState>["attachTotalBytes"];
  composerKey: ReturnType<typeof useChatState>["composerKey"];
  composerRef: ReturnType<typeof useChatState>["composerRef"];
  draft: ReturnType<typeof useChatState>["draft"];
  inputRef: ReturnType<typeof useChatState>["inputRef"];
  insertEmoji: ReturnType<typeof useChatSend>["insertEmoji"];
  quotedForReply: ReturnType<typeof useChatSend>["quotedForReply"];
  removeAttach: ReturnType<typeof useChatState>["removeAttach"];
  send: ReturnType<typeof useChatSend>["send"];
  sendError: ReturnType<typeof useChatState>["sendError"];
  sending: ReturnType<typeof useChatState>["sending"];
  setDraft: ReturnType<typeof useChatState>["setDraft"];
  setDraftPreviewId: ReturnType<typeof useChatState>["setDraftPreviewId"];
  setQuoteMessageId: ReturnType<typeof useChatSend>["setQuoteMessageId"];
  t: ReturnType<typeof useChatState>["t"];
  thread: ReturnType<typeof useChatState>["thread"];
}) {
  return (
    <div className="shrink-0 px-3 pb-3 pt-0">
                {sendError ? (
                  <p className="pb-1.5 text-xs text-red-600">{sendError}</p>
                ) : null}
                {/* In the colour of a message from you, because that is what
                    it is about to be. On the card's own white, with a rule
                    above it, a waiting file reads as part of the window rather
                    than part of what is being written. */}
                {/* What the next send will quote. Without this, picking a
                    message to reply to does nothing that you can see. The box
                    takes the caret, and the quote is invisible until it
                    arrives at the other end. */}
                {quotedForReply ? (
                  <div className="mb-1 flex items-start gap-2 rounded-surface border border-[var(--mail-bubble-own-border)] bg-[var(--mail-bubble-own)] px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold text-stone-500">
                        Replying to{" "}
                        {quotedForReply.own
                          ? "yourself"
                          : quotedForReply.fromName || quotedForReply.fromEmail}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-stone-600">
                        {reactionQuoteText(quotedForReply.bodyText) ||
                          "(no text)"}
                      </span>
                    </span>
                    <button
                      type="button"
                      title={t("dontQuoteIt")}
                      aria-label={t("dontQuoteIt")}
                      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                      onClick={() => setQuoteMessageId(null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                {attachItems.length ? (
                  <div className="mb-1 rounded-surface border border-[var(--mail-bubble-own-border)] bg-[var(--mail-bubble-own)] px-1 pb-1.5 pt-1">
                    <DraftAttachmentThumbs
                      items={attachItems}
                      onRemove={removeAttach}
                      onPreview={setDraftPreviewId}
                    />
                    <div className="px-1 pt-1">
                      <AttachmentSizeSummary
                        count={attachItems.length}
                        totalBytes={attachTotalBytes}
                      />
                    </div>
                  </div>
                ) : null}
                {/* Ends aligned. The offsets below put both icons level with
                    the first line, which is where the box starts — so they
                    read as centred on an empty box and stay in the bottom
                    corner as it grows, rather than drifting up the middle of
                    a paragraph. */}
                <div ref={composerRef} className="flex items-end gap-2">
                  {/* The paste handlers sit here rather than on the box:
                      the editor takes no DOM props of its own, and a paste
                      into it bubbles up to this either way. */}
                  <div
                    className="relative min-w-0 flex-1"
                    {...attachPasteHandlers}
                  >
                  {/* The same editor as the reply box in the reader, in
                      Quill's bubble theme: no toolbar of its own, and B,
                      I, U and the link over whatever is selected. There is
                      no room in a window this size for a permanent bar,
                      and this is a window for short messages anyway.

                      rounded-control, the same as New email in the main window,
                      so the two boxes you type into are the same shape.
                      The heights and the room kept for the emoji button
                      are in `mail.css`, on .mail-chat-input. */}
                  <RichTextEditor
                    key={composerKey}
                    className="mail-chat-input"
                    variant="bubble"
                    handleRef={inputRef}
                    defaultValue={draft}
                    onChange={setDraft}
                    // Enter sends, shift-Enter starts a line — the same as
                    // every chat window. Also with nothing typed, when a
                    // file is waiting: there is no Send button to reach for.
                    onEnter={() => void send()}
                    // Just "Message". The name is the window's title and is
                    // right above this. When there is no display name, the
                    // name is the address, which fills the box and says nothing.
                    placeholder={sending ? "Sending…" : "Message"}
                    minHeight={41}
                  />
                  {/* In the box, on the right, where every chat app puts it
                      — it writes into the box, so it belongs in it.
                      The offsets here and on the paperclip are what the eye
                      wants rather than what the box measures: a glyph is not
                      centred in its own viewBox, and the two are not centred
                      the same way, so they need different numbers to sit on
                      the same line. */}
                  <span className="absolute bottom-1 right-1.5">
                    <EmojiPickerButton
                      onPick={insertEmoji}
                      className="inline-flex h-7 w-7 items-center justify-center rounded text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                    />
                  </span>
                  </div>
                  {/* The paperclip stays outside: it attaches a file to the
                      message rather than putting anything in the box. */}
                  <span className="flex shrink-0 items-end pb-1.5">
                    <AttachToolbarButton
                      onPick={addAttachFiles}
                      disabled={!thread || sending}
                      // Optically the size of the emoji, not numerically:
                      // a paperclip fills its box top to bottom, a smiley is
                      // a circle inside one, so equal boxes do not look
                      // equal.
                      iconClassName="h-[18px] w-[18px]"
                    />
                  </span>
                </div>
              </div>
  );
}
