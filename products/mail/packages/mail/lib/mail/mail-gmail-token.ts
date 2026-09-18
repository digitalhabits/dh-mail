import "server-only";

import { getAccountStoredToken, recordGrantedScopes } from "@/lib/gmail/accounts";
import {
  missingGoogleFeatures,
  refreshAccessToken,
  type GoogleFeature,
} from "@/lib/gmail/oauth";

type CachedToken = {
  token: string;
  expiresAt: number;
  /** What Google said the token covers. Null when it did not say. */
  grantedScopes: string | null;
};

const tokenCache = new Map<string, CachedToken>();

/** After invalid_grant, skip Google for a while so polls do not spam logs. */
const authFailureCache = new Map<string, { detail: string; until: number }>();
const AUTH_FAILURE_TTL_MS = 10 * 60 * 1000;

export class GmailAuthError extends Error {
  readonly accountEmail: string;

  constructor(accountEmail: string, detail: string) {
    super(`Gmail for ${accountEmail} needs reconnect — ${detail}`);
    this.name = "GmailAuthError";
    this.accountEmail = accountEmail;
  }
}

function isInvalidGrant(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /invalid_grant/i.test(msg);
}

/** Clear a cached auth failure after the user reconnects. */
export function clearGmailAuthFailure(accountEmail: string): void {
  const key = accountEmail.trim().toLowerCase();
  authFailureCache.delete(key);
  tokenCache.delete(accountEmail);
  tokenCache.delete(key);
}

/** Cached Gmail access token for a connected account (tokens live ~60 min). */
export async function accessTokenFor(accountEmail: string): Promise<string> {
  const key = accountEmail.trim().toLowerCase();
  const failed = authFailureCache.get(key);
  if (failed && failed.until > Date.now()) {
    throw new GmailAuthError(accountEmail, failed.detail);
  }

  const cached = tokenCache.get(accountEmail) ?? tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const stored = await getAccountStoredToken(accountEmail);
  try {
    const { accessToken, grantedScopes } = await refreshAccessToken(
      stored.refreshToken
    );
    authFailureCache.delete(key);
    const entry: CachedToken = {
      token: accessToken,
      expiresAt: Date.now() + 50 * 60 * 1000,
      grantedScopes,
    };
    tokenCache.set(accountEmail, entry);
    tokenCache.set(key, entry);
    if (grantedScopes) {
      // The token works whether or not the row remembers its grant.
      try {
        await recordGrantedScopes(key, stored.ownerId, grantedScopes);
      } catch (recordErr) {
        console.warn(
          `[mail] ${accountEmail}: could not record the Google grant:`,
          recordErr
        );
      }
    }
    return accessToken;
  } catch (err) {
    if (isInvalidGrant(err)) {
      const detail = "Google token expired or revoked";
      authFailureCache.set(key, {
        detail,
        until: Date.now() + AUTH_FAILURE_TTL_MS,
      });
      console.warn(
        `[mail] ${accountEmail}: ${detail}. Reconnect the account in Mail → Accounts.`
      );
      throw new GmailAuthError(accountEmail, detail);
    }
    throw err;
  }
}

/**
 * The planner features this account's token does not cover.
 *
 * Asked before a Calendar or Docs call, so the answer is "reconnect" in
 * plain words rather than a 403 that could mean three things. Empty when
 * Google did not say what it granted, and the call finds out the old way.
 */
export async function missingGoogleFeaturesFor(
  accountEmail: string
): Promise<GoogleFeature[]> {
  await accessTokenFor(accountEmail);
  const key = accountEmail.trim().toLowerCase();
  const cached = tokenCache.get(accountEmail) ?? tokenCache.get(key);
  return missingGoogleFeatures(cached?.grantedScopes);
}
