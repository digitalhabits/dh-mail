"use client";

/**
 * The mailbox arrangement, as a row can watch it.
 *
 * The arrangement itself is in `@/lib/mail/account-order`, which holds no
 * React because a test reads it. This is the subscription, kept apart for
 * the same reason `use-mail-shortcuts` is kept apart from `shortcuts`.
 */

import * as React from "react";

import {
  MAIL_ACCOUNT_ORDER_EVENT,
  readAccountOrder,
} from "@/lib/mail/account-order";

let cached: string[] | null = null;
const EMPTY: string[] = [];

export function useAccountOrder(): string[] {
  return React.useSyncExternalStore(
    (onChange) => {
      const listener = () => {
        cached = null;
        onChange();
      };
      window.addEventListener(MAIL_ACCOUNT_ORDER_EVENT, listener);
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener(MAIL_ACCOUNT_ORDER_EVENT, listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => (cached ??= readAccountOrder()),
    () => EMPTY
  );
}
