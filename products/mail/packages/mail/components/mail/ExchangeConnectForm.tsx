"use client";

/**
 * The Exchange (EWS) connect form: email address, username, password and
 * server. It asks the Exchange server only: no other server is told about
 * the connect.
 *
 * It answers a request (`requestExchangeConnect`): the Connect button in
 * Settings, or a Reconnect for an Exchange mailbox whose password the server
 * refused. For a reconnect, the address is fixed and the username and server
 * come from the account row. The password is sent to the Rust side once, and
 * is kept in the keychain there.
 *
 * The form is shown in place, never over something else. Settings shows it
 * as its Accounts page; the start page, with no mailbox yet, shows it in
 * place of its welcome. It was a dialog over Settings first, and Settings is
 * a popover that keeps the keyboard inside itself: nothing typed in the
 * dialog arrived.
 *
 * The username and the email address are two fields. At the University of
 * Copenhagen they are often different (section 7.3 of the design note).
 *
 * In both builds, in the desktop app only.
 */

import * as React from "react";

import { mailApiJson } from "@/lib/mail/api";
import {
  EXCHANGE_CONNECT_REQUEST,
  defaultExchangeServer,
  domainOf,
  listenForExchangeConnect,
  type ExchangeConnectRequest,
} from "@/lib/mail/exchange-connect";
import { SettingsPane } from "@/components/mail/settings-ui";
import { needsSearch } from "@/lib/mail/exchange-autodiscover";
import { useServerSearch } from "@/components/mail/use-exchange-server-search";
import { connectExchange, exchangeErrorCode } from "@/lib/mail/exchange-native";
import { useMailT } from "@/lib/mail/i18n";
import { toast } from "@/lib/mail/toast";
import { forgetMailProviderLists } from "@/lib/mail/use-outlook-accounts";

type Fields = { email: string; username: string; password: string; url: string };

const EMPTY: Fields = { email: "", username: "", password: "", url: "" };

/**
 * The request a form in this window is answering, or null.
 *
 * `onRequest` runs when a request is taken, so the host can show the form:
 * Settings opens itself on Accounts. `cancel` answers "no" and clears it, for
 * a host that goes away with the form open.
 */
export function useExchangeConnectRequest(onRequest?: () => void): {
  request: ExchangeConnectRequest | null;
  clear: () => void;
  cancel: () => void;
} {
  const [request, setRequest] = React.useState<ExchangeConnectRequest | null>(null);
  const onRequestRef = React.useRef(onRequest);
  onRequestRef.current = onRequest;
  const openRef = React.useRef<ExchangeConnectRequest | null>(null);
  openRef.current = request;

  React.useEffect(() => {
    const stop = listenForExchangeConnect();
    const onEvent = (event: Event) => {
      const detail = (event as CustomEvent<ExchangeConnectRequest>).detail;
      // A second request while one is open is answered "no" at once.
      if (openRef.current) {
        detail.done(null);
        return;
      }
      openRef.current = detail;
      setRequest(detail);
      onRequestRef.current?.();
    };
    window.addEventListener(EXCHANGE_CONNECT_REQUEST, onEvent);
    return () => {
      stop();
      window.removeEventListener(EXCHANGE_CONNECT_REQUEST, onEvent);
    };
  }, []);

  const clear = React.useCallback(() => {
    openRef.current = null;
    setRequest(null);
  }, []);
  const cancel = React.useCallback(() => {
    openRef.current?.done(null);
    clear();
  }, [clear]);
  return { request, clear, cancel };
}

/** The form's heading: a new mailbox, or the password again for one. */
export function useExchangeFormTitle(request: ExchangeConnectRequest): string {
  const t = useMailT();
  return request.email ? t("exchangeFormTitleAgain", { account: request.email }) : t("exchangeFormTitle");
}

/** The username and server of a connected account, for a reconnect. */
async function storedSettings(email: string): Promise<Partial<Fields>> {
  const json = await mailApiJson<{ accounts?: { email: string; ewsUrl?: string | null; ewsUsername?: string | null }[] }>(
    "/api/exchange/accounts"
  ).catch(() => ({ accounts: [] }));
  const row = (json.accounts ?? []).find((a) => a.email.toLowerCase() === email.toLowerCase());
  return { username: row?.ewsUsername ?? "", url: row?.ewsUrl ?? "" };
}

