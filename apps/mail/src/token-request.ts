/**
 * Token requests that do not come from the page.
 *
 * **Microsoft refuses a token request carrying an `Origin` header**, which a
 * webview sends on every `fetch`. The refusal is AADSTS90023: cross-origin
 * token redemption is for single-page apps, and registering as one would trade
 * this problem for refresh tokens that expire in a day. A native client is
 * expected to make the request itself, so Rust makes it.
 *
 * Google allows the request from the page, and does so today, so Gmail stays on
 * `fetch`. Both go through the same shape either way, so moving Gmail here is a
 * one-line change if Google ever tightens.
 */

import { tauriInvoke } from "@/lib/mail/store/tauri";

/** What the endpoint answered, in the shape `fetch` would have given. */
export type TokenReply = {
  status: number;
  body: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    error?: string;
    error_description?: string;
  };
};

export async function postTokenRequest(
  endpoint: string,
  form: URLSearchParams
): Promise<TokenReply> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Signing in needs the desktop app");
  return (await invoke("oauth_token_request", {
    endpoint,
    form: Object.fromEntries(form),
  })) as TokenReply;
}

/**
 * The body of a good reply, or an error carrying what the provider said.
 *
 * Every caller wants the same thing, and the error text is the only useful
 * thing in a refusal — AADSTS codes name the exact misconfiguration.
 */
export function readTokenReply(reply: TokenReply): TokenReply["body"] {
  const { status, body } = reply;
  if (status >= 400 || body.error) {
    throw new Error(
      body.error_description ||
        body.error ||
        `The token request was refused (${status})`
    );
  }
  return body;
}
