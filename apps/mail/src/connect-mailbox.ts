/**
 * Connecting a mailbox, with no server.
 *
 * 1. Rust takes a loopback port, because the redirect has nowhere else to go.
 * 2. The app makes a PKCE pair and opens the browser at the provider.
 * 3. Rust catches the redirect and checks it belongs to this request.
 * 4. The app exchanges the code, proving it holds the verifier.
 * 5. The refresh token goes to the keychain, through the store.
 *
 * The access token is not kept. It lasts an hour, and the refresh token earns
 * a new one whenever the mail core asks.
 *
 * Google and Microsoft differ in three small ways, held in PROVIDERS below:
 * Google needs a client secret and Microsoft refuses one, Google wants
 * `127.0.0.1` and Microsoft registers `localhost`, and they name the signed-in
 * mailbox with different claims.
 */

import {
  buildAuthorizationUrl,
  buildTokenExchangeBody,
  createOauthState,
  createPkcePair,
} from "@/lib/mail/pkce";
import { clearGmailAuthFailure } from "@/lib/mail/mail-gmail-token";
import { clearOutlookAccessToken } from "@/lib/mail/outlook-inbox";
import { mailStore } from "@/lib/mail/store";
import type { MailStoreProvider } from "@/lib/mail/store/types";
import { openExternalUrl } from "@/lib/native-shell";

import {
  connectConfigError,
  GOOGLE_AUTH_ENDPOINT,
  GOOGLE_AUTH_EXTRA,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_SCOPES,
  GOOGLE_TOKEN_ENDPOINT,
  MICROSOFT_AUTH_ENDPOINT,
  MICROSOFT_AUTH_EXTRA,
  MICROSOFT_CLIENT_ID,
  MICROSOFT_SCOPES,
  MICROSOFT_TOKEN_ENDPOINT,
} from "./oauth-config";
import { tauriInvoke } from "@/lib/mail/store/tauri";
import { postTokenRequest, readTokenReply } from "./token-request";

/** Single user, so every mailbox belongs to the same owner. */
const OWNER_ID = "local";

type TokenResponse = {
  refresh_token?: string;
  access_token?: string;
  id_token?: string;
  /** What was actually granted, space-separated. Google always says. */
  scope?: string;
  error?: string;
  error_description?: string;
};

/** The one scope the local copy cannot do without — see GOOGLE_SCOPES. */
const FULL_MAIL_SCOPE = "https://mail.google.com/";

/**
 * Did Google grant less than the mailbox needs?
 *
 * Google's sign-in page lists each permission with its own tick box, and
 * a reader who unticks "read, compose, send and permanently delete all
 * your email" still comes back with a token — one good for the Gmail API
 * and refused by IMAP. Stored, that mailbox never syncs: the copy stays
 * empty, the reader falls back to the API for everything, and a large
 * mailbox trips the API's request limit within the first minute. Better
 * to say so here, before anything is stored.
 *
 * Only when Google said what it granted. A reply with no scope field is
 * not known to be short.
 */
export function fullMailScopeMissing(scope: string | undefined): boolean {
  if (!scope) return false;
  return !scope.split(/\s+/).includes(FULL_MAIL_SCOPE);
}

const FULL_MAIL_SCOPE_HELP =
  "Google did not allow full access to this mailbox, so Mail could not " +
  "keep a copy of it. Connect again and tick every permission on Google's " +
  "sign-in page, including reading, sending and deleting mail.";

type ProviderConfig = {
  label: string;
  /** True when the exchange must come from the app, not the page. */
  exchangeOutsideThePage: boolean;
  clientId: string | undefined;
  /** Google requires one and says itself it is not confidential. Microsoft
   *  refuses one from a public client. */
  clientSecret: string | undefined;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
  extra: Record<string, string>;
  /** The loopback host each provider accepts in a registered redirect. */
  redirectHost: string;
  /** Where this provider puts the mailbox address in its id token. */
  emailClaims: string[];
  /** What to say when the flow returns no refresh token. */
  noRefreshTokenHelp: string;
};

const PROVIDERS: Record<MailStoreProvider, ProviderConfig> = {
  gmail: {
    label: "Google",
    exchangeOutsideThePage: false,
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    authorizationEndpoint: GOOGLE_AUTH_ENDPOINT,
    tokenEndpoint: GOOGLE_TOKEN_ENDPOINT,
    // openid and email are what make Google return an id token at all.
    scopes: [...GOOGLE_SCOPES, "openid", "email"],
    extra: GOOGLE_AUTH_EXTRA,
    redirectHost: "127.0.0.1",
    emailClaims: ["email"],
    noRefreshTokenHelp:
      "Google returned no refresh token. Remove this app at " +
      "myaccount.google.com/permissions and connect again.",
  },
  outlook: {
    label: "Microsoft",
    // Entra refuses a token request with an Origin header, which every fetch
    // from a webview has. See ./token-request.
    exchangeOutsideThePage: true,
    clientId: MICROSOFT_CLIENT_ID,
    clientSecret: undefined,
    authorizationEndpoint: MICROSOFT_AUTH_ENDPOINT,
    tokenEndpoint: MICROSOFT_TOKEN_ENDPOINT,
    scopes: MICROSOFT_SCOPES,
    extra: MICROSOFT_AUTH_EXTRA,
    // Entra allows any port behind a registered "http://localhost", and only
    // that spelling. A registered 127.0.0.1 would have to name its port, which
    // a loopback flow cannot know in advance.
    redirectHost: "localhost",
    // A personal account puts the address in preferred_username, and a work
    // account often has no email claim at all.
    emailClaims: ["email", "preferred_username"],
    noRefreshTokenHelp:
      "Microsoft returned no refresh token. Remove this app at " +
      "account.live.com/consent and connect again.",
  },
};

