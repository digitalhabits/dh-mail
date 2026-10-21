/**
 * What the Mail interface asks of the desktop shell.
 *
 * The interface imports these names from `@/lib/native-shell`. Each host of
 * the interface gives that name a file of its own. The Mail app's file is
 * `apps/mail/lib/native-shell.ts`.
 *
 * Each such file declares at its end that it implements `MailNativeShell`,
 * so the typecheck stops a file that drops a name or changes a type. Types
 * only.
 *
 * The files are not copies of each other. A call can act differently in
 * another host. A host can also export more than this, for its own pages.
 */

/** The address book's answer. "unavailable" means that there is nothing to ask. */
export type MacContactsStatus =
  | "authorized"
  | "limited"
  | "denied"
  | "restricted"
  | "notDetermined"
  | "unavailable";

type ThreadRef = { account: string; threadId: string };
type MessageRef = ThreadRef & { messageId: string };
type ThreadWindow = ThreadRef & { name: string; email: string; subject: string };

export type MailNativeShell = {
  isNativeShell: () => boolean;
  beginNativeWindowDragOnMove: (event: { button: number; clientX: number; clientY: number }) => void;
  openCalendarInvite: (input: { filename: string; content: string }) => Promise<void>;
  printNativeDocument: (html: string) => Promise<boolean>;
  isChatPopoutOpen: (input: ThreadRef) => Promise<boolean>;
  focusChatPopout: (input: ThreadRef) => Promise<void>;
  handBackChatPopout: (input: ThreadRef) => Promise<void>;
  openChatPopout: (input: ThreadWindow) => Promise<void>;
  resizeChatPopout: (input: { width: number; height: number }) => Promise<void>;
  closeChatPopout: () => Promise<void>;
  openMailReaderWindow: (input: ThreadWindow & { person?: string; draft?: string }) => Promise<void>;
  closeMailReaderWindow: () => Promise<void>;
  notifyMailSent: (input: ThreadRef) => Promise<void>;
  notifyMailChanged: (input: ThreadRef) => Promise<void>;
  notifyMailForward: (input: MessageRef) => Promise<void>;
  notifyMailEditAsNew: (input: MessageRef) => Promise<void>;
  readClipboardText: () => Promise<string | null>;
  openExternalUrl: (url: string) => Promise<boolean>;
  macContactsAuthorization: () => Promise<MacContactsStatus>;
  macContactsRequestAccess: () => Promise<MacContactsStatus>;
  macContactsList: () => Promise<{ email: string; name: string; card?: string }[]>;
  openContactsPrivacySettings: () => Promise<void>;
};

/**
 * `Implements<typeof Self>` is the module type when the module has every
 * name of `MailNativeShell` with a type that fits, and a type error when it
 * does not.
 */
export type ImplementsMailNativeShell<T extends MailNativeShell> = T;
