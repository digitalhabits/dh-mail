/**
 * The standalone shell around a reader window (`?reader=1`).
 *
 * All it owns is the list of connected mailboxes, read the same way App.tsx
 * reads it — the interface needs it for the From picker on a reply. The
 * window renders nothing until the read answers; reading the store is quick,
 * and a spinner would flash and say nothing.
 */

import * as React from "react";

import { PersonReaderWindow } from "@/components/mail/PersonReaderWindow";
import { ThreadReaderWindow } from "@/components/mail/ThreadReaderWindow";
import { mailStore } from "@/lib/mail/store";
import type { MailStoreProvider } from "@/lib/mail/store/types";

import { DEMO_MAILBOXES } from "./demo/data";
import { isDemoMode } from "./demo/mode";

const OWNER_ID = "local";
const PROVIDERS: MailStoreProvider[] = ["gmail", "outlook"];

export function ReaderWindow({
  account,
  threadId,
  name,
  email,
  subject,
  person,
}: {
  account: string;
  threadId: string;
  name: string;
  email: string;
  subject: string;
  /** A person's key: their mail in the window rather than one thread. */
  person?: string;
}) {
  const [accounts, setAccounts] = React.useState<string[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (isDemoMode()) {
        if (!cancelled) setAccounts(DEMO_MAILBOXES.map((m) => m.email));
        return;
      }
      try {
        const perProvider = await Promise.all(
          PROVIDERS.map((provider) =>
            mailStore().accounts.listForOwner(provider, OWNER_ID)
          )
        );
        if (cancelled) return;
        setAccounts(
          perProvider
            .flat()
            .filter((row) => row.inMailTab)
            .map((row) => row.email)
        );
      } catch {
        // The window still works on its one mailbox; only the From picker
        // has less to offer.
        if (!cancelled) setAccounts([account]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  if (accounts === null) return null;

  if (person) {
    return (
      <PersonReaderWindow
        personKey={person}
        accounts={accounts.length ? accounts : account ? [account] : []}
      />
    );
  }

  return (
    <ThreadReaderWindow
      account={account}
      threadId={threadId}
      accounts={accounts.length ? accounts : [account]}
      name={name}
      email={email}
      subject={subject}
    />
  );
}
