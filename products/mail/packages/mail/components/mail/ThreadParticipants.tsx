"use client";

import * as React from "react";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import { toast } from "@/lib/mail/toast";
import { SaveAsListControl } from "@/components/mail/recipient-lists";
import { useAddressMenu } from "@/components/mail/AddressMenu";
import { copyTextToClipboard } from "@/lib/mail/copy-text";
import type { MailMessage } from "@/lib/mail/types";
import { useMailT } from "@/lib/mail/i18n";
import { mailSay } from "@/lib/mail/i18n-strings";
import { AccountMark } from "@/components/mail/AccountMark";
import { useAccountMarks } from "@/lib/mail/account-mark";
import { mailProviderFor, useIsOutlookAccount } from "@/lib/mail/use-outlook-accounts";

/**
 * The people on the thread, cut down to a line.
 *
 * A club circular goes to thirty addresses, and naming all of them buried
 * the message count, the dates and the mailbox under eight lines of
 * strangers. Four are named and the rest are counted, with the count as the
 * way to see them: "and 25 others" opens, "show fewer" closes.
 *
 * Not a hover or a tooltip. Who a mail went to is worth reading at leisure,
 * and often worth copying, neither of which a thing that vanishes allows.
 */
/** Named in full up to this many; beyond it, the rest are counted. */
const THREAD_PARTICIPANTS_SHOWN = 4;

type ParticipantChunk =
  | { kind: "person"; label: string; email: string; name?: string }
  /** `plain`: "You", the addresses on hover — when one mailbox's tab is chosen, it is no news. */
  | { kind: "you"; emails: string[]; plain?: boolean };

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
              onContextMenu={(e) => onAddressMenu(e, email)}
            >
              <MailboxName email={email} />
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

/** The chunks with ", " written between them, as the join used to do. */
function ParticipantNames({
  chunks,
  onAddressMenu,
}: {
  chunks: ParticipantChunk[];
  onAddressMenu: AddressMenuOpener;
}) {
  return (
    <>
      {chunks.map((chunk, i) => (
        <React.Fragment
          key={chunk.kind === "you" ? "you" : chunk.email}
        >
          {i > 0 ? ", " : null}
          <ParticipantName chunk={chunk} onAddressMenu={onAddressMenu} />
        </React.Fragment>
      ))}
    </>
  );
}

export function ThreadParticipants({
  people,
  others,
  meta,
}: {
  people: ParticipantChunk[];
  /** The same people, addressable — what a saved list would hold. */
  others: { email: string; name?: string }[];
  /** The rest of the header line: count, dates, which mailbox. */
  meta: React.ReactNode;
}) {
  const t = useMailT();
  const [expanded, setExpanded] = React.useState(false);
  const { openAddressMenu, addressMenu } = useAddressMenu();
  const hidden = people.length - THREAD_PARTICIPANTS_SHOWN;
  /*
    "Save as list…" waits for the names to be out.

    Fifty-two people are counted, not named, and the offer to keep them
    made no sense beside a line that had four addresses and a number on
    it: keep whom? Once the reader opens the names they can see what they
    would be keeping, and that is when it is worth asking. A short thread
    hides nobody, so there is nothing to wait for.
  */
  const showSave = others.length > 1 && (hidden <= 0 || expanded);
  /*
    Beside the names, not at the end of the line.

    It belongs to the people — it is what to do with the ones just opened —
    and the rest of the line is a message count and two dates it has
    nothing to do with. Small letter for the same reason: after "show
    fewer" it is one more thing this sentence offers, not a control of its
    own the way it is in the composer.
  */
  /*
    "Copy addresses" does not wait.

    A list is kept for later; the clipboard is for now, and now is often
    "put these thirty people in a To field somewhere else" — which is the
    very thread whose names are folded. So it stands whenever there is
    more than one address to copy, folded or not, and takes the addresses
    alone: names are what the reader already has on this line.
  */
  const copyAddresses =
    others.length > 1 ? (
      <>
        {" · "}
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
          {t("copyAddressesInline")}
        </button>
      </>
    ) : null;
  const saveList = showSave ? (
    <>
      {" · "}
      <SaveAsListControl
        people={others}
        align="start"
        noteKey="saveListNoteThread"
        labelKey="saveAsListInline"
      />
    </>
  ) : null;
  if (hidden <= 0) {
    return (
      <span>
        <ParticipantNames chunks={people} onAddressMenu={openAddressMenu} />
        {copyAddresses}
        {saveList} {meta}
        {addressMenu}
      </span>
    );
  }
  const shown = expanded ? people : people.slice(0, THREAD_PARTICIPANTS_SHOWN);
  return (
    <span>
      <ParticipantNames chunks={shown} onAddressMenu={openAddressMenu} />{" "}
      <button
        type="button"
        aria-expanded={expanded}
        // The heading wraps its line for the names, and only for them.
        data-names-open={expanded ? "" : undefined}
        className="font-medium text-teal-700 hover:underline"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded
          ? t("threadShowFewer")
          : hidden === 1
            ? t("threadOtherOne")
            : t("threadOtherMany", { count: hidden })}
      </button>
      {copyAddresses}
        {saveList} {meta}
      {addressMenu}
    </span>
  );
}