/**
 * The mailbox address inside an id token, without verifying the signature.
 *
 * It is read, not trusted: it arrived over TLS straight from the provider's
 * token endpoint in answer to this app's own request, so there is no third
 * party to lie about it. Nothing is granted on the strength of these claims —
 * they only label the token that the flow already earned.
 */
function emailFromIdToken(idToken: string, claims: string[]): string | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed = JSON.parse(json) as Record<string, unknown>;
    for (const claim of claims) {
      const value = parsed[claim];
      if (typeof value === "string" && value.includes("@")) {
        return value.toLowerCase();
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Call off a sign-in the browser is not going to answer.
 *
 * The wait for the redirect ends when a redirect arrives and at no other
 * time, so a reader who closed the browser tab, or thought better of it,
 * left a thread waiting for the life of the app — and `connectMailbox`
 * never came back to let them try again. This ends the wait; the wait then
 * throws, and the caller puts its own state away.
 *
 * Quiet when nothing is waiting: giving up twice is not an error.
 */
export async function cancelMailConnect(): Promise<void> {
  const invoke = tauriInvoke();
  if (!invoke) return;
  try {
    await invoke("oauth_cancel");
  } catch {
    /* Nothing was bound, or the redirect beat the cancel to it. */
  }
}

/**
 * Run the whole flow, and answer which mailbox connected.
 *
 * Pass `email` to reconnect one mailbox: it becomes a login hint, so the
 * provider offers that account first instead of asking which one.
 */
export async function connectMailbox(
  provider: MailStoreProvider,
  email?: string
): Promise<{ email: string }> {
  const config = PROVIDERS[provider];
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Connecting a mailbox needs the desktop app");

  const configError = connectConfigError(provider);
  // Fail before the browser opens, rather than after the user approved scopes.
  if (configError) throw new Error(configError);
  if (!config.clientId) throw new Error(`No ${config.label} client is set up`);

  const port = (await invoke("oauth_bind")) as number;
  const redirectUri = `http://${config.redirectHost}:${port}`;
  const state = createOauthState();
  const pkce = await createPkcePair();

  const opened = await openExternalUrl(
    buildAuthorizationUrl({
      authorizationEndpoint: config.authorizationEndpoint,
      clientId: config.clientId,
      redirectUri,
      scopes: config.scopes,
      state,
      challenge: pkce.challenge,
      extra: email ? { ...config.extra, login_hint: email } : config.extra,
    })
  );
  if (!opened) throw new Error("Couldn't open the browser to sign in");

  const redirect = (await invoke("oauth_await_redirect", {
    expectedState: state,
  })) as { code: string };

  const body = buildTokenExchangeBody({
    clientId: config.clientId,
    code: redirect.code,
    redirectUri,
    verifier: pkce.verifier,
    clientSecret: config.clientSecret,
  });
  if (provider === "outlook") body.set("scope", config.scopes.join(" "));

  let tokens: TokenResponse;
  if (config.exchangeOutsideThePage) {
    tokens = readTokenReply(await postTokenRequest(config.tokenEndpoint, body));
  } else {
    const response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    tokens = (await response.json()) as TokenResponse;
    if (!response.ok || tokens.error) {
      throw new Error(
        tokens.error_description || tokens.error || "The sign-in was refused"
      );
    }
  }
  if (!tokens.refresh_token) {
    // Without one the browser would open on every launch, so this is a failure
    // and not a warning.
    throw new Error(config.noRefreshTokenHelp);
  }
  if (provider === "gmail" && fullMailScopeMissing(tokens.scope)) {
    throw new Error(FULL_MAIL_SCOPE_HELP);
  }

  const connected = tokens.id_token
    ? emailFromIdToken(tokens.id_token, config.emailClaims)
    : null;
  if (!connected) {
    throw new Error(`${config.label} did not say which mailbox this is`);
  }

  await mailStore().accounts.save(provider, {
    email: connected,
    ownerId: OWNER_ID,
    refreshToken: tokens.refresh_token,
  });
  // Both cores cache what the old grant earned. A reconnect has to clear it,
  // or the new token goes unused: Gmail remembers a refused grant for ten
  // minutes so it does not hammer Google, and Outlook holds an access token
  // that still looks fresh for 45.
  if (provider === "gmail") clearGmailAuthFailure(connected);
  else clearOutlookAccessToken(connected);
  return { email: connected };
}
