/**
 * What a build can add to the app around the mail interface. This one adds
 * nothing.
 *
 * `standalone-api.ts`, `App.tsx` and `main.tsx` import these names from
 * `@/team-shell`, and this app resolves that name to this file. Every part
 * here is empty: no extra routes, no strip over the window, nothing to
 * import on the first launch.
 */

import type { ReactNode } from "react";

import type { Route } from "../route-answer";

/** Paths this build answers beside the mail routes. None. */
export const TEAM_MAIL_ROUTES: Record<string, Route> = {};

/** Something more to say about a send. Nothing. */
export async function proposeAfterSend(_input: {
  account: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  threadId?: string;
}): Promise<unknown> {
  return undefined;
}

/** The demo's answer to a path of the team's. There are none. */
export function demoTeamAnswer(_pathname: string): unknown {
  return undefined;
}

export async function importTeamStateOnce(): Promise<unknown> {
  return null;
}

export function installTeamDebug(
  _api: (path: string, init?: RequestInit) => Promise<Response>
): void {}

export function useTeamSessionBar(_isPane: boolean): ReactNode {
  return null;
}
