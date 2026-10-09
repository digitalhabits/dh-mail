/**
 * PKCE, for an app that holds no secret.
 *
 * A desktop app cannot keep a client secret: anyone can read it out of the
 * bundle. PKCE replaces it. The app invents a random verifier, sends only its
 * hash to start the flow, and proves it holds the original when it exchanges
 * the code. Someone who intercepts the code cannot use it without the verifier.
 *
 * A host that runs on a server does not need this: its secret stays on the
 * server. See RFC 7636.
 *
 * Web Crypto only, so this runs in a webview and in Node alike.
 */

/** A verifier and the challenge derived from it. */
export type PkcePair = {
  /** Kept by the app until the exchange. Never sent to start the flow. */
  verifier: string;
  /** Sent to the authorization server. */
  challenge: string;
  /** Always S256. `plain` sends the verifier itself, which defeats the point. */
  method: "S256";
};

/** RFC 7636 allows 43 to 128 characters. 64 bytes of entropy gives 86. */
const VERIFIER_BYTES = 64;

const UNRESERVED =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** base64url, without padding. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * A verifier from the unreserved character set.
 *
 * Mapping random bytes onto 64 characters divides evenly into 256, so no value
 * is more likely than another.
 */
export function createPkceVerifier(): string {
  const bytes = new Uint8Array(VERIFIER_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) out += UNRESERVED[byte % UNRESERVED.length];
  return out;
}

/** base64url of the SHA-256 of the verifier, per RFC 7636. */
export async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );
  return base64Url(new Uint8Array(digest));
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = createPkceVerifier();
  return {
    verifier,
    challenge: await createPkceChallenge(verifier),
    method: "S256",
  };
}

/** Opaque value tying the redirect back to the request that started it. */
export function createOauthState(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export type AuthorizationRequest = {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  challenge: string;
  /** Google needs these to return a refresh token at all. */
  extra?: Record<string, string>;
};

/** The URL to open in the user's browser. */
export function buildAuthorizationUrl(request: AuthorizationRequest): string {
  const url = new URL(request.authorizationEndpoint);
  const params = url.searchParams;
  params.set("response_type", "code");
  params.set("client_id", request.clientId);
  params.set("redirect_uri", request.redirectUri);
  params.set("scope", request.scopes.join(" "));
  params.set("state", request.state);
  params.set("code_challenge", request.challenge);
  params.set("code_challenge_method", "S256");
  for (const [key, value] of Object.entries(request.extra ?? {})) {
    params.set(key, value);
  }
  return url.toString();
}

/**
 * Form body for the code exchange.
 *
 * `clientSecret` is optional because it is not a defence here. Google refuses a
 * desktop client without one and says itself that the value is not confidential
 * for installed apps. The verifier is what proves this app started the flow.
 */
export function buildTokenExchangeBody(input: {
  clientId: string;
  code: string;
  redirectUri: string;
  verifier: string;
  clientSecret?: string;
}): URLSearchParams {
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("client_id", input.clientId);
  body.set("code", input.code);
  body.set("redirect_uri", input.redirectUri);
  body.set("code_verifier", input.verifier);
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  return body;
}

/** Form body for a refresh. Carries the secret when the provider needs one. */
export function buildRefreshBody(input: {
  clientId: string;
  refreshToken: string;
  clientSecret?: string;
}): URLSearchParams {
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("client_id", input.clientId);
  body.set("refresh_token", input.refreshToken);
  if (input.clientSecret) body.set("client_secret", input.clientSecret);
  return body;
}
