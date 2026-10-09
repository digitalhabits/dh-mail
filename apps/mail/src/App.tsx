/**
 * The standalone app around the shared mail interface.
 *
 * It owns two things the interface does not: the list of connected mailboxes,
 * which it reads from the store and passes down, and the first-run screen for
 * someone who has connected none yet.
 *
 * Connecting, disconnecting, and reordering all happen inside the interface,
 * on the same settings panel every host has. Mail calls `router.refresh()`
 * after each, and `onMailRefresh` turns that into a re-read here.
 */

import * as React from "react";
import {
  refreshExchangeOwnAddresses,
  storedExchangeOwnAddresses,
} from "@/lib/mail/exchange-own-addresses";
import { mailSay } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";

import { MailPage } from "@/components/mail/MailPage";
import { ExchangeConnectInPlace } from "@/components/mail/ExchangeConnectInPlace";
import { CONTACTS_CHANGED_EVENT } from "@/components/mail/ContactSourcesDialog";
import { mailStore } from "@/lib/mail/store";
import type { MailStoreProvider } from "@/lib/mail/store/types";

import { mailApiFetch } from "@/lib/mail/api";
import { hasExchangeAccount } from "@/lib/mail/exchange-accounts";
import { requestExchangeConnect } from "@/lib/mail/exchange-connect";
import { useMailColorMode } from "@/lib/mail/theme";
import { useTeamUpdate } from "@/lib/mail/team-update";
import { useWindowBackdrop } from "@/lib/mail/window-backdrop";
// What a build adds around the interface, if anything. See build-aliases.mjs.
import { useTeamSessionBar } from "@/team-shell";

import {
  EMPTY_OWN_IDENTITY,
  getOwnIdentity,
  mergeOwnAddresses,
  setOwnIdentity,
  type OwnIdentity,
} from "./own-identity";

import { connectMailbox } from "./connect-mailbox";
import { DEMO_MAILBOXES } from "./demo/data";
import { isDemoMode } from "./demo/mode";
import { connectConfigError } from "./oauth-config";
import { startLocalStoreSync } from "./local-store";
import {
  findMailboxProblems,
  type MailboxProblem,
  type MailboxRef,
} from "./mailbox-health";
import { onMailRefresh } from "./seams/mail-router";

/** Single user, so every mailbox belongs to the same owner. */
const OWNER_ID = "local";

/*
  Exchange (EWS) is in both builds since 2026-09-28.
*/
const PROVIDERS: MailStoreProvider[] = ["gmail", "outlook", "exchange"];

