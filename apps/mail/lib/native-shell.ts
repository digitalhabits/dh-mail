/**
 * Helpers for the Tauri Mac desktop shell.
 * The shell injects `window.__TAURI__` (withGlobalTauri) and sets a
 * product-specific userAgent marker so the web UI can adapt.
 */

type TauriInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

function tauriInvoke(): TauriInvoke | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    __TAURI__?: {
      core?: { invoke?: TauriInvoke };
      opener?: { openUrl?: (url: string) => Promise<void> };
    };
    __TAURI_INTERNALS__?: { invoke?: TauriInvoke };
  };
  return w.__TAURI__?.core?.invoke ?? w.__TAURI_INTERNALS__?.invoke ?? null;
}

function tauriOpenUrl(): ((url: string) => Promise<void>) | null {
  if (typeof window === "undefined") return null;
  const openUrl = (
    window as unknown as {
      __TAURI__?: { opener?: { openUrl?: (url: string) => Promise<void> } };
    }
  ).__TAURI__?.opener?.openUrl;
  return openUrl ?? null;
}

/** True when running inside the Tauri desktop shell (call client-side only). */
export function isNativeShell(): boolean {
  return tauriInvoke() != null;
}

/** Begin an OS window drag (no-op outside the desktop shell). */
export async function startWindowDragging(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  const w = window as unknown as {
    __TAURI__?: {
      window?: {
        getCurrentWindow?: () => { startDragging: () => Promise<void> };
      };
    };
  };
  const getCurrent = w.__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    await getCurrent().startDragging();
    return;
  }
  await invoke("plugin:window|start_dragging");
}

const WINDOW_DRAG_MOVE_PX = 4;

/**
 * On native shells: after a short pointer move, drag the window.
 * A click without that move still fires normally (buttons, menus).
 */
export function beginNativeWindowDragOnMove(event: {
  button: number;
  clientX: number;
  clientY: number;
}): void {
  if (typeof window === "undefined") return;
  if (event.button !== 0) return;
  if (!isNativeShell()) return;

  const startX = event.clientX;
  const startY = event.clientY;
  let started = false;
  const thresholdSq = WINDOW_DRAG_MOVE_PX * WINDOW_DRAG_MOVE_PX;

  const onMove = (ev: PointerEvent) => {
    if (started) return;
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (dx * dx + dy * dy < thresholdSq) return;
    started = true;
    cleanup();
    void startWindowDragging();
  };

  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", cleanup);
    window.removeEventListener("pointercancel", cleanup);
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", cleanup);
  window.addEventListener("pointercancel", cleanup);
}

/**
 * True in the Digital Habits: Mail Mac app.
 * Detected via the userAgent set in `src-tauri/tauri.conf.json`.
 */
export function isMailOnlyShell(): boolean {
  if (typeof navigator === "undefined") return false;
  return /dh-mail-native/i.test(navigator.userAgent);
}

/**
 * Hand an .ics invite to the OS default calendar app (desktop shell only).
 */
export async function openCalendarInvite(input: {
  filename: string;
  content: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("open_calendar_invite", {
    filename: input.filename,
    content: input.content,
  });
}

/**
 * Open the macOS print panel for an HTML document (desktop shell only).
 *
 * `window.print()` does nothing in a WKWebView — see products/mail/crates/mail-native/src/printing.rs.
 *
 * Answers false when the shell carries no such command, which is every shell
 * but the Mac one: WebView2 prints an iframe the way a browser does, so the
 * Windows app has no native print panel to open and none is built. The caller
 * prints the same document the browser way instead. A command that is there
 * and fails still throws, so a real fault is still reported.
 */
export async function printNativeDocument(html: string): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  try {
    await invoke("print_document", { html });
    return true;
  } catch (err) {
    if (isMissingCommand(err)) return false;
    throw err;
  }
}

/**
 * Did this rejection mean "this shell has no such command"?
 *
 * Tauri answers an unregistered command with "Command <name> not found", and a
 * command the capabilities do not allow with "... not allowed". Neither is a
 * typed error, so the text is what there is to read.
 */
