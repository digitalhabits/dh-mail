/**
 * The access code of an Exchange (EWS) connect (section 18, item 5 of
 * `docs/mail-exchange-ews.md`).
 *
 * KU IT can only allow the app for every KU user, and wants only people we
 * choose to connect. So a new Exchange mailbox needs an access code, which
 * the Digital Habits server checks (`/api/mail/exchange-access`). Only when
 * the server says yes does the app make any call to the Exchange server. A mailbox that
 * is connected already is not checked again.
 *
 * The source is public, so a code keeps out casual users, not a determined
 * one. The code is not kept: it is sent once, for the check.
 */

import { connectExchange, type ExchangeConnectInput, type ExchangeFolderSummary } from "@/lib/mail/exchange-native";

export const EXCHANGE_ACCESS_URL = "https://plan.digitalhabits.org/api/mail/exchange-access";

/** How long the check may take before it counts as not made. */
export const ACCESS_CHECK_MS = 10_000;

/** What the server said: yes, no, too many tries, or no answer. */
export type AccessAnswer = "ok" | "refused" | "limited" | "unchecked";

/** Ask the Digital Habits server about a code. Never throws. */
export async function checkExchangeAccessCode(code: string, fetchImpl: typeof fetch = fetch): Promise<AccessAnswer> {
  if (!code.trim()) return "refused";
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ACCESS_CHECK_MS);
  try {
    const res = await fetchImpl(EXCHANGE_ACCESS_URL, {
      method: "POST",
      // text/plain, so the request goes with no preflight.
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ code: code.trim() }),
      credentials: "omit",
      signal: abort.signal,
    });
    if (res.status === 204) return "ok";
    if (res.status === 403) return "refused";
    if (res.status === 429) return "limited";
    return "unchecked";
  } catch {
    return "unchecked";
  } finally {
    clearTimeout(timer);
  }
}

/** A connect the access code stopped. Its `answer` says why. */
export class AccessCodeError extends Error {
  constructor(readonly answer: Exclude<AccessAnswer, "ok">) {
    super(`ews:access: ${answer}`);
  }
}

/**
 * Check the code, then connect. `again`: a mailbox connected already, which
 * is not checked. Throws `AccessCodeError` before any Exchange call when the
 * code is not accepted.
 */
export async function connectExchangeWithCode(
  input: ExchangeConnectInput,
  options: { code: string; again: boolean; fetchImpl?: typeof fetch }
): Promise<ExchangeFolderSummary> {
  if (!options.again) {
    const answer = await checkExchangeAccessCode(options.code, options.fetchImpl);
    if (answer !== "ok") throw new AccessCodeError(answer);
  }
  return connectExchange(input);
}
