"use client";

import * as React from "react";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import { toast } from "@/lib/mail/toast";
import { SaveAsListControl } from "@/components/mail/recipient-lists";
import { useAddressMenu } from "@/components/mail/AddressMenu";
import { copyTextToClipboard } from "@/lib/mail/copy-text";
import type { ParticipantChunk } from "@/lib/mail/thread-heading-people";
import { useMailT } from "@/lib/mail/i18n";
import { mailSay } from "@/lib/mail/i18n-strings";
import { AccountMark } from "@/components/mail/AccountMark";
import { useAccountMarks } from "@/lib/mail/account-mark";
import { mailProviderFor, useIsOutlookAccount } from "@/lib/mail/use-outlook-accounts";

export { participantsWithAddresses, threadPeople } from "@/lib/mail/thread-heading-people";
import { headingPeople, headingPeopleLine } from "@/lib/mail/thread-heading-people";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { MailPopoverContent } from "@/components/mail/MailPopoverContent";

/**
 * The people on the thread, in the heading: two names and a count, and the
 * whole line as the way to see everyone.
 */
/**
 * One name on the line, with its address as a way to write to it.
 *
 * The name and its address are a button: a click opens a new message to
 * that person, the same request an address clicked inside a message body
 * makes. A named person reads as a mail header writes them: "Name
 * <address>", in the line's one colour.
 *
 * Yours are not "You": each is its mailbox as the tabs show it, the mark
 * and the short name, with the whole address on hover. Each is clickable —
 * writing to yourself is how half the world takes notes.
 */
/** A right press does not select the word under it: it opens a menu. */
function keepSelection(e: React.MouseEvent) {
  if (e.button === 2) e.preventDefault();
}

type AddressMenuOpener = (
  e: React.MouseEvent,
  email: string,
  name?: string
) => void;

function ParticipantName({
  chunk,
  onAddressMenu,
}: {
  chunk: ParticipantChunk;
  /** A right-click on the name: copy the address, or write to it. */
  onAddressMenu: AddressMenuOpener;
}) {
  const t = useMailT();
  if (chunk.kind === "you" && chunk.plain) {
    return <span title={chunk.emails.join(", ")}>{t("threadYou")}</span>;
  }
  if (chunk.kind === "you") {
    return (
      <>
        {chunk.emails.map((email, i) => (
          <React.Fragment key={email}>
            {i > 0 ? ", " : null}
            <button
              type="button"
              className="hover:underline"
              title={`${email} — ${t("writeToThisAddress")}`}
              onClick={() => requestMailComposeTo(email)}
              onMouseDown={keepSelection}
              onContextMenu={(e) => onAddressMenu(e, email)}
            >
              {/*
                Only a mailbox connected here has a tab to look like. An
                address of yours that only sent mail (an alias, an old
                college address) has no provider we know, and its short
                name can be a tab's name. Without this check,
                dana.fisher@college reads as the Gmail tab "dana.fisher",
                with Gmail's mark.
              */}
              {chunk.mailboxes?.includes(email.trim().toLowerCase()) ?? true ? (
                <MailboxName email={email} />
              ) : (
                email
              )}
            </button>
          </React.Fragment>
        ))}
      </>
    );
  }
  return (
    <button
      type="button"
      className="hover:underline"
      title={t("writeToThisAddress")}
      onClick={() => requestMailComposeTo(chunk.email)}
      onMouseDown={keepSelection}
              onContextMenu={(e) => onAddressMenu(e, chunk.email, chunk.name)}
    >
      {chunk.name ? (
        <>
          {chunk.name} &lt;{chunk.email}&gt;
        </>
      ) : (
        chunk.email
      )}
    </button>
  );
}

/** A mailbox of yours as its tab shows it: the mark and the short name. */
function MailboxName({ email }: { email: string }) {
  const marks = useAccountMarks();
  const isOutlookAccount = useIsOutlookAccount();
  return (
    <span className="inline-flex items-center gap-1 align-[-2px]">
      <AccountMark
        mark={marks[email.trim().toLowerCase()]}
        provider={mailProviderFor(email, isOutlookAccount)}
        className="h-3.5 w-3.5"
      />
      {/* The tab's word: the address before the @, its mark telling two of a name apart. */}
      {email.split("@")[0] || email}
    </span>
  );
}