export function App() {
  // The first-run screen draws its own chrome, outside MailPage, so it needs
  // the shell tokens itself. MailPage puts the class on its own root.
  const colorMode = useMailColorMode();
  // The window's own color, under the page: the theme's, not the cream in
  // tauri.conf.json. It shows at launch and while the window grows.
  useWindowBackdrop(colorMode);
  const [mailboxes, setMailboxes] = React.useState<MailboxRef[] | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [problems, setProblems] = React.useState<MailboxProblem[]>([]);
  /** Aliases and colleague domains the reader set, without their mailboxes. */
  const [ownIdentity, setOwnIdentityState] =
    React.useState<OwnIdentity>(EMPTY_OWN_IDENTITY);

  React.useEffect(() => {
    let cancelled = false;
    void getOwnIdentity().then((stored) => {
      if (!cancelled) setOwnIdentityState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /*
    The other addresses of each Exchange mailbox, from its directory: an
    Exchange mailbox can send as an address it does not sign in with, and
    that mail is ours too (see exchange-own-addresses.ts). The kept answer
    first, then the directory again, once for each set of mailboxes.
  */
  const [exchangeAliases, setExchangeAliases] = React.useState<string[]>([]);
  const exchangeEmails = (mailboxes ?? [])
    .filter((m) => m.provider === "exchange")
    .map((m) => m.email.toLowerCase())
    .sort()
    .join(",");
  React.useEffect(() => {
    if (!exchangeEmails) return;
    let cancelled = false;
    const accounts = exchangeEmails.split(",");
    void storedExchangeOwnAddresses(accounts).then((kept) => {
      if (!cancelled) setExchangeAliases(kept);
    });
    void refreshExchangeOwnAddresses(accounts).then((found) => {
      if (!cancelled) setExchangeAliases(found);
    });
    return () => {
      cancelled = true;
    };
  }, [exchangeEmails]);

  const saveOwnIdentity = React.useCallback((next: OwnIdentity) => {
    // Paint first: the fields are the reader's own text, and a round trip to
    // the store would make them jump back for a moment.
    setOwnIdentityState(next);
    void setOwnIdentity(next).catch(() => {
      toast.error(mailSay("couldNotSaveOtherAddresses"));
    });
  }, []);

  const load = React.useCallback(async () => {
    // The invented mailbox has no store behind it, and nothing to refresh.
    if (isDemoMode()) {
      setMailboxes(
        DEMO_MAILBOXES.map((m) => ({ ...m, inMailTab: true }))
      );
      setProblems([]);
      return;
    }
    try {
      const perProvider = await Promise.all(
        PROVIDERS.map(async (provider) => {
          const rows = await mailStore().accounts.listForOwner(
            provider,
            OWNER_ID
          );
          return rows.map((row) => ({
            email: row.email,
            provider,
            inMailTab: row.inMailTab,
          }));
        })
      );
      const all = perProvider.flat();
      setMailboxes(all);
      // The local copy's workers. Off the critical path: the list draws
      // from the provider as before until the copy fills.
      void startLocalStoreSync(all).catch((err: unknown) => {
        console.warn("[mail] local store sync did not start:", err);
      });
      // One token refresh per mailbox, which the first request would do anyway.
      setProblems(await findMailboxProblems(all));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't read accounts");
      setMailboxes([]);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Mail changed the account list from its settings panel. Read it again. */
  React.useEffect(() => onMailRefresh(() => void load()), [load]);

  /**
   * Fill the address book once a mailbox is connected.
   *
   * Without this the People pile stays empty and nothing explains why: the only
   * way to start a contact sync by hand is a dialog inside the composer, which
   * nobody finds on a first run. `ifStale=1` makes this cheap to repeat, so it
   * does the work once and then does nothing.
   */
  const [syncedContacts, setSyncedContacts] = React.useState(false);

  /** Inside another app's window, this interface is a pane, `?pane=1`. */
  const isPane = React.useMemo(
    () => new URLSearchParams(window.location.search).get("pane") === "1",
    []
  );
  /*
   * A new version of this app, downloaded and waiting. Not in the pane:
   * there the app around it shows its own bar. A build with no updater (a
   * store package, the demo, a dev build) has no update commands, so the
   * bar never shows there.
   */
  const teamUpdate = useTeamUpdate(!isPane);
  /* A strip that a build can show over the window, or nothing. It holds an
     effect, so it stays here, after the update check, where its lines were. */
  const teamSessionBar = useTeamSessionBar(isPane);
  React.useEffect(() => {
    if (!mailboxes?.length || syncedContacts) return;
    setSyncedContacts(true);
    void (async () => {
      try {
        const res = await mailApiFetch(
          "/api/mail/contact-sources/sync?ifStale=1",
          { method: "POST" }
        );
        const json = (await res.json()) as {
          skipped?: boolean;
          results?: { ok: boolean; error?: string; account?: string; source?: string }[];
        };
        const failed = json.results?.find((r) => !r.ok);
        if (failed?.error) {
          // Named, and with the remedy on the toast: "reconnect this
          // account" left the reader asking which one, and where.
          const account = failed.account ?? "";
          const box = (mailboxes ?? []).find(
            (m) => m.email.toLowerCase() === account.toLowerCase()
          );
          const wantsReconnect = /reconnect/i.test(failed.error) && box;
          toast.error(account ? `${account}: ${failed.error}` : failed.error, {
            action: wantsReconnect
              ? {
                  label: "Reconnect",
                  onClick: () => void connect(box.provider, box.email),
                }
              : undefined,
          });
        }
        // The inbox loaded before this sync ended, so its rows were split
        // against an empty address book. Tell the list to load again.
        if (!json.skipped) {
          window.dispatchEvent(new CustomEvent(CONTACTS_CHANGED_EVENT));
        }
      } catch (err) {
        // Mail still works without an address book, so this only informs.
        console.warn("[mail] contact sync failed:", err);
      }
    })();
    // `connect` is declared below and is not memoized; the effect runs once
    // per mailbox list, so it is read when it runs rather than listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mailboxes, syncedContacts]);

  const connect = async (provider: MailStoreProvider, email?: string) => {
    setConnecting(true);
    try {
      // Exchange signs in with the password form, never in a browser.
      if (provider === "exchange" || (email && (await hasExchangeAccount(email)))) {
        if (await requestExchangeConnect(email)) await load();
        return;
      }
      const connected = await connectMailbox(provider, email);
      toast.success(`Connected ${connected.email}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't connect");
    } finally {
      setConnecting(false);
    }
  };

  // Reading the store is quick. A spinner would flash and say nothing.
  if (mailboxes === null) return null;

  if (!mailboxes.length) {
    return (
      <>
        <div className="dh-titlebar" data-tauri-drag-region />
        <div
          className="mail-shell flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--mail-chrome)] px-8 text-center"
          data-theme={colorMode}
        >
          {/* An Exchange connect shows its form here, in place of the welcome. */}
          <ExchangeConnectInPlace>
            <h1 className="text-xl font-semibold text-stone-900">
              Digital Habits: Mail
            </h1>
            <p className="max-w-sm text-sm text-stone-600">
              Connect a mailbox to start. The sign-in opens in your browser, and
              the token is kept in your keychain. You can add more later.
            </p>
            <div className="flex gap-2">
              {PROVIDERS.map((provider) => (
                <ConnectButton
                  key={provider}
                  provider={provider}
                  connecting={connecting}
                  onConnect={() => void connect(provider)}
                />
              ))}
            </div>
          </ExchangeConnectInPlace>
        </div>
      </>
    );
  }

  /**
   * Mailboxes that need signing in again.
   *
   * Google expires a refresh token after seven days while an app is in testing,
   * so this is not an edge case yet. Without it every request fails and nothing
   * says why. Only a refused grant shows here: a dropped network is not the
   * user's to fix.
   */
  const stale = problems.filter((p) => p.needsReconnect);

  /**
   * Hiding a mailbox under Display and accounts has to take it out of the
   * interface, not just out of the fetch. A server host filters on the server
   * with `filterAccountsForScope`; this build reads the store directly, and
   * was handing every connected mailbox through — so a hidden one still
   * appeared in the mailbox picker and still counted as a mailbox.
   */
  const shownMailboxes = mailboxes.filter((m) => m.inMailTab);

  return (
    <>
      {/* Settings holds the Exchange connect form here (MailListControls). */}
      {/* MailPage owns the overlay title strip (search sits with the traffic
          lights). An empty .dh-titlebar here would stack a second bar. */}
      {/* The warning keeps its amber in both themes — it is meant to stand out
          against the chrome, not to blend into it. */}
      {teamSessionBar}
      {teamUpdate.update ? (
        <div className="dh-top-banner flex items-center justify-between gap-4 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          <span>
            {teamUpdate.error
              ? mailSay("updateFailed", { error: teamUpdate.error })
              : mailSay("updateReady", { version: teamUpdate.update.version })}
          </span>
          <span className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={teamUpdate.later}
              disabled={teamUpdate.installing}
              className="rounded-md px-3 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-60"
            >
              {mailSay("updateLater")}
            </button>
            <button
              type="button"
              onClick={() => void teamUpdate.install()}
              disabled={teamUpdate.installing}
              className="rounded-md bg-emerald-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
            >
              {teamUpdate.installing ? mailSay("updateRestarting") : mailSay("updateRestart")}
            </button>
          </span>
        </div>
      ) : null}
      {stale.length ? (
        <div className="dh-top-banner flex items-center justify-between gap-4 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <span>
            {stale.length === 1
              ? `${stale[0].email} needs you to sign in again.`
              : `${stale.length} mailboxes need you to sign in again.`}
          </span>
          <button
            type="button"
            // One at a time, starting with the first. Signing in to two at once
            // would need two browser windows and two loopback ports.
            onClick={() => void connect(stale[0].provider, stale[0].email)}
            disabled={connecting}
            className="shrink-0 rounded-md bg-amber-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            {connecting ? "Waiting for your browser…" : "Reconnect"}
          </button>
        </div>
      ) : null}
      <MailPage
        accounts={shownMailboxes.map((m) => m.email)}
        viewerId={OWNER_ID}
        // Connected mailboxes are yours. Anything else the reader tells us,
        // and it is read from the store rather than compiled in — see
        // `./own-identity`.
        ownAddresses={mergeOwnAddresses(
          // Own addresses stay own addresses: a hidden mailbox is still you,
          // and mail to it must not read as somebody else's.
          mailboxes.map((m) => m.email),
          [...ownIdentity.addresses, ...exchangeAliases]
        )}
        ownDomains={ownIdentity.domains}
        ownIdentity={ownIdentity}
        onOwnIdentityChange={saveOwnIdentity}
      />
    </>
  );
}

/** Disabled with the reason when this build has no client for the provider. */
function ConnectButton({
  provider,
  connecting,
  onConnect,
}: {
  provider: MailStoreProvider;
  connecting: boolean;
  onConnect: () => void;
}) {
  const label = provider === "exchange" ? "Exchange" : provider === "outlook" ? "Outlook" : "Gmail";
  const configError = connectConfigError(provider);
  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={connecting || configError !== null}
      title={configError ?? undefined}
      className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
    >
      {connecting && provider !== "exchange" ? "Waiting for your browser…" : `Connect ${label}`}
    </button>
  );
}
