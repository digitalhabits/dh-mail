"use client";

import { DraftBadge, useThreadDraftKeys } from "@/components/mail/ThreadListRow";
import { PersonAvatar } from "@/components/mail/PersonAvatar";
import { useAddressMenu } from "@/components/mail/AddressMenu";

import * as React from "react";
import { requestMailComposeTo } from "@/lib/mail/compose-to";
import { isOwnPersonalAddress, normalizeEmail } from "@/lib/own-addresses";
import { type PersonRow } from "@/lib/mail/person-participants";
import { MailDotIcon } from "@/components/mail/MailDotIcon";
import { usePinchZoom } from "@/components/mail/use-mail-layout";
import { ZoomControls } from "@/components/mail/ZoomControls";
import { Archive, Trash2 } from "lucide-react";
import { threadDraftKey } from "@/lib/mail/local-drafts";
import { threadKey } from "@/lib/mail/thread-copies";
import { SettingsDialog, settingsSecondaryButton } from "@/components/mail/settings-ui";
import { THREAD_ACTION_CLASS } from "@/components/mail/thread-actions";
import { useMailT } from "@/lib/mail/i18n";
import { actionForEvent, formatShortcut } from "@/lib/mail/shortcuts";
import { useMailShortcuts } from "@/lib/mail/use-mail-shortcuts";
import type { MailThreadSummary } from "@/lib/mail/types";
import { cn } from "@/lib/utils";
import { shortDate } from "@/lib/mail/date-format";

