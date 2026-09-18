/**
 * Keyboard shortcuts for an open thread.
 *
 * The defaults are Apple Mail's, because this is a Mac app and that is what a
 * Mac mail client does. Gmail's single letters exist because a browser owns
 * every Cmd key; they are a workaround, not a standard.
 *
 * A reader can change any of them — see `MailShortcutsPanel`. Only the
 * changes are stored, so a default that moves later moves for everyone who
 * never touched it.
 *
 * No React here, on purpose: this is the part a suite reads. The hook that
 * subscribes to it is in `use-mail-shortcuts`.
 *
 * Two keys are not ours to take. macOS binds Cmd+M to Minimize in the app
 * menu, and the page never sees it, so Move to folder is on Cmd+Shift+M.
 * Cmd+R is browser reload, which is why these only fire with a thread open
 * and the focus outside a field.
 *
 * Send, focus-message, and float-message are the exceptions, and have to be:
 * they are pressed from inside the message being written. The composers
 * listen for those themselves rather than through the thread handler, which
 * stands down wherever a reply is written.
 */
import type { MailStringKey } from "@/lib/mail/i18n-strings";


export type MailShortcutAction =
  | "reply"
  | "replyAll"
  | "forward"
  | "send"
  | "snooze"
  | "archive"
  | "delete"
  | "toggleUnread"
  | "moveToFolder"
  | "print"
  | "popOut"
  | "floatMessage"
  | "togglePin"
  | "expandList"
  | "focusThread"
  | "focusMessage";

export type MailShortcut = {
  /**
   * `KeyboardEvent.key`, lowercased for letters. Not `code`: `code` is the
   * physical key, and on a Danish keyboard that is not the letter printed on
   * it. What the reader presses is what they see.
   */
  key: string;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
};

/**
 * The settings list, in groups.
 *
 * Sixteen keys on one card is a wall. A heading names the kind of work, and
 * the card under it holds only those rows. One scroll, not a page per group.
 */
export const MAIL_SHORTCUT_GROUPS: {
  label: MailStringKey;
  actions: readonly MailShortcutAction[];
}[] = [
  {
    label: "shortcutGroupCompose",
    actions: ["reply", "replyAll", "forward", "send"],
  },
  {
    label: "shortcutGroupTriage",
    actions: [
      "snooze",
      "archive",
      "delete",
      "toggleUnread",
      "moveToFolder",
      "togglePin",
    ],
  },
  {
    label: "shortcutGroupView",
    actions: [
      "expandList",
      "popOut",
      "floatMessage",
      "focusThread",
      "focusMessage",
      "print",
    ],
  },
];

/** Flattened group order. A clash goes to the earlier action in this list. */
export const MAIL_SHORTCUT_ACTIONS: MailShortcutAction[] =
  MAIL_SHORTCUT_GROUPS.flatMap((group) => [...group.actions]);

/** What each action is called, as keys into `@/lib/mail/i18n`. */
export const MAIL_SHORTCUT_LABELS: Record<MailShortcutAction, MailStringKey> = {
  reply: "actionReply",
  replyAll: "actionReplyAll",
  forward: "actionForward",
  send: "actionSend",
  snooze: "actionSnooze",
  archive: "actionArchive",
  delete: "actionDelete",
  toggleUnread: "actionToggleUnread",
  moveToFolder: "actionMoveToFolder",
  print: "actionPrint",
  popOut: "popOutChat",
  floatMessage: "actionFloatMessage",
  togglePin: "actionTogglePin",
  expandList: "actionExpandList",
  focusThread: "actionFocusThread",
  focusMessage: "actionFocusMessage",
};

