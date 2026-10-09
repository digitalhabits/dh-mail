"use client";

/*
 * The people of an Exchange server's directory, for what is typed in a
 * recipient field (section 16.5 of docs/mail-exchange-ews.md). Asked when
 * the typing has stopped for a moment, and only for a message from an
 * Exchange mailbox. The rows are for the text now in the field: an answer
 * for an older text is not shown.
 */

import * as React from "react";

import type { MailContactSuggestion } from "@/lib/mail/contact-suggestion";
import { DIRECTORY_MIN_TEXT, directoryText, searchExchangeDirectory } from "@/lib/mail/exchange-directory";

/** How long the typing must stop before the directory is asked. */
export const DIRECTORY_WAIT_MS = 400;

export function useExchangeDirectory(account: string | undefined, draft: string): MailContactSuggestion[] {
  const [found, setFound] = React.useState<{ q: string; rows: MailContactSuggestion[] }>({ q: "", rows: [] });
  const q = directoryText(draft);
  React.useEffect(() => {
    if (!account || q.length < DIRECTORY_MIN_TEXT) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void searchExchangeDirectory(account, q).then((rows) => {
        if (live) setFound({ q, rows });
      });
    }, DIRECTORY_WAIT_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [account, q]);
  return found.q === q ? found.rows : [];
}
