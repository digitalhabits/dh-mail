/*
 * A message that one window hands to another window to send.
 *
 * The reply window closes when Send is pressed, and the main window sends
 * the message, with its Undo. A message must go one time: not two times,
 * and not zero times. So the two windows agree through one stored row, and
 * each change of that row is one atomic step of the store.
 *
 *   offered    The reply window wrote the message. No window sends yet.
 *   claimed    The main window took the message. Only the main window sends.
 *   withdrawn  The reply window took the offer back. Only it sends.
 *
 * A row goes from "offered" to one of the other two states, and never
 * leaves that state. The store decides which window wins: `claim` and
 * `withdraw` each read the state and write the new one in the same step.
 * The main window sends only what `claim` gave it. The reply window sends
 * only after `withdraw` answered "withdrawn".
 *
 * Pure: no React, no browser. The rows are given (send-handover-store.ts
 * keeps them in IndexedDB, which all windows of the app share).
 */

export type SendHandoverState = "offered" | "claimed" | "withdrawn";

export type SendHandoverRow<P> = {
  id: string;
  state: SendHandoverState;
  /** When it was offered. */
  at: number;
  /** The message. Null after the row left "offered". */
  payload: P | null;
};

/**
 * Where the rows are kept.
 *
 * `update` is one atomic step: it reads the row, and writes the row that
 * `change` returns. `undefined` from `change` writes nothing. No other
 * `update` of the same store runs between the read and the write. The
 * promise resolves only after the write is kept, and rejects if it was not.
 */
export type SendHandoverRows<P> = {
  update(
    id: string,
    change: (row: SendHandoverRow<P> | null) => SendHandoverRow<P> | undefined
  ): Promise<void>;
  read(id: string): Promise<SendHandoverRow<P> | null>;
  /** Drop rows offered before this time. */
  prune(before: number): Promise<void>;
};

/** How long the reply window waits for the main window to take the message. */
export const SEND_HANDOVER_WAIT_MS = 3000;
/** How often it looks. */
export const SEND_HANDOVER_POLL_MS = 50;
/**
 * The main window does not take an offer older than this. A reply window
 * that is there withdraws its offer after SEND_HANDOVER_WAIT_MS, so an
 * older offer is from a window that went away.
 */
export const SEND_HANDOVER_MAX_AGE_MS = 10_000;
/** Rows older than this are dropped when the main window starts. */
export const SEND_HANDOVER_KEEP_MS = 24 * 60 * 60 * 1000;

/** Rows in memory, for the suites and for a host with no IndexedDB. */
export function memoryHandoverRows<P>(): SendHandoverRows<P> & {
  all(): SendHandoverRow<P>[];
} {
  const rows = new Map<string, SendHandoverRow<P>>();
  return {
    async update(id, change) {
      const next = change(rows.get(id) ?? null);
      if (next) rows.set(id, next);
    },
    async read(id) {
      return rows.get(id) ?? null;
    },
    async prune(before) {
      for (const [id, row] of rows) if (row.at < before) rows.delete(id);
    },
    all: () => [...rows.values()],
  };
}

/** The reply window writes the message. A second offer of one id writes nothing. */
export async function offerHandover<P>(
  rows: SendHandoverRows<P>,
  id: string,
  payload: P,
  now: () => number = Date.now
): Promise<void> {
  await rows.update(id, (row) =>
    row ? undefined : { id, state: "offered", at: now(), payload }
  );
}

/**
 * The main window takes the message.
 *
 * Answers the message one time only: for a row that is "offered" and not
 * too old. A second claim of the same id, a claim of a withdrawn offer, and
 * a claim of an unknown id all answer null. A null answer means: do not
 * send.
 */
export async function claimHandover<P>(
  rows: SendHandoverRows<P>,
  id: string,
  options: { now?: () => number; maxAgeMs?: number } = {}
): Promise<P | null> {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? SEND_HANDOVER_MAX_AGE_MS;
  let taken: P | null = null;
  await rows.update(id, (row) => {
    taken = null;
    if (!row || row.state !== "offered" || row.payload == null) return undefined;
    if (now() - row.at > maxAgeMs) return undefined;
    taken = row.payload;
    // The message leaves the row with the claim: it can be many megabytes.
    return { ...row, state: "claimed", payload: null };
  });
  return taken;
}

