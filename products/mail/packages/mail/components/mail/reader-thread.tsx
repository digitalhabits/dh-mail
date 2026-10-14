"use client";

/**
 * What the Reader needs from the thread pane: one message, and the
 * thread's Reply all.
 *
 * The bubble already worked out what the Reader shows: the sender's name,
 * the body with the quoted history folded, and whether its images load. It
 * hands that to the Reader as a `ReaderEntry`. The thread pane gives Reply
 * all, when it reaches more people than Reply (`ReaderThreadContext`).
 * Where no pane gives it (a chat window, a bubble alone), there is none.
 */

import * as React from "react";

import type { ReaderMessage } from "@/components/mail/MessageReader";

/** One message as the Reader shows it. */
export type ReaderEntry = {
  id: string;
  message: ReaderMessage;
  /** The sender, as the bubble names them. */
  displayName: string;
  /** The whole plain text, quoted history and forwards included. */
  fullText: string;
  /** The plain text with quoted history folded away. */
  shownText: string;
  /** The HTML with quoted history folded away. */
  shownHtml: string;
  /** True when the bubble shows the quoted history. The Reader starts so. */
  showQuoted: boolean;
  allowImages: boolean;
  readInTheDark: boolean;
  highlight?: string[];
  onReplyTo?: () => void;
  onForward?: () => void;
};

/** What the pane says about the thread. */
export type ReaderThreadInfo = {
  /** Reply to everybody on the thread, when that is more than Reply. */
  replyAll?: () => void;
};

/** The pane's info. Null where no pane gives it. */
export const ReaderThreadContext = React.createContext<ReaderThreadInfo | null>(null);

/**
 * The pane's half: one object for the life of the pane. Reply all goes
 * through a ref, so a new closure on each render is not a change.
 */
export function useReaderThreadInfo(replyAll: (() => void) | undefined): ReaderThreadInfo {
  const ref = React.useRef(replyAll);
  React.useLayoutEffect(() => {
    ref.current = replyAll;
  });
  const has = Boolean(replyAll);
  return React.useMemo(() => ({ replyAll: has ? () => ref.current?.() : undefined }), [has]);
}

/** Reply all for the Reader, from the pane. */
export function useReaderReplyAll(): (() => void) | undefined {
  return React.useContext(ReaderThreadContext)?.replyAll;
}
