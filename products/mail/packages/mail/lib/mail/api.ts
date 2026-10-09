/**
 * How the mail user interface reaches its own API.
 *
 * Every request goes through one transport, so a host can change what a call
 * means without touching a call site. Today there is one: HTTP to the app that
 * serves the interface.
 *
 * The standalone product replaces it. That build has no server, so the
 * transport routes each path to a local handler instead. To-Do does the same
 * thing in `products/todo/packages/todo/lib/todo/standalone-api.ts`, which maps
 * the same paths onto Tauri `invoke` commands.
 *
 * Provider calls do not belong here. `lib/gmail/api.ts` and `lib/outlook/api.ts`
 * talk to Google and Microsoft, which is a different boundary.
 */

/** A path under `/api`, with the same options `fetch` takes. */
export type MailApiTransport = (
  path: string,
  init?: RequestInit
) => Promise<Response>;

/** Ask the app that served this interface. */
const httpTransport: MailApiTransport = (path, init) =>
  fetch(path, { cache: "no-store", ...init });

let current: MailApiTransport = httpTransport;

/** Replace the transport. A host calls this once, before mail renders. */
export function setMailApiTransport(transport: MailApiTransport): void {
  current = transport;
}

/** The raw response. Use it for attachments and other non-JSON replies. */
export function mailApiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  return current(path, init);
}

/**
 * The parsed reply, or an error carrying the server's message.
 *
 * A failing request does not always answer JSON. A gateway can return HTML, so
 * parse first and report a plain failure when the body is not JSON. Five of the
 * seven copies this replaced threw a parser error there, which hid the real
 * status.
 */
export async function mailApiJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await mailApiFetch(path, init);
  let json: T & { error?: string };
  try {
    json = (await res.json()) as T & { error?: string };
  } catch {
    throw new Error(res.ok ? "Invalid JSON response" : "Request failed");
  }
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}