/**
 * The reply window takes its offer back.
 *
 * "withdrawn": the offer is closed, and the main window can not take it.
 * "claimed": the main window was first, and it sends.
 * "missing": there is no such row.
 */
export async function withdrawHandover<P>(
  rows: SendHandoverRows<P>,
  id: string
): Promise<"withdrawn" | "claimed" | "missing"> {
  let answer: "withdrawn" | "claimed" | "missing" = "missing";
  await rows.update(id, (row) => {
    if (!row) {
      answer = "missing";
      return undefined;
    }
    if (row.state === "claimed") {
      answer = "claimed";
      return undefined;
    }
    answer = "withdrawn";
    if (row.state === "withdrawn") return undefined;
    return { ...row, state: "withdrawn", payload: null };
  });
  return answer;
}

/**
 * What the reply window does with the message after the offer.
 *
 * "taken": the main window sends it. Close the window, and send nothing.
 * "kept": the offer is closed. This window sends it, as before.
 * "unknown": the store did not say who has it. Send nothing, and keep the
 * words on screen.
 */
export type SendHandoverResult = "taken" | "kept" | "unknown";

/**
 * Offer a message, tell the main window, and wait for it to take it.
 *
 * `announce` tells the main window the id. If it throws (no main window, an
 * older app shell), nobody was told, and the offer is withdrawn at once.
 * If the main window does not claim within `waitMs`, the offer is withdrawn.
 * The withdrawal is the atomic step that decides: its answer is the result,
 * so a claim that comes at the last moment is still seen.
 */
export async function offerSendHandover<P>(input: {
  rows: SendHandoverRows<P>;
  id: string;
  payload: P;
  announce: (id: string) => Promise<void> | void;
  waitMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<SendHandoverResult> {
  const { rows, id, payload, announce } = input;
  const waitMs = input.waitMs ?? SEND_HANDOVER_WAIT_MS;
  const pollMs = input.pollMs ?? SEND_HANDOVER_POLL_MS;
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let offered = true;
  try {
    await offerHandover(rows, id, payload, now);
  } catch {
    offered = false;
  }

  if (offered) {
    let told = true;
    try {
      await announce(id);
    } catch {
      told = false;
    }
    const deadline = now() + waitMs;
    while (told && now() < deadline) {
      try {
        if ((await rows.read(id))?.state === "claimed") return "taken";
      } catch {
        // The withdrawal below decides.
        break;
      }
      await sleep(pollMs);
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const answer = await withdrawHandover(rows, id);
      if (answer === "claimed") return "taken";
      if (answer === "withdrawn") return "kept";
      // No row. An offer that failed wrote none, so nobody can take it.
      // An offer that was written and is gone is not explained.
      return offered ? "unknown" : "kept";
    } catch {
      // Once more, then give the answer below.
    }
  }
  // The store refused the offer and the withdrawal: nothing was written,
  // so the main window has nothing to take. If the offer was written and
  // the withdrawal failed, the main window can have it.
  return offered ? "unknown" : "kept";
}

/**
 * The main window's side: take an announced message, one time.
 *
 * `seen` holds the ids this window was told of, so a second announcement
 * of one id does not ask the store again. The store's own answer is what
 * makes it safe: see `claimHandover`.
 */
export async function takeAnnouncedHandover<P>(input: {
  rows: SendHandoverRows<P>;
  id: string;
  seen: Set<string>;
  now?: () => number;
  maxAgeMs?: number;
}): Promise<P | null> {
  const { rows, id, seen } = input;
  if (!id || seen.has(id)) return null;
  seen.add(id);
  try {
    return await claimHandover(rows, id, { now: input.now, maxAgeMs: input.maxAgeMs });
  } catch {
    // Not claimed: the reply window withdraws and sends.
    return null;
  }
}
