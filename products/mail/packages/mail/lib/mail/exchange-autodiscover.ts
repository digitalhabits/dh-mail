/**
 * Finding the EWS server of a mailbox (Autodiscover, section 16.7 of
 * `docs/mail-exchange-ews.md`). The search is in Rust
 * (`ews_autodiscover.rs`); this is the connect form's side of it.
 *
 * - A domain whose server is known (`defaultExchangeServer`, today
 *   `ku.dk`) needs no search.
 * - What the person typed in the server field always wins over what a
 *   search finds.
 * - The search can stop at a host outside the email's domain. Then the
 *   person decides whether the password may go there, and the search runs
 *   again with that host allowed.
 * - A refused password stops the search at once. The form says so, and
 *   does not try again by itself (section 4.7).
 */

import { defaultExchangeServer, domainOf } from "@/lib/mail/exchange-connect";
import { exchangeErrorCode, invoke } from "@/lib/mail/exchange-native";

/** What `mail_ews_autodiscover` answers. */
type Discovery = { url: string | null; source: string | null; ask: string | null };

export type ServerSearch =
  | { kind: "known"; url: string }
  | { kind: "found"; url: string; source: string }
  | { kind: "ask"; host: string }
  | { kind: "none" }
  | { kind: "refused" };

/** The server of a domain the app knows, or "". */
export function knownServer(email: string): string {
  return defaultExchangeServer(domainOf(email));
}

/** Connect must search first: the server field is empty, and not known. */
export function needsSearch(fields: { email: string; url: string }): boolean {
  return !fields.url.trim() && !knownServer(fields.email) && domainOf(fields.email) !== "";
}

/**
 * The server field after a search. What the person typed wins: a field
 * they changed and did not leave empty keeps its text.
 */
export function fillServer(current: string, typedByPerson: boolean, found: string): string {
  return typedByPerson && current.trim() ? current : found;
}

/** Search for the server. Never throws: each outcome is a kind. */
export async function searchExchangeServer(input: {
  email: string;
  username: string;
  password: string;
  allowHost?: string | null;
}): Promise<ServerSearch> {
  const known = knownServer(input.email);
  if (known) return { kind: "known", url: known };
  try {
    const found = await invoke<Discovery>("mail_ews_autodiscover", {
      email: input.email.trim().toLowerCase(),
      username: input.username.trim(),
      password: input.password,
      allowHost: input.allowHost ?? null,
    });
    if (found.url) return { kind: "found", url: found.url, source: found.source ?? "" };
    if (found.ask) return { kind: "ask", host: found.ask };
    return { kind: "none" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return exchangeErrorCode(message) === "ews:refused" ? { kind: "refused" } : { kind: "none" };
  }
}