export function PersonPane({
  row,
  onOpenThread,
  zoom,
  onZoomAdjust,
  onArchiveAll,
  onDeleteAll,
  onToggleRead,
  onArchiveThread,
  onTrashThread,
}: {
  row: PersonRow;
  onOpenThread: (t: MailThreadSummary) => void;
  /**
   * The reader's text size, the same number the thread reader uses.
   *
   * This pane is read the way a thread is read, so it is sized the way a
   * thread is sized — one setting for both, rather than a pane that stays
   * small for a reader who has said once that they want their mail bigger.
   */
  zoom: number;
  onZoomAdjust: (delta: number) => void;
  /** Every thread here at once. */
  onArchiveAll: () => void;
  onDeleteAll: () => void;
  /** One thread, the way the list rows do it. */
  onToggleRead: (rows: MailThreadSummary[], label: string) => void;
  onArchiveThread: (t: MailThreadSummary) => void;
  onTrashThread: (t: MailThreadSummary) => void;
}) {
  // `t` is the thread in the map below, so the dictionary is `say` here.
  const say = useMailT();
  // Right-click on an address: copy it, or write to it — the same menu an
  // address gets in the thread header and the recipient chips.
  const { openAddressMenu, addressMenu } = useAddressMenu();
  const draftKeys = useThreadDraftKeys();
  const pinchRef = React.useRef<HTMLDivElement | null>(null);
  usePinchZoom(pinchRef, onZoomAdjust, true);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [peopleExpanded, setPeopleExpanded] = React.useState(false);
  const shortcuts = useMailShortcuts();

  /**
   * The same two keys the reader answers, about everything here.
   *
   * A person selected is a pile of conversations selected, and archive and
   * delete are what the buttons above offer for it — but only to the
   * pointer, until now. Delete asks first, as the button does: this is
   * every thread with somebody, not one.
   */
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (event.key === "Escape" && confirmDelete) {
        event.preventDefault();
        setConfirmDelete(false);
        return;
      }
      // While the question is on screen the answer belongs to it, not to
      // another press of the key that asked.
      if (confirmDelete) return;
      const action = actionForEvent(event, shortcuts);
      if (action !== "archive" && action !== "delete") return;
      event.preventDefault();
      // A held key is not a second wish — the rule the reader keeps.
      if (event.repeat) return;
      if (action === "archive") onArchiveAll();
      else setConfirmDelete(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts, confirmDelete, onArchiveAll]);

  React.useEffect(() => {
    setPeopleExpanded(false);
  }, [row.key]);

  const anyUnread = row.threads.some((t) => t.unread);
  const count = row.threads.length;
  const newest = row.threads[0];
  // Strip self: list payloads can still list a personal alias as external.
  const participants = (newest.externalParticipants ?? []).filter(
    (p) =>
      p.email &&
      !isOwnPersonalAddress(p.email) &&
      normalizeEmail(p.email) !== normalizeEmail(newest.account)
  );
  // One person under several addresses lists them all: the row has kept
  // every address they wrote from (see groupThreadsByPerson).
  const listed =
    !row.isGroup && row.people.length > 1
      ? row.people
      : participants.length > 0
        ? participants
        : row.email
          ? [{ name: row.name, email: row.email }]
          : [];
  // Three names fit a header. The rest sit behind a count the reader
  // can open. First names are not a fallback: two Davids then look like one.
  const PEOPLE_HEADER_CAP = 3;
  const hiddenCount = peopleExpanded
    ? 0
    : Math.max(0, listed.length - PEOPLE_HEADER_CAP);
  const shownPeople =
    hiddenCount > 0 ? listed.slice(0, PEOPLE_HEADER_CAP) : listed;
  // The heading has said the name. A line under it that says it again,
  // once per address, says nothing.
  const sameAsHeading = (name: string) =>
    name.trim().toLowerCase() === row.name.trim().toLowerCase();
  const meta = [
    row.crmName && !sameAsHeading(row.crmName) ? row.crmName : null,
    row.threads.length === 1
      ? say("openThreadOne")
      : say("openThreadMany", { count: row.threads.length }),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mail-thread-surface flex min-h-0 flex-1 flex-col bg-[var(--mail-thread)]">
      {/* The size control sits above the scroll, and outside what it
          sizes: a pill that grew with the text it was setting would move
          under the hand that was pressing it. Same reason the reader
          keeps its own pill on the toolbar rather than in the thread. */}
      <div className="flex shrink-0 items-center justify-end px-4 pt-3">
        <ZoomControls zoom={zoom} onAdjust={onZoomAdjust} />
      </div>
      <div ref={pinchRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className="mx-auto w-full max-w-2xl px-8 pb-8 pt-4"
          style={{ zoom }}
        >
          <div className="flex items-start gap-4 [--mail-person-stack-ring:var(--mail-thread)]">
            <PersonAvatar row={row} size={48} />
            <div className="min-w-0">
              <h2 className="truncate font-serif text-2xl font-bold text-[var(--mail-thread-fg)]">
                {row.name}
              </h2>
              <div className="mt-0.5 text-xs">
                {shownPeople.map((person) => {
                  const name = person.name.trim();
                  const named =
                    name.length > 0 &&
                    !sameAsHeading(name) &&
                    normalizeEmail(name) !== normalizeEmail(person.email);
                  return (
                    <p key={person.email} className="min-w-0 break-words">
                      {/* The address writes to the person: a click opens a
                          new message to it, as in the thread header and the
                          message bodies. */}
                      {named ? (
                        <>
                          <span className="text-[var(--mail-thread-muted)]">
                            {name}
                          </span>
                          <span className="text-muted-foreground">
                            {" · "}
                            <button
                              type="button"
                              className="hover:underline"
                              title={say("writeToThisAddress")}
                              onClick={() =>
                                requestMailComposeTo(person.email)
                              }
                              onContextMenu={(e) =>
                                openAddressMenu(e, person.email, name)
                              }
                            >
                              {person.email}
                            </button>
                          </span>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="text-muted-foreground hover:underline"
                          title={say("writeToThisAddress")}
                          onClick={() => requestMailComposeTo(person.email)}
                          onContextMenu={(e) =>
                            openAddressMenu(e, person.email, row.name)
                          }
                        >
                          {person.email}
                        </button>
                      )}
                    </p>
                  );
                })}
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-[var(--mail-thread-fg)]"
                    onClick={() => setPeopleExpanded(true)}
                  >
                    {say("personListMore", { count: hiddenCount })}
                  </button>
                ) : null}
                {meta ? (
                  <p className="text-muted-foreground">{meta}</p>
                ) : null}
              </div>
            </div>
          </div>
          {addressMenu}

          {/*
            What can be done to all of it, under the name it applies to.

            The same round ghost buttons the thread reader wears, so the two
            panes read as one app — but with the words next to the icons.
            Above a thread an icon is enough, because there is one thing it
            can mean; here the same icon would be asking about every
            conversation on the page at once, and that is worth saying.
          */}
          <div className="mt-4 flex flex-wrap items-center gap-1">
            <button
              type="button"
              className={cn(THREAD_ACTION_CLASS, PERSON_ACTION_CLASS)}
              onClick={() => onToggleRead(row.threads, row.name)}
            >
              <MailDotIcon aria-hidden />
              {anyUnread
                ? say("markAllAsRead", { count })
                : say("markAsUnread")}
            </button>
            <button
              type="button"
              className={cn(THREAD_ACTION_CLASS, PERSON_ACTION_CLASS)}
              title={`${say("archiveAllWith", { count, name: row.name })} (${formatShortcut(
                shortcuts.archive
              )})`}
              onClick={onArchiveAll}
            >
              <Archive aria-hidden />
              {say("archiveAll")}
            </button>
            <button
              type="button"
              className={cn(
                THREAD_ACTION_CLASS,
                PERSON_ACTION_CLASS,
                "hover:bg-red-50 hover:text-red-600"
              )}
              title={`${say("deleteAllWith", { count, name: row.name })} (${formatShortcut(
                shortcuts.delete
              )})`}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 aria-hidden />
              {say("deleteAll")}
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-2.5">
            {row.threads.map((t) => {
              const hasDraft = draftKeys.has(
                threadDraftKey(t.account, t.threadId)
              );
              return (
                /*
                  A div that behaves as a button, not a button.

                  The actions below are buttons, and a button inside a button
                  is not something a browser will build — the inner ones get
                  lifted out and the card stops being one thing to click. So
                  the card takes the role and the key handling by hand.
                */
                <div
                  key={threadKey(t)}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenThread(t)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onOpenThread(t);
                  }}
                  className="group/card mail-bubble-card cursor-pointer rounded-xl border border-[var(--mail-bubble-other-border)] bg-[var(--mail-bubble-other)] px-4 py-3 text-left outline-none transition-colors hover:bg-[var(--mail-row-hover)] focus-visible:ring-2 focus-visible:ring-teal-600/50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-[var(--mail-thread-fg)]">
                      {t.unread ? (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mail-accent)]" />
                      ) : null}
                      <span className="truncate">{t.subject}</span>
                      {hasDraft ? <DraftBadge /> : null}
                    </p>
                    {/* The date stands down for the actions rather than
                        shuffling along beside them, the way a list row
                        does it — the card keeps one width either way. */}
                    <p className="shrink-0 text-xs text-[var(--mail-thread-muted)] group-hover/card:hidden">
                      {shortDate(t.lastAt)}
                    </p>
                    <div
                      className="hidden shrink-0 items-center gap-0.5 group-hover/card:flex"
                      /* The card underneath opens the thread; these do not. */
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        title={say(t.unread ? "markAsRead" : "markAsUnread")}
                        aria-label={say(
                          t.unread ? "markAsRead" : "markAsUnread"
                        )}
                        className={CARD_ACTION_CLASS}
                        onClick={() => onToggleRead([t], t.subject)}
                      >
                        <MailDotIcon className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title={say("actionArchive")}
                        aria-label={say("actionArchive")}
                        className={CARD_ACTION_CLASS}
                        onClick={() => onArchiveThread(t)}
                      >
                        <Archive className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        title={say("actionDelete")}
                        aria-label={say("actionDelete")}
                        className={cn(
                          CARD_ACTION_CLASS,
                          "hover:bg-red-50 hover:text-red-600"
                        )}
                        onClick={() => onTrashThread(t)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                  {/* Two lines, not one. A card here has the width of the
                      reading pane to fill and is the only thing saying what
                      a thread is about; one clipped line was spending that
                      room on an ellipsis. */}
                  <p className="mt-1 line-clamp-2 text-xs text-[var(--mail-thread-muted)]">
                    {t.messageCount === 1
                      ? say("threadMessageOne")
                      : say("threadMessageMany", { count: t.messageCount })}{" "}
                    ·{" "}
                    {t.snippet}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {confirmDelete ? (
        <SettingsDialog
          title={say("deleteThreadsAsk", { count })}
          width="w-[400px]"
          bare
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button
                type="button"
                className={settingsSecondaryButton}
                onClick={() => setConfirmDelete(false)}
              >
                {say("cancel")}
              </button>
              <button
                type="button"
                autoFocus
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                onClick={() => {
                  setConfirmDelete(false);
                  onDeleteAll();
                }}
              >
                {say("deleteAll")}
              </button>
            </>
          }
        >
          <p className="text-sm text-stone-600">
            {say("deleteThreadsExplain")}
          </p>
        </SettingsDialog>
      ) : null}
    </div>
  );
}

/**
 * A thread-reader action button, wearing a word.
 *
 * `THREAD_ACTION_CLASS` is sized for a circle with nothing but an icon in
 * it, so the width goes and the row is laid out rather than stacked — a
 * block button puts the label under the icon. The icon comes down to the
 * size of the text beside it; nineteen pixels is a glyph standing alone.
 */
const PERSON_ACTION_CLASS =
  "inline-flex w-auto items-center gap-2 px-3 text-sm [&_svg]:size-4";

/** The look of a quick action on a thread card, matching the list rows. */
const CARD_ACTION_CLASS =
  "rounded p-1 text-[var(--mail-thread-muted)] hover:bg-[var(--mail-chrome-hover)] hover:text-[var(--mail-thread-fg)]";

// ---------------------------------------------------------------------------
// Thread pane
// ---------------------------------------------------------------------------