function isMissingCommand(err: unknown): boolean {
  const message =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /not found|not allowed/i.test(message);
}

/**
 * Pop a mail thread out into an always-on-top floating chat window
 * (desktop shell only; see src-tauri open_chat_popout).
 */
/**
 * Is a pop-out already open for this thread?
 *
 * The main window asks so it can show a strip in place of the reply composer
 * while one is: one message being written has one place, and the pop-out is
 * that place while it is there. False anywhere that is not the desktop app.
 */
export async function isChatPopoutOpen(input: {
  account: string;
  threadId: string;
}): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  try {
    return Boolean(await invoke("chat_popout_open", input));
  } catch {
    return false;
  }
}

/** Bring this thread's pop-out to the front. */
export async function focusChatPopout(input: {
  account: string;
  threadId: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("focus_chat_popout", input);
}

/**
 * Ask this thread's pop-out to hand its draft back and close.
 *
 * Asked of it, not done to it: only that window knows what has been typed
 * there, so it saves the draft the way Escape does and then closes itself.
 */
export async function handBackChatPopout(input: {
  account: string;
  threadId: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("hand_back_chat_popout", input);
}

export async function openChatPopout(input: {
  account: string;
  threadId: string;
  name: string;
  email: string;
  subject: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("open_chat_popout", {
    ...input,
    userAgent: navigator.userAgent,
  });
}

/** Resize the current chat popout window (called from inside the popout). */
export async function resizeChatPopout(input: {
  width: number;
  height: number;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("resize_chat_popout", input);
}

/** Close the current chat popout window (called from inside the popout). */
export async function closeChatPopout(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("close_chat_popout");
}

/**
 * Open a thread in an ordinary window of its own — system title bar, its own
 * close button, sitting in the window order like any window. The reader
 * window, the way Outlook opens a message. See open_mail_reader_window.
 */
export async function openMailReaderWindow(input: {
  account: string;
  threadId: string;
  name: string;
  email: string;
  subject: string;
  /** A person's mail instead of one thread — see openMailPersonWindow. */
  person?: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("open_mail_reader_window", {
    ...input,
    userAgent: navigator.userAgent,
  });
}

/** Close the current reader window (called from inside it). */
export async function closeMailReaderWindow(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running in the desktop app");
  await invoke("close_mail_reader_window");
}

/** Tell the other shell windows a send happened (no-op outside the shell). */
export async function notifyMailSent(input: {
  account: string;
  threadId: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("notify_mail_sent", input);
}

/**
 * Tell the other shell windows a thread was archived, deleted or moved, so
 * the list drops the row now rather than at the next poll (no-op outside
 * the shell).
 */
export async function notifyMailChanged(input: {
  account: string;
  threadId: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("notify_mail_changed", input);
}

/**
 * Ask the window that has a composer to forward a message.
 *
 * The chat popout cannot forward anything itself — no recipient picker, no
 * subject line. It asks the main window, which comes to the front.
 */
export async function notifyMailForward(input: {
  account: string;
  threadId: string;
  messageId: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("notify_mail_forward", input);
}

/**
 * Ask the window that has a composer to open a message as a new one.
 *
 * The chat popout cannot do it itself — no recipient picker, no subject
 * line. It asks the main window, which comes to the front.
 */
export async function notifyMailEditAsNew(input: {
  account: string;
  threadId: string;
  messageId: string;
}): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("notify_mail_edit_as_new", input);
}

/**
 * What is on the pasteboard, as plain text.
 *
 * For paste-without-formatting: a page asking its own clipboard puts a
 * Paste button on screen in WebKit, which is a second press for something
 * the reader has already asked for. The app owns the pasteboard and can
 * simply read it. Null outside the desktop app, where the page's own
 * clipboard is the only one there is.
 */
export async function readClipboardText(): Promise<string | null> {
  const invoke = tauriInvoke();
  if (!invoke) return null;
  try {
    const text = await invoke("read_clipboard_text");
    return typeof text === "string" ? text : null;
  } catch {
    // An older shell without the command: the caller falls back.
    return null;
  }
}

/**
 * Open an http(s) URL in the system browser.
 * Needed for links inside sandboxed email iframes — Tauri does not honor
 * target=_blank from iframe documents, so the parent must call opener.
 * @returns true when a handler accepted the URL.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!/^https?:/i.test(url)) return false;

  const invoke = tauriInvoke();
  if (invoke) {
    try {
      await invoke("open_external_url", { url });
      return true;
    } catch (err) {
      console.warn("[mail] open_external_url failed:", err);
    }
  }

  const openUrl = tauriOpenUrl();
  if (openUrl) {
    try {
      await openUrl(url);
      return true;
    } catch (err) {
      console.warn("[mail] tauri opener.openUrl failed:", err);
    }
  }

  if (invoke) {
    try {
      await invoke("plugin:opener|open_url", { url });
      return true;
    } catch (err) {
      console.warn("[mail] plugin:opener|open_url failed:", err);
    }
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    console.warn("[mail] window.open blocked for", url.slice(0, 120));
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Mac address book
// ---------------------------------------------------------------------------

/**
 * What macOS allows for the address book.
 *
 * "unavailable" is not one of Apple's answers. It means there is nothing to
 * ask: a browser, or a shell whose native side does not carry these commands.
 */
export type MacContactsStatus =
  | "authorized"
  | "limited"
  | "denied"
  | "restricted"
  | "notDetermined"
  | "unavailable";

/** Read the standing answer. Shows the reader nothing. */
export async function macContactsAuthorization(): Promise<MacContactsStatus> {
  const invoke = tauriInvoke();
  if (!invoke) return "unavailable";
  try {
    return (await invoke("mac_contacts_authorization")) as MacContactsStatus;
  } catch {
    // A shell built before these commands existed.
    return "unavailable";
  }
}

/**
 * Ask macOS for access.
 *
 * The prompt appears once for the life of the install. After that this returns
 * the standing answer and shows nothing, so a reader who said no has to change
 * it in System Settings.
 */
export async function macContactsRequestAccess(): Promise<MacContactsStatus> {
  const invoke = tauriInvoke();
  if (!invoke) return "unavailable";
  try {
    return (await invoke("mac_contacts_request_access")) as MacContactsStatus;
  } catch (err) {
    console.warn("[mail] mac_contacts_request_access failed:", err);
    return "unavailable";
  }
}

/** Every address in the book, one row per address. */
export async function macContactsList(): Promise<
  { email: string; name: string; card?: string }[]
> {
  const invoke = tauriInvoke();
  if (!invoke) return [];
  return (await invoke("mac_contacts_list")) as { email: string; name: string }[];
}

/**
 * Open System Settings at Privacy & Security › Contacts.
 *
 * The way back from a refusal. macOS asks about Contacts once, so after a no
 * this pane is the only thing that can change the answer.
 */
export async function openContactsPrivacySettings(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke("open_contacts_privacy_settings");
  } catch (err) {
    console.warn("[mail] open_contacts_privacy_settings failed:", err);
  }
}

/**
 * Show a CRM record in the planner: the split view opens with that tab at
 * the bottom, scrolled to the record. In the Planner Mac app the shell tells
 * the planner page; in the standalone app it opens the planner in the
 * browser. Resolves false when there is no shell to ask.
 */
export async function showPlannerRecord(input: {
  source: string;
  recordId: string;
}): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  try {
    await invoke("planner_show_record", { source: input.source, recordId: input.recordId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tell the planner that the mail pane wrote to the CRM, so a CRM tab that is
 * open fetches fresh rows. Resolves false when there is no planner window to
 * tell: the browser, or the standalone Mail app.
 */
export async function notifyPlannerCrmChanged(source?: string): Promise<boolean> {
  const invoke = tauriInvoke();
  if (!invoke) return false;
  try {
    await invoke("planner_crm_changed", { source: source ?? null });
    return true;
  } catch {
    return false;
  }
}
