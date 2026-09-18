/**
 * Thread keyboard shortcuts: matching, naming, and what cannot be bound.
 *
 * The defaults are Apple Mail's. A change to one of them is a change to what
 * a reader's fingers already do, so the defaults are asserted here by name and
 * not only by behaviour.
 */

import {
  actionForEvent,
  conflictingActions,
  DEFAULT_MAIL_SHORTCUTS,
  formatShortcut,
  MAIL_SHORTCUT_ACTIONS,
  MAIL_SHORTCUT_GROUPS,
  MAIL_SHORTCUT_LABELS,
  readMailShortcuts,
  reservedReason,
  resetMailShortcuts,
  sameShortcut,
  setMailShortcut,
  shortcutMatchesEvent,
} from "@/lib/mail/shortcuts";

import { check, suite } from "./harness.mjs";

/** A KeyboardEvent as the handler reads it. */
function press(key, mods = {}) {
  return {
    key,
    metaKey: Boolean(mods.meta),
    shiftKey: Boolean(mods.shift),
    altKey: Boolean(mods.alt),
    ctrlKey: Boolean(mods.ctrl),
  };
}

suite(async () => {
  const d = DEFAULT_MAIL_SHORTCUTS;

  // --- The defaults are Apple Mail's -------------------------------------

  check("Reply is Cmd+R", formatShortcut(d.reply) === "⌘R", formatShortcut(d.reply));
  // Apple's order is ⌃⌥⇧⌘ — Command sits closest to the key, as in ⇧⌘N for
  // New Folder. Writing it the other way round would look wrong in a menu.
  check(
    "Reply all is Cmd+Shift+R, written the way a Mac writes it",
    formatShortcut(d.replyAll) === "⇧⌘R",
    formatShortcut(d.replyAll)
  );
  check(
    "Forward is Cmd+Shift+F",
    formatShortcut(d.forward) === "⇧⌘F",
    formatShortcut(d.forward)
  );
  check(
    "Send is Cmd+Return",
    formatShortcut(d.send) === "⌘↩",
    formatShortcut(d.send)
  );
  check("Snooze is Cmd+K", formatShortcut(d.snooze) === "⌘K", formatShortcut(d.snooze));
  check("Delete is Backspace", formatShortcut(d.delete) === "⌫", formatShortcut(d.delete));
  check(
    "Archive is Cmd+Shift+A",
    formatShortcut(d.archive) === "⇧⌘A",
    formatShortcut(d.archive)
  );
  check(
    "Read or unread is Cmd+U",
    formatShortcut(d.toggleUnread) === "⌘U",
    formatShortcut(d.toggleUnread)
  );
  check(
    "Move to folder is Cmd+Shift+M, because macOS keeps Cmd+M",
    formatShortcut(d.moveToFolder) === "⇧⌘M",
    formatShortcut(d.moveToFolder)
  );
  check("Print is Cmd+P", formatShortcut(d.print) === "⌘P", formatShortcut(d.print));
  check(
    "Pop out chat is Cmd+Shift+C — the letter names the chat window",
    formatShortcut(d.popOut) === "⇧⌘C",
    formatShortcut(d.popOut)
  );
  check(
    "Float the message is Cmd+Shift+P — the letter names the picture-in-picture card",
    formatShortcut(d.floatMessage) === "⇧⌘P",
    formatShortcut(d.floatMessage)
  );

  check(
    "Pin or unpin is Cmd+Shift+I — no client has a convention, and Cmd+I is italics",
    formatShortcut(d.togglePin) === "⇧⌘I",
    formatShortcut(d.togglePin)
  );

  check(
    "Expand list is Option+Cmd+L — how much room the list gets",
    formatShortcut(d.expandList) === "⌥⌘L",
    formatShortcut(d.expandList)
  );
  check(
    "Focus thread is Option+Cmd+T",
    formatShortcut(d.focusThread) === "⌥⌘T",
    formatShortcut(d.focusThread)
  );
  check(
    "Focus message is Option+Cmd+R",
    formatShortcut(d.focusMessage) === "⌥⌘R",
    formatShortcut(d.focusMessage)
  );
  const grouped = MAIL_SHORTCUT_GROUPS.flatMap((group) => [...group.actions]);
  check(
    "every action sits in one group",
    grouped.join() === MAIL_SHORTCUT_ACTIONS.join() &&
      Object.keys(MAIL_SHORTCUT_LABELS).every((action) =>
        grouped.includes(action)
      ) &&
      grouped.length === Object.keys(MAIL_SHORTCUT_LABELS).length
  );
  check(
    "Compose is reply through send",
    MAIL_SHORTCUT_GROUPS[0].actions.join() === "reply,replyAll,forward,send"
  );
  check(
    "Triage is snooze through pin",
    MAIL_SHORTCUT_GROUPS[1].actions.join() ===
      "snooze,archive,delete,toggleUnread,moveToFolder,togglePin"
  );
  check(
    "View is the pane keys, the two small surfaces, and print",
    MAIL_SHORTCUT_GROUPS[2].actions.join() ===
      "expandList,popOut,floatMessage,focusThread,focusMessage,print"
  );
  check(
    "none of the three uses Shift — Shift+Cmd is the action family",
    !d.expandList.shift && !d.focusThread.shift && !d.focusMessage.shift
  );

  check("no two defaults share a key", conflictingActions(d).size === 0);

  // --- Matching -----------------------------------------------------------

  check("Cmd+R replies", actionForEvent(press("r", { meta: true }), d) === "reply");
  check(
    "Shift makes it reply all, not reply",
    actionForEvent(press("R", { meta: true, shift: true }), d) === "replyAll",
    actionForEvent(press("R", { meta: true, shift: true }), d)
  );
  check(
    "a bare R does nothing — single letters are not the scheme",
    actionForEvent(press("r"), d) === null
  );
  check(
    "Cmd+Shift+R does not also count as Cmd+R",
    !shortcutMatchesEvent(press("R", { meta: true, shift: true }), d.reply)
  );
  check("Backspace deletes", actionForEvent(press("Backspace"), d) === "delete");
  check(
    "Cmd+Shift+A archives",
    actionForEvent(press("A", { meta: true, shift: true }), d) === "archive"
  );
  check(
    "Cmd+Backspace is not delete — a bare Backspace is",
    actionForEvent(press("Backspace", { meta: true }), d) === null
  );
  check(
    "a full keyboard's forward-delete deletes too",
    actionForEvent(press("Delete"), d) === "delete"
  );
  check(
    "Cmd+Shift+P floats the message, Cmd+Shift+C pops the chat, and plain Cmd+P still prints",
    actionForEvent(press("P", { meta: true, shift: true }), d) ===
      "floatMessage" &&
      actionForEvent(press("c", { meta: true, shift: true }), d) === "popOut" &&
      actionForEvent(press("p", { meta: true }), d) === "print"
  );
  check(
    "Cmd+Shift+I pins, and plain Cmd+I is left to the composer",
    actionForEvent(press("I", { meta: true, shift: true }), d) === "togglePin" &&
      actionForEvent(press("i", { meta: true }), d) === null
  );
  check(
    "Cmd+Return sends",
    actionForEvent(press("Enter", { meta: true }), d) === "send"
  );
  check(
    "a bare Return is not send — it is a new line in a reply",
    actionForEvent(press("Enter"), d) === null
  );
  check(
    "an unbound combination is left alone",
    actionForEvent(press("j", { meta: true, alt: true }), d) === null
  );
  check(
    "Option+Cmd+L expands the list, and a bare Cmd+L is left alone",
    actionForEvent(press("l", { meta: true, alt: true }), d) === "expandList" &&
      actionForEvent(press("l", { meta: true }), d) === null
  );
  check(
    "Option+Cmd+T focuses the thread, Option+Cmd+R the message being written",
    actionForEvent(press("t", { meta: true, alt: true }), d) === "focusThread" &&
      actionForEvent(press("r", { meta: true, alt: true }), d) === "focusMessage"
  );
  check(
    "Option+Cmd+L still matches when macOS turns the key into ¬",
    shortcutMatchesEvent(
      { ...press("¬", { meta: true, alt: true }), code: "KeyL" },
      d.expandList
    )
  );

  // --- What the system takes first ---------------------------------------

  check(
    "Cmd+M is refused: macOS minimizes with it",
    Boolean(reservedReason({ key: "m", meta: true })),
    reservedReason({ key: "m", meta: true }) ?? ""
  );
  check(
    "Cmd+Q, Cmd+W and Cmd+H are refused too",
    ["q", "w", "h"].every((key) => reservedReason({ key, meta: true }))
  );
  check(
    "Cmd+Shift+M is fine — the menu only claims the plain one",
    reservedReason({ key: "m", meta: true, shift: true }) === null
  );
  check(
    "an ordinary binding is not refused",
    reservedReason({ key: "r", meta: true }) === null
  );

  // --- Conflicts ----------------------------------------------------------

  const clashing = { ...d, print: { key: "r", meta: true } };
  check(
    "two actions on one key are both reported",
    conflictingActions(clashing).has("print") &&
      conflictingActions(clashing).has("reply")
  );
  check(
    "the earlier action in the list answers the press",
    actionForEvent(press("r", { meta: true }), clashing) === "reply",
    `${MAIL_SHORTCUT_ACTIONS.indexOf("reply")} before ${MAIL_SHORTCUT_ACTIONS.indexOf("print")}`
  );

  check(
    "the same binding written two ways compares equal",
    sameShortcut({ key: "R", meta: true }, { key: "r", meta: true, shift: false })
  );

  // --- Overrides store ----------------------------------------------------

  // Node has no window. The store reads localStorage on first use and
  // keeps a cached snapshot, the way useSyncExternalStore needs.
  const stored = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => (stored.has(k) ? stored.get(k) : null),
      setItem: (k, v) => stored.set(k, v),
      removeItem: (k) => stored.delete(k),
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  resetMailShortcuts();
  check(
    "a first read is the defaults, including the three view shortcuts",
    readMailShortcuts().expandList.key === "l" &&
      readMailShortcuts().focusThread.alt === true &&
      readMailShortcuts().focusMessage.meta === true
  );

  setMailShortcut("expandList", { key: "j", meta: true, alt: true });
  setMailShortcut("focusThread", { key: "y", meta: true, alt: true });
  setMailShortcut("focusMessage", { key: "u", meta: true, alt: true });
  const rebound = readMailShortcuts();
  check(
    "a saved binding is what a later read returns",
    rebound.expandList.key === "j" &&
      rebound.focusThread.key === "y" &&
      rebound.focusMessage.key === "u" &&
      rebound.expandList.alt &&
      rebound.focusThread.meta &&
      rebound.focusMessage.alt,
    JSON.stringify({
      expandList: rebound.expandList,
      focusThread: rebound.focusThread,
      focusMessage: rebound.focusMessage,
    })
  );
  check(
    "an untouched default is still the default after a save",
    rebound.reply.key === "r" && !rebound.reply.alt
  );

  setMailShortcut("expandList", null);
  check(
    "clearing one override puts that action back on its default",
    readMailShortcuts().expandList.key === "l" &&
      readMailShortcuts().focusThread.key === "y"
  );

  resetMailShortcuts();
  check(
    "reset puts every view shortcut back on Option+Cmd",
    formatShortcut(readMailShortcuts().expandList) === "⌥⌘L" &&
      formatShortcut(readMailShortcuts().focusThread) === "⌥⌘T" &&
      formatShortcut(readMailShortcuts().focusMessage) === "⌥⌘R"
  );
});
