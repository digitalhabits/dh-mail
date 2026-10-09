"use client";

/*
 * The connect form's server search (Autodiscover, section 16.7 of
 * docs/mail-exchange-ews.md): what "Find server" does, and what Connect
 * does with an empty server field for a domain the app does not know.
 * The rules are in lib/mail/exchange-autodiscover.ts.
 */

import * as React from "react";

import { fillServer, searchExchangeServer } from "@/lib/mail/exchange-autodiscover";
import type { MailT } from "@/lib/mail/i18n-strings";

type Fields = { email: string; username: string; password: string; url: string };

/** A search's end: the address to connect to, or why there is none. */
export type SearchEnd = { url: string | null; error?: string };

export function useServerSearch<F extends Fields>(
  setFields: React.Dispatch<React.SetStateAction<F>>,
  typedByPerson: React.MutableRefObject<boolean>,
  t: MailT
) {
  const [searching, setSearching] = React.useState(false);
  /** A host outside the email's domain, waiting for the person's yes. */
  const [ask, setAsk] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");

  const find = React.useCallback(
    async (fields: F, allowHost?: string): Promise<SearchEnd> => {
      setSearching(true);
      setAsk(null);
      setNote(t("exchangeFindingServer"));
      const found = await searchExchangeServer({ ...fields, allowHost });
      setSearching(false);
      setNote("");
      switch (found.kind) {
        case "known":
        case "found": {
          const url = fillServer(fields.url, typedByPerson.current, found.url);
          setFields((f) => ({ ...f, url: fillServer(f.url, typedByPerson.current, found.url) }));
          setNote(t("exchangeServerFound"));
          return { url };
        }
        case "ask":
          setAsk(found.host);
          return { url: null };
        case "refused":
          return { url: null, error: t("exchangeRefused") };
        default:
          return { url: null, error: t("exchangeServerNotFound") };
      }
    },
    [setFields, t, typedByPerson]
  );

  return { searching, ask, note, find, dismissAsk: () => setAsk(null) };
}