/**
 * Who is on the thread, with their addresses: "Roe, Jane
 * (jane.roe@example.org)". A name alone is what the list rows show, and
 * enough there; the header is where the reader checks who a person actually
 * is, and that is the address.
 *
 * Senders and recipients both. Senders alone left a thread of sent mail
 * saying nobody but "You", with no sign of who it went to. A recipient is
 * known by address only unless they wrote in the thread as well, in which
 * case their name comes from that.
 *
 * "You" stands in for every own address — the mailboxes connected here, and
 * whoever sent the messages marked as ours — and says which they were:
 * "You (you@work.example, you@home.example)". Own is not one address, and
 * is the one place to see which of yours a thread ran through.
 */
export function threadPeople(
  messages: MailMessage[],
  ownAddresses: string[]
): { others: { email: string; name?: string }[]; yours: string[] } {
  const own = new Set(ownAddresses.map((a) => a.trim().toLowerCase()));
  for (const m of messages) {
    if (m.own && m.fromEmail) own.add(m.fromEmail.trim().toLowerCase());
  }
  const nameByAddress = new Map<string, string>();
  for (const m of messages) {
    const key = m.fromEmail.trim().toLowerCase();
    const name = m.fromName.split("<")[0].trim();
    if (key && name && name.toLowerCase() !== key && !nameByAddress.has(key)) {
      nameByAddress.set(key, name);
    }
  }
  const others: { email: string; name?: string }[] = [];
  const yours: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const email = raw.trim();
    const key = email.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    if (own.has(key)) {
      yours.push(email);
      return;
    }
    others.push({ email, name: nameByAddress.get(key) });
  };
  for (const m of messages) {
    add(m.fromEmail);
    for (const to of m.toEmails) add(to);
    for (const cc of m.ccEmails) add(cc);
  }
  return { others, yours };
}

/**
 * The line's people. "You (…)" always holds the mailbox the thread came in
 * on, which the line no longer names apart: a list's mail or a Bcc names
 * none of your addresses, and the mailbox went with them.
 */
export function participantsWithAddresses(
  messages: MailMessage[],
  ownAddresses: string[],
  receivedOn?: string,
  /** One mailbox's tab is chosen: "You" for yours, rather than the mailbox. */
  plainYou = false
): ParticipantChunk[] {
  const { others, yours: named } = threadPeople(messages, ownAddresses);
  const mailbox = receivedOn?.trim();
  const yours =
    mailbox && !named.some((e) => e.trim().toLowerCase() === mailbox.toLowerCase())
      ? [mailbox, ...named]
      : named;
  return [
    ...others.map(
      (p): ParticipantChunk => ({
        kind: "person",
        label: p.name ? `${p.name} (${p.email})` : p.email,
        email: p.email,
        name: p.name,
      })
    ),
    ...(yours.length
      ? [{ kind: "you", emails: yours, plain: plainYou } satisfies ParticipantChunk]
      : []),
  ];
}

