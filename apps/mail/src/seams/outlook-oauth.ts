/**
 * Microsoft token refresh for the standalone product.
 *
 * The mail core asks for an access token whenever it talks to Graph. A
 * server host reads a client id and secret from the server environment,
 * which this build has neither of. It uses the app's own public client instead,
 * the same one that connected the mailbox, and sends no secret at all: Entra
 * refuses one from a public client.
 *
 * The request goes through Rust, not `fetch`. Entra refuses a token request
 * that carries an `Origin` header, and a webview sends one on every call. See
 * `../token-request`. This applies to a refresh as much as to the first
 * exchange, so getting it wrong here would break every mailbox an hour after it
 * connected.
 *
 * Only `refreshMicrosoftAccessToken` is needed. The rest of a server
 * host's module belongs to a flow that runs on a server.
 */

import { buildRefreshBody } from "@/lib/mail/pkce";

import {
  MICROSOFT_CLIENT_ID,
  MICROSOFT_SCOPES,
  MICROSOFT_TOKEN_ENDPOINT,
} from "../oauth-config";
import { postTokenRequest } from "../token-request";

/**
 * A fresh access token, and the rotated refresh token when Microsoft sends one.
 *
 * **Microsoft rotates refresh tokens, and the caller must store the new one.**
 * The old one keeps working for a short while and then stops, so dropping the
 * replacement makes the mailbox fail days later for no visible reason.
 *
 * A refused grant must say `invalid_grant`, because that is what marks a
 * mailbox as needing to reconnect. Anything else reads as a temporary fault and
 * is retried forever.
 */
export async function refreshMicrosoftAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken?: string }> {
  if (!MICROSOFT_CLIENT_ID) {
    throw new Error("VITE_MICROSOFT_CLIENT_ID is not set");
  }

  const body = buildRefreshBody({
    clientId: MICROSOFT_CLIENT_ID,
    refreshToken,
  });
  // Entra narrows the grant to the scopes asked for here. Leaving it out drops
  // Contacts.Read on the next token and the address book quietly stops syncing.
  body.set("scope", MICROSOFT_SCOPES.join(" "));

  const reply = await postTokenRequest(MICROSOFT_TOKEN_ENDPOINT, body);
  const failure = reply.body.error;
  if (reply.status >= 400 || failure) {
    const detail =
      reply.body.error_description || failure || "refresh failed";
    // The word invalid_grant has to survive: it is what marks a mailbox as
    // needing to reconnect, and anything else reads as a passing fault.
    throw new Error(failure ? `${failure}: ${detail}` : detail);
  }
  const data = reply.body;
  if (!data.access_token) {
    throw new Error("Microsoft returned no access token on refresh");
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token };
}
