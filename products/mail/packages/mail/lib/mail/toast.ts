/**
 * The mail interface's toast: sonner's, with one thing added.
 *
 * A message that says "reconnect" names a mailbox that has lost its grant,
 * and the reader's next question is how. The answer used to be "find it
 * in Settings". Now the toast carries a Reconnect button that starts the
 * connect flow for that mailbox, whichever of the forty-odd places raised
 * the toast. The mail page listens for the request and runs it, because
 * it is the one with the connect hook.
 */

import type * as React from "react";
import { toast as sonner, type ExternalToast } from "sonner";

import { mailSay } from "@/lib/mail/i18n-strings";
import type { MailConnectProvider } from "@/lib/mail/host/contracts";

export const MAIL_RECONNECT_REQUEST = "redd-mail-reconnect-request";

export type MailReconnectRequest = {
  provider: MailConnectProvider;
  email: string;
};

/** The button for a message that asks the reader to reconnect a mailbox. */
export function reconnectActionFor(message: string): ExternalToast | null {
  if (!/reconnect/i.test(message)) return null;
  const email = message.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
  if (!email) return null;
  const provider: MailConnectProvider = /outlook|microsoft/i.test(message)
    ? "outlook"
    : "gmail";
  return {
    action: {
      label: mailSay("reconnect"),
      onClick: () => {
        if (typeof window === "undefined") return;
        window.dispatchEvent(
          new CustomEvent<MailReconnectRequest>(MAIL_RECONNECT_REQUEST, {
            detail: { provider, email },
          })
        );
      },
    },
  };
}

function error(message: string | React.ReactNode, data?: ExternalToast) {
  const extra = typeof message === "string" ? reconnectActionFor(message) : null;
  return sonner.error(message, extra ? { ...extra, ...data } : data);
}

export const toast: typeof sonner = Object.assign(
  (...args: Parameters<typeof sonner>) => sonner(...args),
  sonner,
  { error }
);