export function ThreadParticipants({
  people,
  others,
  leadEmail,
  meta,
}: {
  people: ParticipantChunk[];
  /** The same people, addressable — what a saved list would hold. */
  others: { email: string; name?: string }[];
  /** Who wrote the thread's first message: the one the heading names first. */
  leadEmail?: string;
  /** The rest of the header line: count, dates, which mailbox. */
  meta: React.ReactNode;
}) {
  const t = useMailT();
  // Opened from the card of everyone, which is a popover: over it.
  const { openAddressMenu, addressMenu } = useAddressMenu({ abovePopovers: true });
  /*
    Names, not addresses, and no more than two (2026-10-27).

    "Mikkel Gabriel Christoffersen <mch@…> and 1 other" was most of the
    line and said less than "Mikkel Christoffersen and You". So the
    heading names who started the thread and the next person, and counts
    the rest: "A, B and 2 more". The line as a whole opens one card of
    everyone, with their addresses and what to do with them.
  */
  const names = headingPeople(people, leadEmail, t("threadYou"));
  if (!names.length) return <span>{meta}</span>;
  const line = headingPeopleLine(names, {
    and: t("threadAnd"),
    more: (count) => (count === 1 ? t("threadMoreOne") : t("threadMoreMany", { count })),
  });
  return (
    <span>
      <EveryoneCard people={people} others={others} onAddressMenu={openAddressMenu}>
        {line}
      </EveryoneCard>
      {meta ? <> {meta}</> : null}
      {addressMenu}
    </span>
  );
}

/** How long the pointer can be off the count and the card before it closes. */
const CARD_CLOSE_MS = 200;

/**
 * Everyone on the thread, from the names beside the subject.
 *
 * It opens on hover, for a look. A click on the count, or anything inside
 * the card, keeps it open, because who a mail went to is often worth
 * copying, and a thing that closes when the pointer moves does not allow
 * that.
 */
function EveryoneCard({
  people,
  others,
  children,
  onAddressMenu,
}: {
  people: ParticipantChunk[];
  others: { email: string; name?: string }[];
  /** The names, which are the way in. */
  children: React.ReactNode;
  onAddressMenu: AddressMenuOpener;
}) {
  const t = useMailT();
  const [open, setOpen] = React.useState(false);
  const [kept, setKept] = React.useState(false);
  const closeTimer = React.useRef<number | null>(null);
  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const hoverOpen = () => {
    cancelClose();
    setOpen(true);
  };
  const hoverClose = () => {
    if (kept) return;
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), CARD_CLOSE_MS);
  };
  React.useEffect(() => cancelClose, []);
  const onOpenChange = (next: boolean) => {
    cancelClose();
    setOpen(next);
    if (!next) setKept(false);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-expanded={open}
          // The heading's own line, as words: no pill.
          className="max-w-full truncate text-left hover:underline"
          onMouseEnter={hoverOpen}
          onMouseLeave={hoverClose}
          onClick={(e) => {
            // The trigger would toggle; a click on an open card keeps it.
            e.preventDefault();
            cancelClose();
            setOpen(true);
            setKept(true);
          }}
        >
          {children}
        </button>
      </PopoverTrigger>
      <MailPopoverContent
        align="end"
        className="w-auto max-w-[min(36rem,90vw)] p-3 text-sm"
        // A look on hover does not take the focus from the thread.
        onOpenAutoFocus={(e) => {
          if (!kept) e.preventDefault();
        }}
        onMouseEnter={hoverOpen}
        onMouseLeave={hoverClose}
        onPointerDown={() => setKept(true)}
      >
        <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto text-stone-800">
          {people.flatMap((chunk) =>
            chunk.kind === "you"
              ? chunk.emails.map((email) => (
                  <li key={`you:${email}`}>
                    <button
                      type="button"
                      className="text-left hover:underline"
                      title={t("writeToThisAddress")}
                      onClick={() => requestMailComposeTo(email)}
                      onMouseDown={keepSelection}
              onContextMenu={(e) => onAddressMenu(e, email)}
                    >
                      {t("threadYouLower")} &lt;{email}&gt;
                    </button>
                  </li>
                ))
              : [
                  <li key={chunk.email}>
                    <ParticipantName chunk={chunk} onAddressMenu={onAddressMenu} />
                  </li>,
                ]
          )}
        </ul>
        {others.length > 1 ? (
          <div className="mt-2.5 flex gap-3 border-t border-stone-200 pt-2.5">
            <button
              type="button"
              className="text-teal-700 hover:underline"
              onClick={() => {
                void copyTextToClipboard(
                  // Semicolons: Outlook splits a pasted list on those alone by
                  // default; Gmail and Apple Mail take either.
                  others.map((p) => p.email).join("; ")
                ).then((ok) =>
                  ok
                    ? toast.success(mailSay("copied"))
                    : toast.error(mailSay("couldNotCopy"))
                );
              }}
            >
              {t("copyAddresses")}
            </button>
            {/*
              A circular arrives with the whole club on it, and that is a
              list worth keeping — the same list the composer offers to
              save when you type the names in yourself.
            */}
            <SaveAsListControl
              people={others}
              align="start"
              noteKey="saveListNoteThread"
              labelKey="saveAsList"
            />
          </div>
        ) : null}
      </MailPopoverContent>
    </Popover>
  );
}
