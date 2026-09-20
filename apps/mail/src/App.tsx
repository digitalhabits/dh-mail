/**
 * The standalone app around the shared mail interface.
 *
 * It owns two things the interface does not: the list of connected mailboxes,
 * which it reads from the store and passes down, and the first-run screen for
 * someone who has connected none yet.
 *
 * Connecting, disconnecting, and reordering all happen inside the interface,
 * on the same settings panel the planner has. Mail calls `router.refresh()`
 * after each, and `onMailRefresh` turns that into a re-read here.
 */

import * as React from "react";
import { mailSay } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";

import { MailPage } from "@/components/mail/MailPage";
import { CONTACTS_CHANGED_EVENT } from "@/components/mail/ContactSourcesDialog";
import { mailStore } from "@/lib/mail/store";
import type { MailStoreProvider } from "@/lib/mail/store/types";

import { mailApiFetch } from "@/lib/mail/api";
import { mailUsesCrmPeople } from "@/lib/mail/product-flavor";
import { useMailColorMode } from "@/lib/mail/theme";
import { useWindowBackdrop } from "@/lib/mail/window-backdrop";

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
import { importPlannerStateOnce } from "./import-planner-state";
import { connectConfigError } from "./oauth-config";
import { startLocalStoreSync } from "./local-store";
import { plannerSessionReady, signInToPlanner } from "./planner-login";
import {
  findMailboxProblems,
  type MailboxProblem,
  type MailboxRef,
} from "./mailbox-health";
import { onMailRefresh } from "./seams/mail-router";

/** Single user, so every mailbox belongs to the same owner. */
const OWNER_ID = "local";

const PROVIDERS: MailStoreProvider[] = ["gmail", "outlook"];

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

  /*
   * The team layer needs a planner session. Internal flavor only: the public
   * app has no planner. Until there is one, a strip offers the sign-in; the
   * CRM and AI actions would fail with a message otherwise.
   */
  const teamLayer = mailUsesCrmPeople();
  /**
   * Inside the Planner Mac app (the mail pane, `?pane=1`) the planner page
   * supplies the session; the pane never asks the reader to sign in. In the
   * standalone app it does, from the strip below.
   */
  const isPane = React.useMemo(
    () => new URLSearchParams(window.location.search).get("pane") === "1",
    []
  );
  const [plannerReady, setPlannerReady] = React.useState<boolean | null>(null);
  const [plannerSigningIn, setPlannerSigningIn] = React.useState(false);
  React.useEffect(() => {
    if (!teamLayer) return;
    // The session may arrive a moment after this loads: the planner page
    // mints it after sign-in, or the reader is signing in from the strip.
    // Ask again until it is there, then stop.
    let cancelled = false;
    let timer = 0;
    const check = async () => {
      const ready = await plannerSessionReady();
      if (cancelled) return;
      setPlannerReady(ready);
      if (!ready) timer = window.setTimeout(check, 3000);
    };
    void check();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [teamLayer]);
  const signInPlanner = React.useCallback(async () => {
    setPlannerSigningIn(true);
    try {
      await signInToPlanner();
      setPlannerReady(true);
      toast.success(mailSay("signedInToPlanner"));
      // What the planner held for this person, once, now that it can ask.
      void (isDemoMode() ? Promise.resolve(null) : importPlannerStateOnce());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't sign in to the planner");
    } finally {
      setPlannerSigningIn(false);
    }
  }, []);
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
   * interface, not just out of the fetch. The planner filters on the server
   * with `filterAccountsForScope`; this build reads the store directly, and
   * was handing every connected mailbox through — so a hidden one still
   * appeared in the mailbox picker and still counted as a mailbox.
   */
  const shownMailboxes = mailboxes.filter((m) => m.inMailTab);

  return (
    <>
      {/* MailPage owns the overlay title strip (search sits with the traffic
          lights). An empty .dh-titlebar here would stack a second bar. */}
      {/* The warning keeps its amber in both themes — it is meant to stand out
          against the chrome, not to blend into it. */}
      {teamLayer && !isPane && plannerReady === false ? (
        <div className="dh-top-banner flex items-center justify-between gap-4 border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
          <span>{mailSay("signInForCrm")}</span>
          <button
            type="button"
            onClick={() => void signInPlanner()}
            disabled={plannerSigningIn}
            className="shrink-0 rounded-md bg-sky-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            {plannerSigningIn ? "Waiting for your browser…" : "Sign in to Planner"}
          </button>
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
          ownIdentity.addresses
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
  const label = provider === "outlook" ? "Outlook" : "Gmail";
  const configError = connectConfigError(provider);
  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={connecting || configError !== null}
      title={configError ?? undefined}
      className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
    >
      {connecting ? "Waiting for your browser…" : `Connect ${label}`}
    </button>
  );
}
