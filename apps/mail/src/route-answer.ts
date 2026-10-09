/**
 * The shape of a route in this app, and the two ways it answers.
 *
 * `standalone-api.ts` routes each `/api/...` path to a function of this
 * shape. They are in a file of their own so that a build can add routes of
 * its own beside them without a second copy of these.
 */

import { PlanError } from "@/lib/plan/errors";

/** What a route gets: the request, taken apart once. */
export type RouteContext = {
  url: URL;
  q: URLSearchParams;
  method: string;
  init?: RequestInit;
  /** The JSON body, or an empty object when there is none. */
  body: <T>() => Promise<T>;
};

export type Route = (ctx: RouteContext) => Promise<Response>;

export function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * An error, with the status the core meant.
 *
 * The core says what went wrong by throwing a PlanError carrying a status, and
 * a server host's route helper passes it through. Flattening every one of those
 * to 500 would turn "not found" and "not allowed" into "something broke".
 */
export function failed(error: unknown, status?: number): Response {
  const message = error instanceof Error ? error.message : String(error);
  const fromError =
    error instanceof PlanError && error.status >= 400 ? error.status : undefined;
  return new Response(JSON.stringify({ error: message }), {
    status: status ?? fromError ?? 500,
    headers: { "content-type": "application/json" },
  });
}