/** The form's state, and what its buttons do. */
function useExchangeForm(request: ExchangeConnectRequest, onClose: () => void) {
  const t = useMailT();
  const [fields, setFields] = React.useState<Fields>({ ...EMPTY, email: request.email ?? "" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const serverTouched = React.useRef(false);

  React.useEffect(() => {
    if (!request.email) return;
    void storedSettings(request.email).then((stored) => setFields((f) => ({ ...f, ...stored })));
  }, [request.email]);

  const set = (name: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (name === "url") serverTouched.current = true;
    setFields((f) => {
      const next = { ...f, [name]: value };
      if (name === "email" && !serverTouched.current) next.url = defaultExchangeServer(domainOf(value));
      return next;
    });
  };

  const finish = (connected: string | null) => {
    request.done(connected);
    onClose();
  };

  const server = useServerSearch(setFields, serverTouched, t);
  const [advanced, setAdvanced] = React.useState(false);

  /*
    Connect, which also finds the server. There is no separate "Find
    server": the search signs in, so it needs the whole password, and a
    search while the person types would spend failed sign-ins (each one
    counts toward locking the account). `allowHost` is the yes to the
    question about a host outside the email's domain; the connect goes on
    from there.
  */
  const submit = async (e?: React.FormEvent, allowHost?: string) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const email = fields.email.trim().toLowerCase();
      const input = { ...fields };
      // An empty server field, for a domain the app does not know: search
      // first (section 16.7). What the person typed is never searched over.
      if (needsSearch(fields)) {
        const end = await server.find(fields, allowHost);
        if (!end.url) {
          if (end.error) setError(end.error);
          // Not found: the field for the address, open, so it can be typed.
          if (end.error) setAdvanced(true);
          setBusy(false);
          return;
        }
        input.url = end.url;
      }
      await connectExchange({ ...input, email });
      forgetMailProviderLists();
      toast.success(t("exchangeConnected", { account: email }));
      finish(email);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // No second try by itself: a wrong password tried again can lock the account.
      setError(exchangeErrorCode(message) === "ews:refused" ? t("exchangeRefused") : message);
      setBusy(false);
    }
  };
  return { fields, set, busy, error, finish, submit, server, advanced, setAdvanced };
}

/**
 * The form as the Accounts page of Settings. Done shuts Settings, and
 * Settings answers "no" when it shuts with the form open.
 */
