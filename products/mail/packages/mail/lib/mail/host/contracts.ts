/**
 * What the mail package needs from whichever app hosts it.
 *
 * Each host provides these modules, and the `@/*` tsconfig path fallback
 * resolves them app-first. That mechanism works, but it declares nothing: a new
 * host learns the requirements from compile errors. These types are the
 * declaration. `conformance.ts` checks each host against them.
 *
 * Keep every contract to what mail calls today. A host implements a small
 * surface, not the planner's whole module.
 */

import type { MailProvider } from "@/lib/mail/types";

/**
 * Desktop shell bridge (`@/lib/native-shell`).
 *
 * The planner module exports 26 functions. Mail calls three. A standalone host
 * implements these three only.
 */
export type MailNativeShell = {
  /** True inside a desktop shell. False in a browser. */
  isNativeShell: () => boolean;
  /** Hand a calendar attachment to the operating system. */
  openCalendarInvite: (input: {
    filename: string;
    content: string;
  }) => Promise<void>;
  /** Open an http(s) link outside the app. False when the URL is refused. */
  openExternalUrl: (url: string) => Promise<boolean>;
};

/**
 * Instant tab paint cache (`@/lib/page-snapshot-cache`).
 *
 * The planner keeps the previous tab painted during navigation. A host without
 * tabs can stub these: `getPageSnapshot` returns null and `setPageSnapshot`
 * does nothing. See `apps/todo/src/seams/page-snapshot-cache.ts` for a stub.
 */
/**
 * Navigation (`@/lib/mail-router`).
 *
 * Mail asks the host to re-read server-rendered data after a change. A host
 * without a server implements `refresh` as a function that does nothing.
 */
export type MailRouter = {
  useMailRouter: () => { refresh: () => void };
};

/** The providers a mailbox can come from. */
export type MailConnectProvider = MailProvider;

/** A URL an element can load for an attachment, and how to let it go. */
export type AttachmentSource = {
  url: string;
  /** Release anything held for this URL. Safe to call more than once. */
  release: () => void;
};

/**
 * Starting a mailbox sign-in (`@/lib/mail/connect-mailbox`).
 *
 * The default lives in the mail package and sends the user to the host's OAuth
 * routes. A host with no server replaces the module and signs in itself.
 *
 * `mailConnectHref` is a fallback for a page whose script never ran. A host
 * that cannot offer one answers "#": the interface stops the click first.
 */
export type MailConnectSeam = {
  mailConnectHref: (provider: MailConnectProvider, email?: string) => string;
  /**
   * Settles when the sign-in is finished, or when the page is about to leave
   * for the provider — so a caller can show that something is happening. On a
   * host that navigates, it simply never settles, and the button stays busy
   * until the page goes.
   */
  startMailConnect: (
    provider: MailConnectProvider,
    email?: string
  ) => Promise<void>;
};

export type MailPageSnapshotCache = {
  /** Cache key for the mail tab, per viewer. */
  mailPageCacheKey: (viewerId: string) => string;
  /** Last snapshot for this key, or null. */
  getPageSnapshot: <T>(key: string) => T | null;
  /** Store a snapshot for the next paint. */
  setPageSnapshot: <T>(key: string, data: T) => void;
};