export const DEFAULT_MAIL_SHORTCUTS: Record<MailShortcutAction, MailShortcut> = {
  reply: { key: "r", meta: true },
  replyAll: { key: "r", meta: true, shift: true },
  forward: { key: "f", meta: true, shift: true },
  /**
   * One of the two shortcuts that fire while typing.
   *
   * Every other action here is refused when the focus is in a field, so that
   * Cmd+R still reloads and a reply can contain the letter R. Send has to
   * work from inside the message being sent, so the composer listens for it
   * itself rather than going through the thread handler.
   */
  send: { key: "enter", meta: true },
  snooze: { key: "k", meta: true },
  archive: { key: "a", meta: true, shift: true },
  delete: { key: "backspace" },
  toggleUnread: { key: "u", meta: true },
  moveToFolder: { key: "m", meta: true, shift: true },
  print: { key: "p", meta: true },
  /**
   * The letter names the surface: C for the chat window. Shift+Cmd, same
   * family as floating the message being written.
   */
  popOut: { key: "c", meta: true, shift: true },
  /**
   * The other shortcut that fires while typing.
   *
   * ⇧⌘P is pressed from inside the message it moves. The composer listens
   * for it itself, the same arrangement Send uses. The letter names the
   * picture-in-picture card.
   */
  floatMessage: { key: "p", meta: true, shift: true },
  /**
   * No mail client has a convention for this, so it takes a free key beside
   * the rest of the Cmd+Shift group. Not Cmd+I: the composer's italics.
   */
  togglePin: { key: "i", meta: true, shift: true },
  /**
   * How much room this pane gets. Option+Cmd, not Shift+Cmd — Shift+Cmd is
   * the action family (archive, forward, pop out). The letter names the
   * pane: list, thread, or the message being written.
   */
  expandList: { key: "l", meta: true, alt: true },
  focusThread: { key: "t", meta: true, alt: true },
  /**
   * The other shortcut that fires while typing.
   *
   * Focus-message is pressed from inside the message it enlarges — a reply
   * or a new email. The composer listens for it itself, the same
   * arrangement Send uses.
   */
  focusMessage: { key: "r", meta: true, alt: true },
};

const STORAGE_KEY = "redd-plan-mail-shortcuts";
export const MAIL_SHORTCUTS_EVENT = "redd-plan-mail-shortcuts-changed";

/**
 * A laptop's Delete key and a full keyboard's Backspace are the same intent.
 * Forward-delete reports "Delete", so treat the two as one.
 */
function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === "delete") return "backspace";
  return lower;
}

/**
 * The letter a press meant, when Option has already turned it into a mark.
 *
 * Cmd+Option+F arrives as "ƒ", Cmd+Option+L as "¬". The search box already
 * reads `code` for that reason. A binding is the letter on the key.
 */
function eventLetter(event: KeyboardEvent): string | null {
  const code = event.code;
  if (!code || code.length !== 4 || !code.toLowerCase().startsWith("key")) {
    return null;
  }
  return code.slice(3).toLowerCase();
}

export function shortcutMatchesEvent(
  event: KeyboardEvent,
  shortcut: MailShortcut
): boolean {
  const wanted = normalizeKey(shortcut.key);
  const typed = normalizeKey(event.key);
  if (typed !== wanted) {
    // Option is held, and the character is not the letter. Trust the key.
    if (!event.altKey || eventLetter(event) !== wanted) return false;
  }
  if (event.metaKey !== Boolean(shortcut.meta)) return false;
  if (event.shiftKey !== Boolean(shortcut.shift)) return false;
  if (event.altKey !== Boolean(shortcut.alt)) return false;
  if (event.ctrlKey !== Boolean(shortcut.ctrl)) return false;
  return true;
}

/** The action a key press asks for, if any. */
/**
 * Which composer a send key belongs to, when there is more than one.
 *
 * A reply can be open in the thread and in the floating card at the same
 * time, and two listeners both answering the key would send from whichever
 * heard it first — not a thing to leave to chance with mail. So each sends
 * only when the caret is inside it.
 *
 * A caret that is nowhere is the exception: the reader pressed the key after
 * clicking the thread, or the window has just come back, and there is one
 * composer they can mean — the one docked in the pane. The card answers for
 * itself and nothing else.
 */
export function sendsFromHere(input: {
  /** The caret is inside this pane. */
  caretHere: boolean;
  /** The caret is nowhere in particular: the body, or nothing at all. */
  caretNowhere: boolean;
  /** This is the floating card rather than the pane in the thread. */
  floating: boolean;
}): boolean {
  if (input.caretHere) return true;
  return input.caretNowhere && !input.floating;
}

export function actionForEvent(
  event: KeyboardEvent,
  shortcuts: Record<MailShortcutAction, MailShortcut>
): MailShortcutAction | null {
  for (const action of MAIL_SHORTCUT_ACTIONS) {
    if (shortcutMatchesEvent(event, shortcuts[action])) return action;
  }
  return null;
}

const KEY_SYMBOLS: Record<string, string> = {
  backspace: "⌫",
  enter: "↩",
  escape: "⎋",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  " ": "Space",
  tab: "⇥",
};

