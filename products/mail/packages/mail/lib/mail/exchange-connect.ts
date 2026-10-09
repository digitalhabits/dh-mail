/**
 * Asking for the Exchange (EWS) connect form.
 *
 * An Exchange mailbox signs in with a username and a password, not with a
 * browser. Every "connect" and "reconnect" of an Exchange mailbox comes
 * here, and the form (`ExchangeConnectForm`) answers, in Settings or on the
 * start page. The desktop app's connect seam sends any address it knows as
 * an Exchange account here too, whatever provider the caller guessed. So a
 * reconnect of an Exchange mailbox never opens Google's or Microsoft's
 * sign-in.
 *
 * In both builds (section 18, item 5 of `docs/mail-exchange-ews.md`).
 */

import { isPublicMailProduct } from "@/lib/mail/product-flavor";


export const EXCHANGE_CONNECT_REQUEST = "dh-mail-exchange-connect";

export type ExchangeConnectRequest = {
  /** The mailbox to sign in again. Empty for a new one. */
  email?: string;
  /** Called when the form closes: the connected address, or null. */
  done: (connected: string | null) => void;
};

/** How many forms can answer in this window. */
let listening = 0;

/** The form counts itself while it is mounted. Answers the undo. */
export function listenForExchangeConnect(): () => void {
  listening += 1;
  return () => {
    listening -= 1;
  };
}

/** Open the form, and wait for it to close. */
export function requestExchangeConnect(email?: string): Promise<string | null> {
  if (typeof window === "undefined" || listening === 0) {
    return Promise.reject(new Error("The Exchange form is not in this window. Open the main window."));
  }
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<ExchangeConnectRequest>(EXCHANGE_CONNECT_REQUEST, {
        detail: { email, done: resolve },
      })
    );
  });
}

/**
 * The EWS address to offer for a mail domain (the part after the `@`).
 * University of Copenhagen mailboxes are on `mail.ku.dk` (section 2 of the
 * design note), for the main domain and for the faculty domains under it.
 * Nothing is offered for any other domain: autodiscover is not built yet.
 */
export function defaultExchangeServer(domain: string): string {
  if (searchKnownServers()) return "";
  const host = domain.trim().toLowerCase();
  if (host === "ku.dk" || host.endsWith(".ku.dk")) return "https://mail.ku.dk/EWS/Exchange.asmx";
  return "";
}

/** The domain of an address, or "". */
export function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? "" : email.slice(at + 1).trim().toLowerCase();
}

/**
 * A test switch: treat every domain as unknown, `ku.dk` included, so the
 * connect form offers "Find server" and Autodiscover can be tried on a
 * real KU mailbox. Set with `dhExchange.testDiscovery(true)` in the web
 * inspector, kept in localStorage so it lasts a reload. The internal
 * flavor only: the public build never reads it.
 */
export const SEARCH_KNOWN_SERVERS_KEY = "redd-plan-mail-exchange-search-known";

export function searchKnownServers(): boolean {
  if (isPublicMailProduct()) return false;
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SEARCH_KNOWN_SERVERS_KEY) === "1";
  } catch {
    return false;
  }
}
