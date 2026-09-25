/*
 * One request to Microsoft Graph: a few at a time for each mailbox, with a
 * retry when Graph says to wait (429, 503), and its errors in the reader's
 * words.
 */

import "server-only";
import { mailSay } from "@/lib/mail/i18n-strings";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * How many requests this app will have in the air for one mailbox at once.
 *
 * Graph allows four, and answers the fifth with 429 ApplicationThrottled —
 * "over its MailboxConcurrency limit". Three leaves room for the request the
 * reader is actually waiting on: a forward reads its attachments in parallel
 * and then sends, and it was the send that came back refused.
 */
const GRAPH_CONCURRENCY = 3;

/** Waiting room, one queue per mailbox. */
const graphQueues = new Map<string, { running: number; waiting: (() => void)[] }>();

async function withGraphSlot<T>(
  accessToken: string,
  run: () => Promise<T>
): Promise<T> {
  // Keyed by the token, which is per mailbox — the limit Graph counts by.
  // A refresh mid-flight opens a second queue for the same mailbox for a
  // moment. The retry below is what covers that; three plus three is over
  // the line, but only until the old token's work drains.
  const key = accessToken.slice(-32);
  const queue = graphQueues.get(key) ?? { running: 0, waiting: [] };
  graphQueues.set(key, queue);
  if (queue.running >= GRAPH_CONCURRENCY) {
    await new Promise<void>((resolve) => queue.waiting.push(resolve));
  }
  queue.running += 1;
  try {
    return await run();
  } finally {
    queue.running -= 1;
    queue.waiting.shift()?.();
    if (!queue.running && !queue.waiting.length) graphQueues.delete(key);
  }
}

/** Statuses Graph uses for "not now, ask again" rather than "no". */
const GRAPH_RETRY_STATUS = new Set([429, 503, 504]);
const GRAPH_ATTEMPTS = 3;
const GRAPH_MAX_WAIT_MS = 20_000;

function retryAfterMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get("retry-after"));
  // Graph says how long in seconds. Without it, back off on our own.
  const wait = Number.isFinite(header) && header > 0 ? header * 1000 : 2 ** attempt * 700;
  return Math.min(wait, GRAPH_MAX_WAIT_MS);
}

export async function graphFetch<T>(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  return withGraphSlot(accessToken, async () => {
    let lastThrottle: { status: number; text: string } | null = null;
    for (let attempt = 0; attempt < GRAPH_ATTEMPTS; attempt++) {
      const res = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...(init?.headers ?? {}),
        },
        cache: "no-store",
      });
      if (res.status === 204) return undefined as T;
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { raw: text };
        }
      }
      if (res.ok) return data as T;

      /*
        Told to wait, rather than told no.

        Graph throttles per mailbox and says for how long. Waiting and asking
        again is what it asks for, and it is the difference between a send
        that takes three seconds and a send the reader is told failed.
      */
      if (GRAPH_RETRY_STATUS.has(res.status) && attempt < GRAPH_ATTEMPTS - 1) {
        lastThrottle = { status: res.status, text };
        await new Promise((resolve) =>
          setTimeout(resolve, retryAfterMs(res, attempt))
        );
        continue;
      }

      const throttled = GRAPH_RETRY_STATUS.has(res.status);
      const err = new Error(
        // A reader can do something about "wait a moment". Nobody can do
        // anything about a line of Graph's JSON, and this one reached the
        // screen of somebody forwarding a message.
        throttled
          ? mailSay("mailboxBusy")
          : `Graph ${init?.method ?? "GET"} ${path} failed (${res.status}): ${text.slice(0, 300)}`
      ) as Error & { status?: number; detail?: string };
      err.status = res.status;
      if (throttled) {
        err.detail = `Graph ${init?.method ?? "GET"} ${path} (${res.status}): ${text.slice(0, 300)}`;
      }
      throw err;
    }
    // Every attempt was throttled.
    const err = new Error(mailSay("mailboxBusy")) as Error & {
      status?: number;
      detail?: string;
    };
    err.status = lastThrottle?.status ?? 429;
    err.detail = lastThrottle?.text.slice(0, 300);
    throw err;
  });
}