/** "⌘⇧R" — the way a Mac writes it, for the dialog and the tooltips. */
export function formatShortcut(shortcut: MailShortcut): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push("⌃");
  if (shortcut.alt) parts.push("⌥");
  if (shortcut.shift) parts.push("⇧");
  if (shortcut.meta) parts.push("⌘");
  const key = normalizeKey(shortcut.key);
  parts.push(KEY_SYMBOLS[key] ?? key.toUpperCase());
  return parts.join("");
}

/** True when two bindings would answer the same key press. */
export function sameShortcut(a: MailShortcut, b: MailShortcut): boolean {
  return (
    normalizeKey(a.key) === normalizeKey(b.key) &&
    Boolean(a.meta) === Boolean(b.meta) &&
    Boolean(a.shift) === Boolean(b.shift) &&
    Boolean(a.alt) === Boolean(b.alt) &&
    Boolean(a.ctrl) === Boolean(b.ctrl)
  );
}

/** Actions that share a binding with another action. */
export function conflictingActions(
  shortcuts: Record<MailShortcutAction, MailShortcut>
): Set<MailShortcutAction> {
  const clashing = new Set<MailShortcutAction>();
  for (const a of MAIL_SHORTCUT_ACTIONS) {
    for (const b of MAIL_SHORTCUT_ACTIONS) {
      if (a === b) continue;
      if (sameShortcut(shortcuts[a], shortcuts[b])) {
        clashing.add(a);
        clashing.add(b);
      }
    }
  }
  return clashing;
}

/**
 * A binding the operating system answers before the page does.
 *
 * Nothing can be bound to these, so the dialog says so instead of storing a
 * key that would never fire.
 */
/** Why the operating system answers this one first, as an i18n key. */
export function reservedReason(shortcut: MailShortcut): MailStringKey | null {
  const key = normalizeKey(shortcut.key);
  if (shortcut.meta && !shortcut.shift && !shortcut.alt && !shortcut.ctrl) {
    if (key === "m") return "reservedMinimize";
    if (key === "q") return "reservedQuit";
    if (key === "h") return "reservedHide";
    if (key === "w") return "reservedClose";
  }
  return null;
}

function readOverrides(): Partial<Record<MailShortcutAction, MailShortcut>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Partial<Record<MailShortcutAction, MailShortcut>> = {};
    for (const action of MAIL_SHORTCUT_ACTIONS) {
      const value = (parsed as Record<string, unknown>)[action];
      if (!value || typeof value !== "object") continue;
      const candidate = value as MailShortcut;
      if (typeof candidate.key !== "string" || !candidate.key) continue;
      out[action] = {
        key: normalizeKey(candidate.key),
        meta: Boolean(candidate.meta),
        shift: Boolean(candidate.shift),
        alt: Boolean(candidate.alt),
        ctrl: Boolean(candidate.ctrl),
      };
    }
    return out;
  } catch {
    return {};
  }
}

let cached: Record<MailShortcutAction, MailShortcut> | null = null;

export function readMailShortcuts(): Record<MailShortcutAction, MailShortcut> {
  // useSyncExternalStore compares snapshots by identity, so the same object
  // has to come back until something actually changes.
  if (cached) return cached;
  cached = { ...DEFAULT_MAIL_SHORTCUTS, ...readOverrides() };
  return cached;
}

export function setMailShortcut(
  action: MailShortcutAction,
  shortcut: MailShortcut | null
): void {
  const overrides = readOverrides();
  if (shortcut) overrides[action] = { ...shortcut, key: normalizeKey(shortcut.key) };
  else delete overrides[action];
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* private mode */
  }
  cached = null;
  window.dispatchEvent(new Event(MAIL_SHORTCUTS_EVENT));
}

export function resetMailShortcuts(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode */
  }
  cached = null;
  window.dispatchEvent(new Event(MAIL_SHORTCUTS_EVENT));
}

/** Notified whenever a binding changes, here or in another tab. */
export function subscribeMailShortcuts(onChange: () => void): () => void {
  const listener = () => {
    cached = null;
    onChange();
  };
  window.addEventListener(MAIL_SHORTCUTS_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(MAIL_SHORTCUTS_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * What the composer's formatting keys are called, for the buttons' tooltips.
 *
 * These are Quill's own bindings rather than the app's, so they are not in
 * the table above — but a button that has a key should say so, the way
 * every action in the reader's header does.
 */
export const FORMAT_SHORTCUTS = {
  bold: formatShortcut({ key: "b", meta: true }),
  italic: formatShortcut({ key: "i", meta: true }),
  underline: formatShortcut({ key: "u", meta: true }),
  link: formatShortcut({ key: "k", meta: true }),
} as const;