export function ExchangeSettingsPane({
  request,
  onClose,
  onDone,
}: {
  request: ExchangeConnectRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useMailT();
  const title = useExchangeFormTitle(request);
  return (
    <SettingsPane title={title} description={t("exchangeFormBody")} onDone={onDone}>
      <ExchangeConnectForm request={request} onClose={onClose} />
    </SettingsPane>
  );
}

/**
 * The fields, the error, and the buttons. The host gives the heading.
 * `onClose` runs after the request is answered, either way.
 */
export function ExchangeConnectForm({ request, onClose }: { request: ExchangeConnectRequest; onClose: () => void }) {
  const title = useExchangeFormTitle(request);
  const { fields, set, busy, error, finish, submit, server, advanced, setAdvanced } = useExchangeForm(
    request,
    onClose
  );
  return (
    <form
      aria-label={title}
      onSubmit={(e) => void submit(e)}
      onKeyDown={(e) => {
        // Escape answers "no". In Settings, the popover may also close.
        if (e.key === "Escape" && !busy) {
          e.stopPropagation();
          finish(null);
        }
      }}
      className="max-w-md text-stone-800"
    >
      <>
          <ExchangeFields
            fields={fields}
            set={set}
            again={Boolean(request.email)}
            busy={busy}
            advanced={advanced}
            onAdvanced={setAdvanced}
          />
          <ServerSearchLine
            busy={busy}
            searching={server.searching}
            note={server.note}
            ask={server.ask}
            onAllow={(host) => void submit(undefined, host)}
            onDeny={server.dismissAsk}
          />
      </>
      {error ? (
        <p role="alert" className="mt-3 text-sm leading-relaxed text-red-700">
          {error}
        </p>
      ) : null}
      <ExchangeFormButtons fields={fields} busy={busy} onCancel={() => finish(null)} />
    </form>
  );
}

function ExchangeFields({
  fields,
  set,
  again,
  busy,
  advanced,
  onAdvanced,
}: {
  fields: Fields;
  set: (name: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => void;
  again: boolean;
  busy: boolean;
  /** The server field shown. Opened by the form when the search finds nothing. */
  advanced: boolean;
  onAdvanced: (open: boolean) => void;
}) {
  const t = useMailT();
  const input =
    "mt-1 w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400";
  return (
    <div className="flex flex-col gap-3 text-sm">
      <label>
        {t("exchangeEmail")}
        <input
          className={input}
          type="email"
          autoComplete="off"
          value={fields.email}
          onChange={set("email")}
          disabled={again || busy}
          autoFocus={!again}
        />
      </label>
      <label>
        {t("exchangeUsername")}
        <input className={input} autoComplete="off" value={fields.username} onChange={set("username")} disabled={busy} />
        <span className="mt-1 block text-xs text-stone-500">{t("exchangeUsernameHelp")}</span>
      </label>
      <label>
        {t("exchangePassword")}
        <input
          className={input}
          type="password"
          autoComplete="off"
          value={fields.password}
          onChange={set("password")}
          disabled={busy}
          autoFocus={again}
        />
      </label>
      {/* The server under Advanced. Connect finds it, or fills it in for a
          domain the app knows; the field is for when that fails, or for
          somebody whose IT department gave them the address. */}
      <details open={advanced} onToggle={(e) => onAdvanced(e.currentTarget.open)}>
        <summary className="cursor-pointer select-none text-stone-600 hover:text-stone-800">
          {t("exchangeAdvanced")}
        </summary>
        <label className="mt-2 block">
          {t("exchangeServer")}
          <input className={input} autoComplete="off" value={fields.url} onChange={set("url")} disabled={busy} />
          <span className="mt-1 block text-xs text-stone-500">{t("exchangeServerLeaveEmpty")}</span>
        </label>
      </details>
    </div>
  );
}

/**
 * Under the server field: for a domain the app does not know, that Connect
 * finds the server; what the search is doing; and the question when it
 * would send the password to a host outside the email's domain. In the form, never a
 * dialog over Settings (section 11.4).
 */
function ServerSearchLine({
  busy,
  searching,
  note,
  ask,
  onAllow,
  onDeny,
}: {
  busy: boolean;
  searching: boolean;
  note: string;
  ask: string | null;
  onAllow: (host: string) => void;
  onDeny: () => void;
}) {
  const t = useMailT();
  const link = "font-medium text-stone-700 underline-offset-2 hover:underline disabled:opacity-50";
  if (ask) {
    return (
      <div role="group" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-stone-700">
        <p className="leading-relaxed">{t("exchangeServerAsk", { host: ask })}</p>
        <div className="mt-2 flex gap-3">
          <button type="button" className={link} disabled={busy} onClick={() => onAllow(ask)}>
            {t("exchangeServerAllow")}
          </button>
          <button type="button" className={link} disabled={busy} onClick={onDeny}>
            {t("exchangeServerDeny")}
          </button>
        </div>
      </div>
    );
  }
  const said = searching ? t("exchangeFindingServer") : note;
  return (
    <div className="mt-2 flex items-center gap-3 text-xs text-stone-500">
      <span aria-live="polite">{said}</span>
    </div>
  );
}

function ExchangeFormButtons({
  fields,
  busy,
  onCancel,
}: {
  fields: Fields;
  busy: boolean;
  onCancel: () => void;
}) {
  const t = useMailT();
  return (
    <div className="mt-5 flex gap-2">
      <button
        type="submit"
        disabled={
          busy ||
          // An empty server is searched for, unless the domain is known.
          !fields.email ||
          !fields.username ||
          !fields.password ||
          (!fields.url && !needsSearch(fields))
        }
        className="rounded-full bg-stone-800 px-4 py-1.5 text-sm font-medium text-white hover:bg-stone-900 disabled:opacity-50"
      >
        {busy ? t("exchangeConnecting") : t("exchangeConnect")}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onCancel}
        className="rounded-full border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-stone-700 hover:bg-stone-50"
      >
        {t("exchangeCancel")}
      </button>
    </div>
  );
}
