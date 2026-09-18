/**
 * The reader window: one thread in an ordinary window of its own.
 *
 * Not the chat popout. That one is a small always-on-top card for talking;
 * this one is the thread reader itself — header, actions, reply box — with
 * the system's own title bar and buttons, the way Outlook opens a message.
 * Double-clicking a thread in the list asks for it.
 */

import {
  isNativeShell,
  notifyMailChanged,
  openMailReaderWindow,
} from "@/lib/native-shell";
import type { PersonRow } from "@/lib/mail/person-participants";

export const READER_WINDOW_WIDTH = 840;
export const READER_WINDOW_HEIGHT = 900;

/**
 * What the list knows about the thread, handed to the window on open.
 *
 * The window has no list, and the list is where the copies live: a mail
 * cc'd into two mailboxes is one row standing for both (see thread-copies),
 * and an archive or delete must take every copy or the row survives its own
 * deletion. So the copies the row stood for at the moment of opening travel
 * across, the same localStorage way the chat popout hands its seed over.
 * The snooze and unread state ride along for the reader's buttons.
 */
export type ReaderWindowHandoff = {
  copies: { account: string; threadId: string }[];
  snoozedUntil?: string;
  unread?: boolean;
};

const HANDOFF_PREFIX = "redd-plan-mail-reader-handoff:";
const HANDOFF_TTL_MS = 60_000;

function handoffKey(account: string, threadId: string): string {
  return `${HANDOFF_PREFIX}${account}|${threadId}`;
}

export function writeReaderHandoff(
  account: string,
  threadId: string,
  handoff: ReaderWindowHandoff
): void {
  try {
    window.localStorage.setItem(
      handoffKey(account, threadId),
      JSON.stringify({ at: Date.now(), ...handoff })
    );
  } catch {
    // No storage: the window acts on its own copy alone, which is still
    // the right copy — just not every copy.
  }
}

/**
 * Take a note the opener left, and keep it as this window's own.
 *
 * The note is one-shot in localStorage — read once and taken down, so a
 * later window for the same thread does not inherit a stale one. But the
 * window that took it may ask again: React runs a state initializer twice
 * in development, and a reload runs it from nothing. So the first read
 * moves the note into sessionStorage, which is this window's alone, and
 * every read after that answers from there. The age check is for the note
 * in transit; a note this window already holds is as old as the window.
 */
function takeNote<T>(
  key: string,
  parse: (raw: string, fresh: boolean) => T | null
): T | null {
  try {
    const kept = window.sessionStorage.getItem(key);
    if (kept) return parse(kept, false);
  } catch {
    /* no sessionStorage: the note is read once, which is usually enough */
  }
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    window.localStorage.removeItem(key);
    const value = parse(raw, true);
    if (value) {
      try {
        window.sessionStorage.setItem(key, raw);
      } catch {
        /* see above */
      }
    }
    return value;
  } catch {
    return null;
  }
}

/** What the opener knew about this thread, if it left a note. */
export function readReaderHandoff(
  account: string,
  threadId: string
): ReaderWindowHandoff | null {
  return takeNote(handoffKey(account, threadId), (raw, fresh) => {
    const parsed = JSON.parse(raw) as ReaderWindowHandoff & { at?: number };
    if (fresh && (!parsed?.at || Date.now() - parsed.at > HANDOFF_TTL_MS)) {
      return null;
    }
    if (!Array.isArray(parsed?.copies)) return null;
    return {
      copies: parsed.copies.filter((c) => c?.account && c?.threadId),
      snoozedUntil: parsed.snoozedUntil,
      unread: parsed.unread,
    };
  });
}

/**
 * Open a thread in its own window. Desktop shells get a real window; a
 * browser gets a `window.open` popup on the same one-document arrangement
 * the chat popout uses, named per thread so a second ask refocuses it.
 */
export async function openMailThreadWindow(input: {
  account: string;
  threadId: string;
  name: string;
  email: string;
  subject: string;
  handoff?: ReaderWindowHandoff;
}): Promise<void> {
  const { handoff, ...target } = input;
  if (handoff) writeReaderHandoff(input.account, input.threadId, handoff);
  if (isNativeShell()) {
    await openMailReaderWindow(target);
    return;
  }
  const params = new URLSearchParams({
    reader: "1",
    account: input.account,
    thread: input.threadId,
    name: input.name,
    email: input.email,
    subject: input.subject,
  });
  const windowName = `mail-reader-${input.account}-${input.threadId}`.replace(
    /[^\w-]/g,
    "_"
  );
  const popup = window.open(
    `${window.location.pathname}?${params.toString()}`,
    windowName,
    `popup=yes,width=${READER_WINDOW_WIDTH},height=${READER_WINDOW_HEIGHT}`
  );
  if (!popup) {
    throw new Error("Popup blocked — allow popups for this site");
  }
  popup.focus();
}

/**
 * What the list knows about a person, handed to their window on open.
 *
 * The window has no list to work a person out from — who they are, which
 * conversations are theirs — so the row itself travels, the same
 * localStorage way as a thread's copies. The window keeps it after that
 * (see PersonReaderWindow), so the note is one-shot here too.
 */
export type PersonWindowHandoff = { row: PersonRow };

const PERSON_HANDOFF_PREFIX = "redd-plan-mail-person-handoff:";

function personHandoffKey(key: string): string {
  return `${PERSON_HANDOFF_PREFIX}${key}`;
}

/** The row the opener handed over, if it left one — see takeNote. */
export function readPersonHandoff(key: string): PersonWindowHandoff | null {
  return takeNote(personHandoffKey(key), (raw, fresh) => {
    const parsed = JSON.parse(raw) as PersonWindowHandoff & { at?: number };
    if (fresh && (!parsed?.at || Date.now() - parsed.at > HANDOFF_TTL_MS)) {
      return null;
    }
    if (!parsed?.row || !Array.isArray(parsed.row.threads)) return null;
    return { row: parsed.row };
  });
}

/**
 * Open a person's mail in its own window — the people view's reading pane,
 * or the one conversation when that is all there is. Desktop shells get a
 * real window, a browser a popup, the same arrangement as a thread.
 */
export async function openMailPersonWindow(row: PersonRow): Promise<void> {
  try {
    window.localStorage.setItem(
      personHandoffKey(row.key),
      JSON.stringify({ at: Date.now(), row })
    );
  } catch {
    // No storage: the window opens with nothing to show and says so.
  }
  if (isNativeShell()) {
    await openMailReaderWindow({
      account: "",
      threadId: "",
      name: row.name,
      email: row.email,
      subject: "",
      person: row.key,
    });
    return;
  }
  const params = new URLSearchParams({
    reader: "1",
    person: row.key,
    name: row.name,
    email: row.email,
  });
  const windowName = `mail-reader-person-${row.key}`.replace(/[^\w-]/g, "_");
  const popup = window.open(
    `${window.location.pathname}?${params.toString()}`,
    windowName,
    `popup=yes,width=${READER_WINDOW_WIDTH},height=${READER_WINDOW_HEIGHT}`
  );
  if (!popup) {
    throw new Error("Popup blocked — allow popups for this site");
  }
  popup.focus();
}

/**
 * Cross-window "this thread was archived / deleted / moved" signal, so the
 * main list drops the row now rather than at the next poll. The same two
 * channels as the chat popout's sent signal: a localStorage write for
 * browsers, a Tauri event for the desktop shells, where cross-window
 * storage events are unreliable.
 */
export const MAIL_CHANGED_KEY = "redd-plan-mail-thread-changed";

export function signalMailChanged(account: string, threadId: string): void {
  try {
    window.localStorage.setItem(
      MAIL_CHANGED_KEY,
      JSON.stringify({ account, threadId, at: Date.now() })
    );
  } catch {}
  void notifyMailChanged({ account, threadId }).catch(() => {});
}
